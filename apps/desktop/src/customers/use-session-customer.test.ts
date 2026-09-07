import { describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  capturedSql: null as string | null,
  capturedMapRows: null as
    | ((rows: Array<Record<string, unknown>>) => unknown)
    | null,
}));

vi.mock("~/db", () => ({
  executeTransaction: vi.fn(),
  liveQueryClient: { execute: vi.fn() },
  useLiveQuery: (options: {
    sql: string;
    mapRows?: (rows: Array<Record<string, unknown>>) => unknown;
  }) => {
    dbMocks.capturedSql = options.sql;
    dbMocks.capturedMapRows = options.mapRows ?? null;
    return { data: undefined };
  },
}));

import { resolveSessionCustomer } from "./resolve";
import {
  decideSessionCustomer,
  dedupeParticipants,
  selectResolverParticipants,
  useRecentOrganizationIds,
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
    // A calendar invite's two rows for the same person rarely agree on
    // anything but the human_id — different row ids, sometimes a different
    // display name (nickname vs. full name).
    const anna = participant({
      humanId: "human-anna",
      email: "anna@kunde.de",
      name: "Anna",
    });
    const annaAgain = participant({
      id: "participant-2",
      humanId: "human-anna",
      email: "anna@kunde.de",
      name: "Anna Müller",
    });

    expect(dedupeParticipants([anna, annaAgain])).toEqual([anna]);
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

describe("useRecentOrganizationIds", () => {
  it("groups by organization in a subquery the outer LIMIT sits outside of", () => {
    // The cap must count organizations, not session rows — an organization
    // whose one meeting predates twenty other, unrelated sessions still has
    // to reach the tie-break. That only holds if grouping happens before the
    // LIMIT, so this pins the query's shape: the raw `sessions` table is
    // read and grouped by `organization_id` first, and only that grouped
    // result is capped.
    useRecentOrganizationIds();
    const sql = dbMocks.capturedSql;
    if (!sql) {
      throw new Error(
        "useRecentOrganizationIds did not send a query to useLiveQuery",
      );
    }

    const fromSessions = sql.indexOf("FROM sessions");
    const groupBy = sql.indexOf("GROUP BY organization_id");
    const limit = sql.indexOf("LIMIT");

    expect(fromSessions).toBeGreaterThan(-1);
    expect(groupBy).toBeGreaterThan(fromSessions);
    expect(limit).toBeGreaterThan(groupBy);
  });

  it("keeps an older organization's id alongside twenty newer sessions from a different one", () => {
    // This vitest suite has no SQLite engine behind `useLiveQuery` (it is
    // mocked, like every other live-query hook's test in this codebase), so
    // the SQL text itself cannot be executed here — the shape test above
    // is what actually guards the query. This test instead computes, by
    // hand, what the query's `GROUP BY organization_id` / `MAX(created_at)`
    // / `ORDER BY ... DESC` is specified to produce for this table — one row
    // per organization, holding its most recent session, most recent first
    // — and confirms the hook forwards that list, including the older
    // organization, unchanged.
    const sessions = [
      ...Array.from({ length: 20 }, (_, day) => ({
        organizationId: "org-frequent",
        createdAt: new Date(Date.UTC(2026, 7, day + 1)).toISOString(),
      })),
      {
        organizationId: "org-occasional",
        createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      },
    ];

    const lastUsedAt = new Map<string, string>();
    for (const session of sessions) {
      const current = lastUsedAt.get(session.organizationId);
      if (current === undefined || session.createdAt > current) {
        lastUsedAt.set(session.organizationId, session.createdAt);
      }
    }
    const groupedAndOrderedRows = [...lastUsedAt.entries()]
      .sort(([, a], [, b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([organization_id]) => ({ organization_id }));

    useRecentOrganizationIds();
    const mapRows = dbMocks.capturedMapRows;
    if (!mapRows) {
      throw new Error(
        "useRecentOrganizationIds did not send a query to useLiveQuery",
      );
    }

    const recentOrganizationIds = mapRows(groupedAndOrderedRows);

    expect(recentOrganizationIds).toEqual(["org-frequent", "org-occasional"]);
  });
});
