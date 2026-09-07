import { describe, expect, it } from "vitest";

import { resolveSessionCustomer } from "./resolve";
import {
  decideSessionCustomer,
  dedupeParticipants,
  selectResolverParticipants,
} from "./use-session-customer";

import type { SessionParticipantRecord } from "~/session/queries";

const assignResolution = {
  kind: "assign",
  organizationId: "org-mueller",
  reason: "known_contact",
} as const;

describe("decideSessionCustomer", () => {
  it("writes the assignment when the session has none", () => {
    expect(
      decideSessionCustomer({
        stored: "",
        resolution: assignResolution,
        dismissed: false,
      }),
    ).toEqual({ write: "org-mueller", suggestion: null });
  });

  it("never overwrites a stored customer", () => {
    expect(
      decideSessionCustomer({
        stored: "org-andere",
        resolution: assignResolution,
        dismissed: false,
      }),
    ).toEqual({ write: null, suggestion: null });
  });

  it("offers a suggestion instead of writing it", () => {
    const resolution = {
      kind: "suggest",
      organizationId: "org-mueller",
      reason: "domain_match",
    } as const;

    expect(
      decideSessionCustomer({ stored: "", resolution, dismissed: false }),
    ).toEqual({ write: null, suggestion: resolution });
  });

  it("stays quiet once the suggestion was dismissed", () => {
    const resolution = {
      kind: "suggest_create",
      domain: "fremd.de",
    } as const;

    expect(
      decideSessionCustomer({ stored: "", resolution, dismissed: true }),
    ).toEqual({ write: null, suggestion: null });
  });

  it("has nothing to say for an internal meeting", () => {
    expect(
      decideSessionCustomer({
        stored: "",
        resolution: { kind: "none" },
        dismissed: false,
      }),
    ).toEqual({ write: null, suggestion: null });
  });
});

function participant(
  overrides: Partial<SessionParticipantRecord>,
): SessionParticipantRecord {
  return {
    id: "participant-1",
    sessionId: "session-1",
    humanId: "",
    source: "auto",
    name: "",
    email: "",
    jobTitle: "",
    linkedinUsername: "",
    organizationId: "",
    organizationName: "",
    ...overrides,
  };
}

describe("dedupeParticipants", () => {
  it("collapses a repeated participant by human_id", () => {
    const anna = participant({ humanId: "human-anna", email: "anna@kunde.de" });

    expect(dedupeParticipants([anna, anna])).toEqual([anna]);
  });

  it("collapses a repeated participant by lower-cased email when human_id is empty", () => {
    const upper = participant({ email: "Anna@Kunde.de" });
    const lower = participant({ email: "anna@kunde.de" });

    expect(dedupeParticipants([upper, lower])).toEqual([upper]);
  });

  it("keeps participants with neither human_id nor email as separate entries", () => {
    const first = participant({});
    const second = participant({ id: "participant-2" });

    expect(dedupeParticipants([first, second])).toEqual([first, second]);
  });

  it("yields the same resolution whether a participant is listed once or twice", () => {
    // A calendar invite that lists the same person twice must not let their
    // organization silently outnumber a genuine one-against-one tie.
    const us = participant({ humanId: "human-us", email: "joerg@flagbit.de" });
    const anna = participant({
      humanId: "human-anna",
      email: "anna@kunde.de",
      organizationId: "org-mueller",
      organizationName: "Müller",
    });
    const fritz = participant({
      id: "participant-3",
      humanId: "human-fritz",
      email: "fritz@agentur.de",
      organizationId: "org-agentur",
      organizationName: "Agentur",
    });

    const resolveWith = (participants: SessionParticipantRecord[]) =>
      resolveSessionCustomer({
        participants: selectResolverParticipants(participants),
        knownContacts: [],
        ownDomains: ["flagbit.de"],
        recentOrganizationIds: [],
      });

    const once = resolveWith([us, anna, fritz]);
    const twice = resolveWith([us, anna, anna, fritz]);

    expect(twice).toEqual(once);
    expect(twice.kind).toBe("none");
  });
});
