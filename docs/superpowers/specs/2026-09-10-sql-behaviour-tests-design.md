# Testing the SQL We Actually Run — Design

## Problem

The desktop app's queries live as template strings in TypeScript and are executed
by `liveQueryClient`. Every test mocks that client, so a query's **text** is
never run against a database. What the tests check is the mapping code around a
hand-written fixture, and the fixture is written from the author's belief about
what SQLite returns.

That belief was wrong twice this week, and both times production paid.

**The delta-aware snapshot (`1.10.1`, `1.10.2`).** `SESSION_CONTENT_SQL` reads
the transcript journal through a `json_group_array` nested inside a
`json_object`. Nested that way, SQLite keeps the JSON subtype through the
`COALESCE` and returns a **parsed array**, not text. The mapping code called
`JSON.parse` on it, which stringifies first — to `""` when empty and to
`"[object Object]"` when not. Every snapshot load logged a syntax error and
silently dropped every pending word, which is exactly the blind spot that change
existed to close. The unit test passed throughout, because its fixture said
`pending_deltas_json: JSON.stringify([...])` where SQLite produces an array. Two
releases shipped a feature that never once worked, and Sentry — not the test
suite — found it (`SESSIONECHO-3` through `-6`).

**The customer search and the auto-enhance gate.** Both were verified by running
their SQL by hand against the user's production database, because there was no
other way to know whether they were right. That is not a repeatable check, and it
required a real user's real data.

The pattern: mocks test the code around a query. Nothing tests the query.

## Goals

- A query's real behaviour — shapes, JSON subtypes, joins, collation, `NULL`
  handling — is exercised in the ordinary test run.
- A schema change that breaks a query fails a test rather than a user's session.
- No production data needed, no manual verification step, no new dependency.

## Non-goals

- Replacing the existing mock-based tests. They cover the mapping and error
  handling well, and they are fast. This adds a layer, it does not remove one.
- Testing every query. The point is the ones whose shape is not obvious:
  nested aggregates, JSON functions, outer joins, window functions.
- A second migration runner. The tests apply the real migration files in the
  real order or they prove nothing.

## Design

### The engine

Node 22 ships `node:sqlite`, so the test suite can open a real database with no
dependency added to the workspace. It reproduces the exact behaviour that caused
the shipped bug — verified before writing this:

```
SELECT json_group_array(json_object('id','x','pending', COALESCE((…),'[]')))
->  [{"id":"x","pending":[{"new_words":[…]}]}]      // an array, not a string
```

A test written against this would have failed on the day the bug was written.

### The harness

One helper, `withTestDatabase()`, that:

1. opens an in-memory database,
2. applies every `crates/db-app/migrations/*.sql` in filename order — the same
   files the Rust side registers, read from disk, never a copy,
3. exposes an `execute(sql, params)` with the same shape `liveQueryClient`
   returns, so a test can hand the real query the real engine and pass the rows
   straight into the existing mapping function.

Point 2 is what makes this worth building: it also turns every migration into
something the TypeScript suite notices. A column renamed in Rust breaks the
query that reads it, in CI, on the commit that renames it.

### What gets covered first

In descending order of how badly a wrong answer hurts:

- `SESSION_CONTENT_SQL` (`session/content-queries.ts`) — feeds roughly twelve
  readers including every AI path. This is where the shipped bug was.
- `TRANSCRIPT_COLUMNS` and the mutation loop (`stt/queries.ts`) — the live
  display and the compare-and-set fold.
- `STRANDED_TRANSCRIPTS_SQL` (`stt/transcript-compaction-sweep.ts`) — currently
  verified only by a one-off manual run against production.
- The pending-auto-enhance gate (`services/enhancer/storage.ts`).
- The timeline query (`calendar/queries.ts`) — recently gained a join.

### What a test looks like

Insert the rows the query is supposed to find, run the query through the harness,
assert on what the mapping function produces. No fixture describing what SQLite
was believed to return, because SQLite is answering.

## Risks

- **`node:sqlite` is marked experimental.** It prints a warning and its API may
  move. The mitigation is that the harness is one file: if it has to become
  `better-sqlite3` later, one file changes.
- **The bundled SQLite version may differ from the app's.** Behaviour that
  depends on a version-specific JSON detail could pass here and fail there. Worth
  asserting the version in the harness so a divergence is visible.
- **Slower tests.** Applying 63 migrations per test file is not free; the harness
  should build the schema once per file and reset data between tests.
- **A false sense of coverage.** These tests prove the query does what the test
  says on this schema. They do not prove the query is the right question to ask.
