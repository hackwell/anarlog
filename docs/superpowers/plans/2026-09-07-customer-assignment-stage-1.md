# Customer Assignment (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recorded meeting carries the customer it belongs to, filled from its participants without manual work in the common case, and filterable in the sidebar.

**Architecture:** The customer is an existing `organizations` row, stored on the session in a new `organization_id` column. A pure resolver reads the session's participants, the known contacts, the configured own-domains and the recently used customers, and returns one of four outcomes: assign, suggest, suggest-create, or nothing. An automatic assignment needs known contacts of an organization; where two organizations sit in one meeting the one with more participants wins, and a tie goes to the customer used most recently. Every weaker signal is only a suggestion a person confirms.

**Tech Stack:** SQLite via `plugins/db` with Rust-side migrations (`crates/db-app`), React 19 + Zustand + TanStack Query on the desktop side, live queries through `@anlg/db-react`, lingui for copy, vitest for tests.

**Spec:** `docs/superpowers/specs/2026-09-07-customer-project-assignment-design.md`

## Global Constraints

- The customer is an `organizations` row. No new entity, no free-text customer names.
- **The stored value is the truth.** The resolver never overwrites a value that is already set — not on reopen, not on a participant change, not ever.
- **Assign only on evidence.** Participants who are known contacts with an `organization_id` assign. A bare email-domain match only suggests. A wrongly assigned meeting is worse than an unassigned one, because nobody notices it.
- **Two organizations in one meeting:** the one with more participants wins. On a tie, the customer that was assigned to a session most recently wins.
- The rules run whenever a meeting is opened, old recordings included. There is no batch pass over existing data.
- The customer gets no surface of its own in the sidebar. It sits on the meeting and must be findable through search.
- Public mail providers (gmail.com and friends) never produce a domain match or a create suggestion.
- New SQLite migrations must be downgrade-safe: additive only, new columns nullable or with a DEFAULT (`AGENTS.md`).
- User-visible strings in `apps/desktop` go through lingui (`t` / `<Trans>`), never raw literals.
- `cn` from `@anlg/utils` for conditional classNames, always an array.
- Comments explain "why", not "what". Line length 120, 2-space indent for TS, 4 for Rust. English code and commits, Conventional Commits.
- Scope deviation from the spec, deliberate: the spec's staging mentions "the two session columns" for stage 1, but `project_id` has no consumer until the projects table exists. This plan adds **only** `organization_id`; stage 2 adds `project_id` alongside its table.

---

### Task 1: Store the customer on a session

**Files:**

- Create: `crates/db-app/migrations/20260907120000_session_organization.sql`
- Modify: `crates/db-app/src/lib.rs` (append a `MigrationStep`, after the `20260826120000_session_proposals` entry ending at `:401`)
- Modify: `apps/desktop/src/session/queries/types.ts:5` (`SessionRecord`), `:13-24` (`SessionChanges`)
- Modify: `apps/desktop/src/session/queries/sessions.ts:16-30` (`SessionSqlRow`), the `SELECT` list around `:58`, the update mapping around `:254`, the row mapping around `:359`
- Test: `apps/desktop/src/session/queries/sessions.test.ts` (extend if it exists, create if not)

**Interfaces:**

- Produces: `SessionRecord.organization_id: string` (empty string means unassigned), `SessionChanges` accepting `organization_id`, so `useUpdateSession(id)({ organization_id })` persists it.

- [ ] **Step 1: Write the migration**

`crates/db-app/migrations/20260907120000_session_organization.sql`:

```sql
-- The customer a meeting belongs to, as an organizations.id. Empty means
-- unassigned. Additive with a default so older builds still open the database.
ALTER TABLE sessions ADD COLUMN organization_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON sessions(organization_id);
```

- [ ] **Step 2: Register the migration**

In `crates/db-app/src/lib.rs`, append inside the same array, after the `20260826120000_session_proposals` step:

```rust
anlg_db_migrate::MigrationStep {
    id: "20260907120000_session_organization",
    scope: anlg_db_migrate::MigrationScope::Plain,
    sql: include_str!("../migrations/20260907120000_session_organization.sql"),
},
```

- [ ] **Step 3: Run the Rust checks**

Run: `cargo check -p anlg-db-app`
Run: `cargo test -p anlg-db-app`
Expected: both pass. If the package name differs, take it from `crates/db-app/Cargo.toml`.

