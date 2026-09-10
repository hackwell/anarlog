# Testing the SQL We Actually Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The queries the app really runs are executed against a real SQLite carrying the real migrations, in the ordinary test run.

**Architecture:** A second vitest project named `sql` runs `*.sql.test.ts` in the `node` environment, because `node:sqlite` cannot be bundled for jsdom and the shared jsdom setup cannot load without a DOM. A harness applies every migration in the order the Rust side registers them and hands back an `execute` with the same shape `liveQueryClient` returns, so a test feeds the real query text to a real engine and passes the rows into the existing mapping function unchanged.

**Tech Stack:** vitest 4 (`test.projects`), `node:sqlite` (built into Node 22 — no dependency added), the migration files in `crates/db-app/migrations/`.

**Spec:** `docs/superpowers/specs/2026-09-10-sql-behaviour-tests-design.md`

## Verified before writing this plan

- All 63 migrations apply cleanly in `node:sqlite`, producing 58 tables.
- `node:sqlite` reproduces the exact behaviour that caused the shipped bug: a
  `json_group_array` nested inside a `json_object` comes back as a parsed array,
  not as text.
- The migration ids registered in `crates/db-app/src/lib.rs` are the same set as
  the files on disk but **not** in the same order — two e2ee migrations are
  registered earlier than their filenames sort. The harness follows the Rust
  order, because that is the order a real database is built in.
- A `node`-environment vitest project runs alongside the existing jsdom one
  under one `pnpm -F desktop test`, leaving all 3047 existing tests green.

## Global Constraints

- No new dependency. `node:sqlite` ships with Node 22.
- The harness reads the real migration files. It never carries a copy of the
  schema.
- A test asserts on what a mapping function produces from real rows, never on a
  hand-written fixture describing what SQLite was believed to return.
- Existing mock-based tests stay. This adds a layer.
- Verification: `pnpm exec dprint fmt`, `pnpm -F desktop typecheck`,
  `pnpm -F desktop test`, `pnpm exec oxlint --quiet --format=github apps/desktop/src/`.

---

### Task 1: The vitest project split

**Files:** Modify `apps/desktop/vite.config.ts:54-62`

- [ ] **Step 1:** Move `environment` and `setupFiles` out of the root `test`
      block into a `ui` project, and add a `sql` project with
      `environment: "node"`, `setupFiles: []` and
      `include: ["**/*.sql.test.ts"]`. The `ui` project excludes
      `**/*.sql.test.ts`. Both use `extends: true`.
- [ ] **Step 2:** `pnpm -F desktop test` — the existing suite must stay green
      and the counts must not drop.

### Task 2: The harness

**Files:** Create `apps/desktop/src/test/sqlite.ts`

**Produces:** `createTestDatabase(): { execute<T>(sql: string, params?: unknown[]): T[]; exec(sql: string): void; close(): void }`

- [ ] **Step 1:** Read the migration ids from `crates/db-app/src/lib.rs` in
      registration order (`id: "…"`), resolve each to
      `crates/db-app/migrations/<id>.sql`, and throw naming the id if a file is
      missing — that mismatch is worth failing on.
- [ ] **Step 2:** Open an in-memory database, `PRAGMA foreign_keys=ON`, apply
      every migration in that order.
- [ ] **Step 3:** `execute` returns rows as plain objects, matching what
      `liveQueryClient.execute` gives the mapping code.
- [ ] **Step 4:** A test for the harness itself: the schema has the tables the
      app expects (`sessions`, `transcripts`, `transcript_live_deltas`), and the
      registered id list matches the files on disk.

### Task 3: The query that shipped broken

**Files:** Create `apps/desktop/src/session/content-queries.sql.test.ts`

- [ ] **Step 1:** Insert a session, a note document, a transcript with one word
      in `words_json`, and two journal rows.
- [ ] **Step 2:** Run `SESSION_CONTENT_SQL` through the harness and pass the row
      to `loadSessionContentSnapshot`'s mapping — export the mapper if it is not
      already reachable, rather than duplicating it in the test.
- [ ] **Step 3:** Assert the transcript's `words` contain the journal's words,
      that `wordsJson` is still the stored text, and that
      `hasUnpersistedWords` is true. This is the assertion that was false in
      production for two releases.
- [ ] **Step 4:** A second case with no journal rows: `hasUnpersistedWords`
      false and `words` unchanged.

### Task 4: The queries verified only by hand so far

**Files:** Create `apps/desktop/src/stt/transcript-compaction-sweep.sql.test.ts`
and `apps/desktop/src/services/enhancer/storage.sql.test.ts`

- [ ] **Step 1:** `STRANDED_TRANSCRIPTS_SQL`: a transcript with journal rows and
      an old `updated_at` is found; one inside the quiet period is not; a
      soft-deleted transcript is not.
- [ ] **Step 2:** The pending-auto-enhance gate: a session whose words are only
      in the journal is admitted, one with neither is not.
- [ ] **Step 3:** Commit.
