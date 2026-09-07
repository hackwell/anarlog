import { useCallback, useEffect, useMemo, useRef } from "react";

import { useOwnDomains } from "./own-domains";
import {
  type CustomerParticipant,
  type CustomerResolution,
  resolveSessionCustomer,
} from "./resolve";
import {
  markCustomerAssigned,
  markCustomerCleared,
  markSuggestionDismissed,
  useSessionCustomerDecision,
} from "./session-decisions";

import { useHumans } from "~/contacts/queries";
import { useLiveQuery } from "~/db";
import type { SessionParticipantRecord } from "~/session/queries";
import { useSession, useUpdateSession } from "~/session/queries";
import { useSessionParticipants } from "~/session/queries/participants";

export type SessionCustomer = {
  organizationId: string; // "" when unassigned
  suggestion: CustomerResolution | null; // null when there is nothing to offer
  assign: (organizationId: string) => void;
  clear: () => void;
  dismissSuggestion: () => void;
};

export function decideSessionCustomer(input: {
  stored: string;
  resolution: CustomerResolution;
  dismissed: boolean;
  cleared: boolean;
}): { write: string | null; suggestion: CustomerResolution | null } {
  // A stored customer is a person's answer, even when it came from an earlier
  // automatic assignment. Nothing recomputes over it.
  if (input.stored.trim() !== "") {
    return { write: null, suggestion: null };
  }

  // "This meeting has no customer" is an answer too, and the only correction
  // the user has when the rules get it wrong. Without remembering it, the
  // resolver reassigns the meeting the moment it is reopened.
  if (input.cleared) {
    return { write: null, suggestion: null };
  }

  if (input.resolution.kind === "assign") {
    return { write: input.resolution.organizationId, suggestion: null };
  }

  if (input.dismissed || input.resolution.kind === "none") {
    return { write: null, suggestion: null };
  }

  return { write: null, suggestion: input.resolution };
}

// The resolver decides a multi-organization meeting by headcount and trusts
// the list it is given. A calendar API can hand back the same invitee twice,
// which would inflate one organization's count and flip a genuine tie into a
// false majority — so every list is deduplicated before it reaches the
// resolver.
export function dedupeParticipants(
  participants: readonly SessionParticipantRecord[],
): SessionParticipantRecord[] {
  const seen = new Set<string>();
  const deduped: SessionParticipantRecord[] = [];

  participants.forEach((participant, index) => {
    const humanId = participant.humanId.trim();
    const email = participant.email.trim().toLowerCase();
    // Neither id nor email: nothing to match on, so this row can only match
    // itself.
    const key =
      humanId !== ""
        ? `human:${humanId}`
        : email !== ""
          ? `email:${email}`
          : `row:${index}`;

    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(participant);
  });

  return deduped;
}

export function selectResolverParticipants(
  participants: readonly SessionParticipantRecord[],
): CustomerParticipant[] {
  return dedupeParticipants(participants).map((participant) => ({
    email: participant.email,
    // Soft-deleting an organization leaves `humans.organization_id` pointing
    // at it, so the id alone still looks live while the name — joined with
    // `deleted_at IS NULL` — is already gone. A contact whose organization no
    // longer resolves is not evidence for anything.
    organization_id: participant.organizationName.trim()
      ? participant.organizationId
      : "",
    organization_name: participant.organizationName,
  }));
}

const RECENT_ORGANIZATION_LIMIT = 20;
const EMPTY_RECENT_ORGANIZATION_IDS: string[] = [];

type RecentOrganizationSqlRow = { organization_id: string };

export function useRecentOrganizationIds(): string[] {
  const { data = EMPTY_RECENT_ORGANIZATION_IDS } = useLiveQuery<
    RecentOrganizationSqlRow,
    string[]
  >({
    // The cap must count organizations, not session rows: an org whose most
    // recent meeting predates twenty other, unrelated sessions still has to
    // reach the tie-break, so grouping happens before the LIMIT applies.
    sql: `
      SELECT organization_id
      FROM (
        SELECT organization_id, MAX(created_at) AS last_used_at
        FROM sessions
        WHERE deleted_at IS NULL AND organization_id != ''
        GROUP BY organization_id
      )
      ORDER BY last_used_at DESC, organization_id
      LIMIT ${RECENT_ORGANIZATION_LIMIT}
    `,
    mapRows: (rows) => rows.map((row) => row.organization_id),
  });
  return data;
}

export function useSessionCustomer(sessionId: string): SessionCustomer {
  const session = useSession(sessionId);
  const participants = useSessionParticipants(sessionId);
  const humans = useHumans();
  const ownDomains = useOwnDomains();
  const recentOrganizationIds = useRecentOrganizationIds();
  const updateSession = useUpdateSession(sessionId);

  const answered = useSessionCustomerDecision(sessionId);

  const stored = session?.organization_id ?? "";

  const knownContacts = useMemo(
    () =>
      humans.map((human) => ({
        email: human.email,
        organization_id: human.organizationId,
      })),
    [humans],
  );

  const resolverParticipants = useMemo(
    () => selectResolverParticipants(participants),
    [participants],
  );

  const resolution = useMemo(
    () =>
      resolveSessionCustomer({
        participants: resolverParticipants,
        knownContacts,
        ownDomains,
        recentOrganizationIds,
      }),
    [resolverParticipants, knownContacts, ownDomains, recentOrganizationIds],
  );

  const decision = useMemo(
    () =>
      decideSessionCustomer({
        stored,
        resolution,
        dismissed: answered.dismissedSuggestion,
        cleared: answered.cleared,
      }),
    [stored, resolution, answered],
  );

  // Guards against writing the same automatic assignment twice while this
  // session's live query has not yet caught up with a write already in
  // flight. Once it catches up, `stored` is non-empty and `decision.write`
  // goes back to null on its own.
  const writtenRef = useRef<{
    sessionId: string;
    organizationId: string;
  } | null>(null);
  const write = decision.write;
  useEffect(() => {
    if (!write) return;
    if (
      writtenRef.current?.sessionId === sessionId &&
      writtenRef.current.organizationId === write
    ) {
      return;
    }

    writtenRef.current = { sessionId, organizationId: write };
    void updateSession({ organization_id: write }).catch((error) => {
      // The guard only exists to keep one in-flight write from being sent
      // twice; a write that failed was never sent, so releasing it here
      // leaves the assignment to be retried instead of suppressed.
      writtenRef.current = null;
      console.error("[customers] failed to assign session customer", error);
    });
  }, [write, sessionId, updateSession]);

  const assign = useCallback(
    (organizationId: string) => {
      markCustomerAssigned(sessionId);
      void updateSession({ organization_id: organizationId }).catch((error) => {
        console.error("[customers] failed to assign session customer", error);
      });
    },
    [sessionId, updateSession],
  );

  const clear = useCallback(() => {
    markCustomerCleared(sessionId);
    void updateSession({ organization_id: "" }).catch((error) => {
      console.error("[customers] failed to clear session customer", error);
    });
  }, [sessionId, updateSession]);

  const dismissSuggestion = useCallback(() => {
    markSuggestionDismissed(sessionId);
  }, [sessionId]);

  return {
    organizationId: stored,
    suggestion: decision.suggestion,
    assign,
    clear,
    dismissSuggestion,
  };
}