- [ ] **Step 4: Write the failing test for the TypeScript plumbing**

In `apps/desktop/src/session/queries/sessions.test.ts`, following whatever harness the file already uses for `updateSession`:

```ts
it("persists a customer on the session", async () => {
  await updateSession("session-1", { organization_id: "org-7" });

  expect(lastWrite()).toMatchObject({
    columns: expect.arrayContaining(["organization_id"]),
    values: expect.arrayContaining(["org-7"]),
  });
});

it("reads the customer back on the session record", () => {
  const record = mapSessionRow({ ...baseRow, organization_id: "org-7" });

  expect(record.organization_id).toBe("org-7");
});
```

Adapt `lastWrite()`, `mapSessionRow` and `baseRow` to the file's existing helpers rather than inventing new ones; if the file has no harness for this, assert against the same seam its neighbouring tests use.

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/session/queries/sessions.test.ts`
Expected: FAIL — `organization_id` is not part of `SessionChanges`, and the mapped record has no such field.

- [ ] **Step 6: Thread the column through**

`types.ts`, in `SessionRecord` next to `folder_id`:

```ts
organization_id: string;
```

and in the `SessionChanges` pick list, alphabetically between `locked` and `raw_md`:

```ts
| "organization_id"
```

`sessions.ts`: add `organization_id: string;` to `SessionSqlRow`, `sessions.organization_id,` to the `SELECT` list, `["organization_id", changes.organization_id],` to the update mapping next to the `folder_path` entry, and `organization_id: row.organization_id,` to the row mapping.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/session/queries/sessions.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
pnpm exec dprint fmt
git add crates/db-app apps/desktop/src/session/queries
git commit -m "$(cat <<'MSG'
feat(db): store the customer a meeting belongs to

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

### Task 2: Email domain helpers

**Files:**

- Create: `apps/desktop/src/customers/domains.ts`
- Test: `apps/desktop/src/customers/domains.test.ts`

**Interfaces:**

- Produces:
  - `export function emailDomain(email: string): string` — lower-cased domain, `""` when the input is not a usable address.
  - `export function isPublicMailProvider(domain: string): boolean`
  - `export function isOwnDomain(domain: string, ownDomains: readonly string[]): boolean`
  - `export const PUBLIC_MAIL_PROVIDERS: readonly string[]`

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/customers/domains.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { emailDomain, isOwnDomain, isPublicMailProvider } from "./domains";

describe("emailDomain", () => {
  it("takes the domain, lower-cased", () => {
    expect(emailDomain("Anna.Weber@Kunde-Mueller.DE")).toBe("kunde-mueller.de");
  });

  it("trims surrounding whitespace", () => {
    expect(emailDomain("  anna@kunde.de  ")).toBe("kunde.de");
  });

  it("returns nothing usable for input that is not an address", () => {
    expect(emailDomain("")).toBe("");
    expect(emailDomain("anna")).toBe("");
    expect(emailDomain("anna@")).toBe("");
    expect(emailDomain("@kunde.de")).toBe("");
    expect(emailDomain("anna@@kunde.de")).toBe("");
  });
});

describe("isPublicMailProvider", () => {
  it("knows the common ones", () => {
    expect(isPublicMailProvider("gmail.com")).toBe(true);
    expect(isPublicMailProvider("GMX.de")).toBe(true);
    expect(isPublicMailProvider("web.de")).toBe(true);
    expect(isPublicMailProvider("outlook.com")).toBe(true);
  });

  it("treats a company domain as private", () => {
    expect(isPublicMailProvider("kunde-mueller.de")).toBe(false);
  });
});

describe("isOwnDomain", () => {
  it("matches case-insensitively", () => {
    expect(isOwnDomain("Flagbit.DE", ["flagbit.de"])).toBe(true);
  });

  it("does not match a different domain", () => {
    expect(isOwnDomain("kunde.de", ["flagbit.de"])).toBe(false);
  });

  it("is false when nothing is configured", () => {
    expect(isOwnDomain("flagbit.de", [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/customers/domains.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helpers**

`apps/desktop/src/customers/domains.ts`:

```ts
// A contact writing from a freemailer says nothing about which company they
// belong to, so these domains never produce a match or a create suggestion.
export const PUBLIC_MAIL_PROVIDERS: readonly string[] = [
  "aol.com",
  "gmail.com",
  "gmx.at",
  "gmx.ch",
  "gmx.de",
  "gmx.net",
  "hotmail.com",
  "hotmail.de",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "outlook.com",
  "outlook.de",
  "posteo.de",
  "proton.me",
  "protonmail.com",
  "t-online.de",
  "web.de",
  "yahoo.com",
  "yahoo.de",
  "yandex.com",
];

const PUBLIC_SET = new Set(PUBLIC_MAIL_PROVIDERS);

export function emailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) {
    return "";
  }

  const [local, domain] = parts;
  return local && domain?.includes(".") ? domain : "";
}

export function isPublicMailProvider(domain: string): boolean {
  return PUBLIC_SET.has(domain.trim().toLowerCase());
}

export function isOwnDomain(
  domain: string,
  ownDomains: readonly string[],
): boolean {
  const needle = domain.trim().toLowerCase();
  return (
    needle !== "" &&
    ownDomains.some((own) => own.trim().toLowerCase() === needle)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/customers/domains.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
pnpm exec dprint fmt
git add apps/desktop/src/customers
git commit -m "$(cat <<'MSG'
feat(customers): email domain helpers for customer matching

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

### Task 3: The resolver

**Files:**

- Create: `apps/desktop/src/customers/resolve.ts`
- Test: `apps/desktop/src/customers/resolve.test.ts`

**Interfaces:**

- Consumes: `emailDomain`, `isOwnDomain`, `isPublicMailProvider` from `./domains` (Task 2).
- Produces:

```ts
export type CustomerParticipant = {
  email: string;
  organization_id: string;
  organization_name: string;
};

export type KnownContact = { email: string; organization_id: string };

export type CustomerResolution =
  | { kind: "assign"; organizationId: string; reason: "known_contact" }
  | { kind: "suggest"; organizationId: string; reason: "domain_match" }
  | { kind: "suggest_create"; domain: string }
  | { kind: "none" };

export function resolveSessionCustomer(input: {
  participants: readonly CustomerParticipant[];
  knownContacts: readonly KnownContact[];
  ownDomains: readonly string[];
  /** Organization ids, most recently assigned to a session first. */
  recentOrganizationIds: readonly string[];
}): CustomerResolution;
```

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/customers/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveSessionCustomer } from "./resolve";

const own = ["flagbit.de"];
const base = { knownContacts: [], ownDomains: own, recentOrganizationIds: [] };

const us = {
  email: "joerg@flagbit.de",
  organization_id: "",
  organization_name: "",
};

const from = (email: string, organizationId = "", name = "") => ({
  email,
  organization_id: organizationId,
  organization_name: name,
});

describe("resolveSessionCustomer", () => {
  it("assigns when a participant is a known contact of an organization", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("anna@kunde.de", "org-mueller", "Müller")],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("gives the meeting to the organization with more participants", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          us,
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("bea@kunde.de", "org-mueller", "Müller"),
          from("cem@agentur.de", "org-agentur", "Agentur"),
        ],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("breaks a tie with the most recently used customer", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          us,
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("cem@agentur.de", "org-agentur", "Agentur"),
        ],
        recentOrganizationIds: ["org-agentur", "org-mueller"],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-agentur",
      reason: "known_contact",
    });
  });

  it("assigns nothing on a tie no recent use can settle", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          us,
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("cem@agentur.de", "org-agentur", "Agentur"),
        ],
      }),
    ).toEqual({ kind: "none" });
  });

  it("only suggests when the domain matches a known contact's organization", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("neu@kunde.de")],
        knownContacts: [
          { email: "anna@kunde.de", organization_id: "org-mueller" },
        ],
      }),
    ).toEqual({
      kind: "suggest",
      organizationId: "org-mueller",
      reason: "domain_match",
    });
  });

  it("suggests creating an organization for an unknown external domain", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("neu@fremd.de")],
      }),
    ).toEqual({ kind: "suggest_create", domain: "fremd.de" });
  });

  it("says nothing for an internal meeting", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("maja@flagbit.de")],
      }),
    ).toEqual({ kind: "none" });
  });

  it("says nothing when there are no participants", () => {
    expect(resolveSessionCustomer({ ...base, participants: [] })).toEqual({
      kind: "none",
    });
  });

  it("never matches or proposes on a freemailer domain", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("anna@gmail.com")],
        knownContacts: [{ email: "bea@gmail.com", organization_id: "org-x" }],
      }),
    ).toEqual({ kind: "none" });
  });

  it("still counts a freemailer participant who is a known contact", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("anna@gmail.com", "org-mueller", "Müller")],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("prefers the counted evidence over a domain inference", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("bea@andere.de"),
        ],
        knownContacts: [
          { email: "cem@andere.de", organization_id: "org-andere" },
        ],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("ignores our own people when they carry an organization", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [from("joerg@flagbit.de", "org-flagbit", "Flagbit")],
      }),
    ).toEqual({ kind: "none" });
  });

  it("falls back to the first external participant when nothing is configured", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [from("anna@kunde.de")],
        ownDomains: [],
      }),
    ).toEqual({ kind: "suggest_create", domain: "kunde.de" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/customers/resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the resolver**

`apps/desktop/src/customers/resolve.ts`:

```ts
import { emailDomain, isOwnDomain, isPublicMailProvider } from "./domains";

export type CustomerParticipant = {
  email: string;
  organization_id: string;
  organization_name: string;
};

export type KnownContact = { email: string; organization_id: string };

export type CustomerResolution =
  | { kind: "assign"; organizationId: string; reason: "known_contact" }
  | { kind: "suggest"; organizationId: string; reason: "domain_match" }
  | { kind: "suggest_create"; domain: string }
  | { kind: "none" };

const NONE: CustomerResolution = { kind: "none" };

export function resolveSessionCustomer(input: {
  participants: readonly CustomerParticipant[];
  knownContacts: readonly KnownContact[];
  ownDomains: readonly string[];
  recentOrganizationIds: readonly string[];
}): CustomerResolution {
  const { participants, knownContacts, ownDomains, recentOrganizationIds } =
    input;

  const external = participants.filter(
    (participant) => !isOwnDomain(emailDomain(participant.email), ownDomains),
  );
  if (external.length === 0) {
    return NONE;
  }

  // Participants the user has already filed under an organization are evidence.
  // Everything below is an inference and only ever suggests.
  const headcount = new Map<string, number>();
  for (const participant of external) {
    const organizationId = participant.organization_id.trim();
    if (organizationId) {
      headcount.set(organizationId, (headcount.get(organizationId) ?? 0) + 1);
    }
  }

  if (headcount.size > 0) {
    const winner = pickOrganization(headcount, recentOrganizationIds);
    if (winner) {
      return {
        kind: "assign",
        organizationId: winner,
        reason: "known_contact",
      };
    }
    // A tie nothing can settle: two customers with equal standing in one
    // meeting, neither used recently. Guessing here would be silently wrong.
    return NONE;
  }

  const organizationByDomain = new Map<string, string>();
  for (const contact of knownContacts) {
    const domain = emailDomain(contact.email);
    if (
      domain &&
      !isPublicMailProvider(domain) &&
      contact.organization_id.trim() !== "" &&
      !organizationByDomain.has(domain)
    ) {
      organizationByDomain.set(domain, contact.organization_id);
    }
  }

  for (const participant of external) {
    const domain = emailDomain(participant.email);
    if (!domain || isPublicMailProvider(domain)) {
      continue;
    }

    const organizationId = organizationByDomain.get(domain);
    if (organizationId) {
      return { kind: "suggest", organizationId, reason: "domain_match" };
    }
  }

  for (const participant of external) {
    const domain = emailDomain(participant.email);
    if (domain && !isPublicMailProvider(domain)) {
      return { kind: "suggest_create", domain };
    }
  }

  return NONE;
}

function pickOrganization(
  headcount: ReadonlyMap<string, number>,
  recentOrganizationIds: readonly string[],
): string | null {
  const best = Math.max(...headcount.values());
  const leaders = [...headcount.entries()]
    .filter(([, count]) => count === best)
    .map(([organizationId]) => organizationId);

  if (leaders.length === 1) {
    return leaders[0] ?? null;
  }

  for (const organizationId of recentOrganizationIds) {
    if (leaders.includes(organizationId)) {
      return organizationId;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/customers/resolve.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
pnpm exec dprint fmt
git add apps/desktop/src/customers
git commit -m "$(cat <<'MSG'
feat(customers): resolve a meeting's customer from its participants

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

### Task 4: The own-domains setting

**Files:**

- Modify: `apps/desktop/src/settings/schema.ts` (add next to the other `["general", …]` entries)
- Create: `apps/desktop/src/customers/own-domains.ts`
- Test: `apps/desktop/src/customers/own-domains.test.ts`
- Modify: the Settings › General page under `apps/desktop/src/settings/general/` — add a row using the file's existing `SettingRow` pattern

**Interfaces:**

- Consumes: `useStoredSettingValue` / `useSetSettingValue` from `~/settings/queries`, `SETTING_DEFINITIONS` from `~/settings/schema`.
- Produces:
  - `export function parseOwnDomains(raw: string): string[]` — tolerant of malformed JSON, always an array.
  - `export function serializeOwnDomains(domains: readonly string[]): string`
  - `export function useOwnDomains(): string[]`

- [ ] **Step 1: Add the setting definition**

In `apps/desktop/src/settings/schema.ts`, alongside the other general entries, following the JSON-in-a-string convention `spoken_languages` already uses:

```ts
own_email_domains: {
  type: "string",
  path: ["general", "own_email_domains"],
  default: "[]" as string,
},
```

- [ ] **Step 2: Write the failing test**

`apps/desktop/src/customers/own-domains.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseOwnDomains, serializeOwnDomains } from "./own-domains";

describe("parseOwnDomains", () => {
  it("reads a stored list", () => {
    expect(parseOwnDomains('["flagbit.de","flagbit.com"]')).toEqual([
      "flagbit.de",
      "flagbit.com",
    ]);
  });

  it("normalizes and drops what is not usable", () => {
    expect(
      parseOwnDomains('["  Flagbit.DE ","","@x",42,"flagbit.de"]'),
    ).toEqual(["flagbit.de"]);
  });

  it("survives malformed storage", () => {
    expect(parseOwnDomains("not json")).toEqual([]);
    expect(parseOwnDomains('{"a":1}')).toEqual([]);
    expect(parseOwnDomains("")).toEqual([]);
  });
});

describe("serializeOwnDomains", () => {
  it("round-trips", () => {
    expect(parseOwnDomains(serializeOwnDomains(["Flagbit.DE"]))).toEqual([
      "flagbit.de",
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/customers/own-domains.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the module**

`apps/desktop/src/customers/own-domains.ts`:

```ts
import { useMemo } from "react";

import { useStoredSettingValue } from "~/settings/queries";

function normalize(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const domain = value.trim().toLowerCase().replace(/^@/, "");
  return domain.includes(".") ? domain : null;
}

export function parseOwnDomains(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  for (const entry of parsed) {
    const domain = normalize(entry);
    if (domain) {
      seen.add(domain);
    }
  }

  return [...seen];
}

export function serializeOwnDomains(domains: readonly string[]): string {
  return JSON.stringify(domains);
}

export function useOwnDomains(): string[] {
  const { value } = useStoredSettingValue("own_email_domains");
  return useMemo(() => parseOwnDomains(value ?? "[]"), [value]);
}
```

`useStoredSettingValue` returns `{ value, hasValue }` (`apps/desktop/src/settings/queries.ts:80-91`), which is why the value is destructured rather than used directly. Keep the returned type `string[]`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/customers/own-domains.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Add the settings row**

In the Settings › General page, add a row letting the user maintain the list. Follow the page's existing `SettingRow` usage and its input conventions; a comma-separated text field that parses through `parseOwnDomains` on blur is enough — do not build a chip editor.

Copy, through lingui:

- Label: `` t`Unsere eigenen E-Mail-Domains` ``
- Description: `` t`Termine, an denen nur diese Domains beteiligt sind, gelten als intern und bekommen keinen Kunden.` ``

- [ ] **Step 7: Run the i18n round-trip**

Run: `pnpm -F desktop exec lingui extract --clean --workers 1`
Fill the German `msgstr` for both new messages in `apps/desktop/src/i18n/locales/de/messages.po`.
Run: `pnpm -F desktop exec lingui compile --strict --workers 1`
Run: `pnpm -F desktop exec lingui extract --clean --workers 1`
Expected: the second extract produces no further diff. Commit the generated `apps/desktop/src/i18n/locales` changes as they are.

- [ ] **Step 8: Commit**

```bash
pnpm exec dprint fmt
git add apps/desktop/src
git commit -m "$(cat <<'MSG'
feat(settings): configure our own email domains

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

### Task 5: Apply the resolution to a session

**Files:**

- Create: `apps/desktop/src/customers/use-session-customer.ts`
- Test: `apps/desktop/src/customers/use-session-customer.test.ts`

**Interfaces:**

- Consumes: `resolveSessionCustomer`, `CustomerResolution` (Task 3); `useOwnDomains` (Task 4); the recently used customers (a live query over `sessions` with a non-empty `organization_id`, most recent first, capped at 20 — feeds `recentOrganizationIds`); `useSessionParticipants` from `~/session/queries/participants` (its rows already carry `email`, `organization_id` and `organization_name`); `useHumans` from `~/contacts/queries`; `useSession` and `useUpdateSession` from `~/session/queries`; `organization_id` on the session (Task 1).
- Produces:

```ts
export type SessionCustomer = {
  organizationId: string; // "" when unassigned
  suggestion: CustomerResolution | null; // null when there is nothing to offer
  assign: (organizationId: string) => void;
  dismissSuggestion: () => void;
};

export function useSessionCustomer(sessionId: string): SessionCustomer;
```

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/customers/use-session-customer.test.ts` — test the decision, not React. Extract the decision into a pure function and test that; the hook is then a thin wrapper.

```ts
import { describe, expect, it } from "vitest";

import { decideSessionCustomer } from "./use-session-customer";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/customers/use-session-customer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the decision and the hook**

`apps/desktop/src/customers/use-session-customer.ts` — the decision first, as a pure function:

```ts
export function decideSessionCustomer(input: {
  stored: string;
  resolution: CustomerResolution;
  dismissed: boolean;
}): { write: string | null; suggestion: CustomerResolution | null } {
  // A stored customer is a person's answer, even when it came from an earlier
  // automatic assignment. Nothing recomputes over it.
  if (input.stored.trim() !== "") {
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
```

Then the hook around it: read the session, its participants, the known contacts (`useHumans`, mapped to `{ email, organization_id }`) and `useOwnDomains`; call `resolveSessionCustomer`; call `decideSessionCustomer`; and when `write` is non-null, persist it once with `useUpdateSession(sessionId)({ organization_id: write })` from an effect guarded so it fires once per session and value. Keep the dismissal in component state — it does not need to outlive the session view.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/customers/use-session-customer.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
pnpm exec dprint fmt
git add apps/desktop/src/customers
git commit -m "$(cat <<'MSG'
feat(customers): assign on evidence, suggest on inference

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

### Task 6: The customer control in the session header

**Files:**

- Create: `apps/desktop/src/session/components/customer-picker.tsx`
- Test: `apps/desktop/src/session/components/customer-picker.test.tsx`
- Modify: `apps/desktop/src/session/components/outer-header/index.tsx:106` (add beside the existing `FolderPicker`)

**Interfaces:**

- Consumes: `useSessionCustomer` (Task 5), `useOrganizations` from `~/contacts/queries`.
- Produces: `export function CustomerPicker({ sessionId, align }: { sessionId: string; align?: "start" | "end" })`

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/session/components/customer-picker.test.tsx`, mocking `~/customers/use-session-customer` and `~/contacts/queries` the way the neighbouring header tests mock their data hooks:

```tsx
it("shows the assigned customer", () => {
  render(<CustomerPicker sessionId="s1" />);

  expect(screen.getByText("Müller")).toBeTruthy();
});

it("offers a suggestion and assigns it when confirmed", async () => {
  render(<CustomerPicker sessionId="s1" />);

  const suggestion = await screen.findByRole("button", { name: /Müller/ });
  suggestion.click();

  expect(assign).toHaveBeenCalledWith("org-mueller");
});

it("stops offering after the suggestion is dismissed", async () => {
  render(<CustomerPicker sessionId="s1" />);

  (await screen.findByRole("button", { name: /verwerfen|dismiss/i })).click();

  expect(dismissSuggestion).toHaveBeenCalled();
});
```

Adapt the queries to the mocked shapes; assert behaviour, not markup.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/session/components/customer-picker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the control**

Model it on `apps/desktop/src/session/components/folder-picker.tsx`: a `Popover` with a `Command` list of organizations, filtered by typing, plus a "create" entry when the typed name matches none. Three states:

- assigned → the organization's name, clicking opens the list to change it
- unassigned with a suggestion → the proposed name as a chip with a confirm and a dismiss affordance, matching how tag suggestions are already presented in the header
- unassigned without a suggestion → a quiet placeholder that opens the list

Copy, through lingui: `` t`Kunde` `` as the placeholder, `` t`Kunde zuordnen` `` as the trigger's accessible name, `` t`Vorschlag verwerfen` `` for the dismiss control, and `` t`"${domain}" als Kunde anlegen` `` for the create entry.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/session/components/customer-picker.test.tsx`
Expected: PASS

- [ ] **Step 5: Place it in the header**

In `apps/desktop/src/session/components/outer-header/index.tsx`, render `<CustomerPicker sessionId={sessionId} align="end" />` immediately before the existing `<FolderPicker … />`. Folders stay for now; stage 2 removes them.

- [ ] **Step 6: Run the i18n round-trip and the desktop checks**

Run: `pnpm -F desktop exec lingui extract --clean --workers 1`, fill the German `msgstr` entries, `pnpm -F desktop exec lingui compile --strict --workers 1`, then extract again until stable.
Run: `pnpm -F desktop typecheck`
Run: `pnpm -F desktop test`
Run: `pnpm exec oxlint --quiet --format=github apps/desktop/src/`
Expected: green.

- [ ] **Step 7: Commit**

```bash
pnpm exec dprint fmt
git add apps/desktop/src
git commit -m "$(cat <<'MSG'
feat(session): show and assign a meeting's customer

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

### Task 7: Make the customer findable through search

**Files:**

- Modify: the session search indexing path (`apps/desktop/src/**` — find it from `search_index_dirty` / `search_index_state` usage, and from the `plugins/tantivy` consumer)
- Test: alongside the indexing code's existing tests

**Interfaces:**

- Consumes: `sessions.organization_id` (Task 1), `useOrganizations` from `~/contacts/queries` for the name.

The sidebar deliberately gets no customer surface. The customer lives on the meeting, so search is the only way to reach it — which makes this task the one that decides whether stage 1 is useful at all.

- [ ] **Step 1: Find the indexing seam**

Run: `grep -rn "search_index_dirty\|search_index_state" apps/desktop/src crates plugins --include="*.ts" --include="*.rs" | head -20`

Read whichever module assembles a session's indexed text. Report in your notes which file it is before changing anything.

- [ ] **Step 2: Write the failing test**

Assert at that module's own seam that a session assigned to an organization contributes the organization's **name** to its indexed text, and that an unassigned session's indexed text is unchanged from today. Follow the file's existing test harness; do not build a new one.

- [ ] **Step 3: Run the test to verify it fails**

Run the focused test file for that module.
Expected: FAIL — the organization name is not part of the indexed text.

- [ ] **Step 4: Add the customer name to the indexed text**

Join the organization name into the session's indexed text. Index the **name**, not the id: nobody searches for `org-7`. A session whose organization no longer exists contributes nothing extra and must not throw.

- [ ] **Step 5: Run the test to verify it passes**

Expected: PASS

- [ ] **Step 6: Run the full checks**

Run: `pnpm -F desktop typecheck`
Run: `pnpm -F desktop test`
Run: `pnpm exec oxlint --quiet --format=github apps/desktop/src/`
Run: `pnpm -F desktop i18n:check`
Run: `pnpm exec dprint fmt && pnpm fmt:check`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "$(cat <<'MSG'
feat(search): find meetings by their customer

Claude-Session: https://claude.ai/code/session_01P6ex7vfLmxLKM3LjCmPGin
MSG
)"
```

---

## Manual verification (after Task 7)

The rules depend on real calendar data, which no test in this repo carries. Check by hand in `turbo dev:desktop`:

1. Open a past meeting with an external participant who is already a contact of an organization. The customer appears by itself, without asking.
2. Open a meeting with an external participant whose domain matches a contact's organization but who is not a contact. A suggestion appears; confirming it assigns, dismissing it leaves the meeting unassigned and stays quiet on reopen.
3. Open a meeting whose only participants are on your own domains. Nothing is shown and nothing is assigned.
4. Change the customer of an already assigned meeting, close it, reopen it. The change survives — nothing recomputes over it.
5. Add a gmail.com participant to a meeting. No customer is proposed from it.
6. Search for a customer's name. Their meetings appear, including one whose title never mentions them.
7. Open a meeting with two external organizations, two people from one and one from the other. The larger one is assigned.
