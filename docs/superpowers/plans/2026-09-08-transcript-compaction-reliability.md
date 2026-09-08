# Transcript Compaction Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recording never ends with its words stranded in the live journal, and the readers behind the shared session snapshot see the same transcript the live display shows.

**Architecture:** Three independent layers over the existing journal. (1) The end-of-capture compaction stops being gated by the live-write timeout and gets its own deadline and bounded retry. (2) A reconciliation sweep, mounted with the other app-level services, folds any transcript that still has journal rows and no running capture. (3) The shared session snapshot and the auto-enhance gate become delta-aware, reusing the merge the live path already implements instead of defining a second one.

**Tech Stack:** TypeScript, React, vitest, SQLite through `plugins/db` (`liveQueryClient`), `@anlg/plugin-transcription` listener commands.

**Spec:** `docs/superpowers/specs/2026-09-08-transcript-compaction-reliability-design.md`

## Global Constraints

- No schema change. `transcripts`, `transcript_live_state` and `transcript_live_deltas` keep their current shape; no migration is added.
- No change to the live display path (`useSessionTranscripts` / `mapTranscriptRow`), which is already correct.
- Never define a second transcript merge. Any code that needs words-plus-pending-deltas calls `materializeTranscriptSnapshot` (in `apps/desktop/src/stt/queries.ts` until Task 3 moves it to `apps/desktop/src/stt/transcript-snapshot.ts`), which coalesces the deltas and applies them through `applyLiveTranscriptDelta`.
- The sweep must never touch a transcript whose capture is running. Exclusion is by listener capture snapshot **and** a quiet period on `transcript_live_state.updated_at`.
- No new dependencies.
- All user-visible copy and all source strings in English.
- Every retry has a ceiling: a bounded attempt count, not a loop that runs until it succeeds.
- Verification before each commit: `pnpm exec dprint fmt`, `pnpm -F desktop typecheck`, `pnpm -F desktop test`, `pnpm exec oxlint --quiet --format=github apps/desktop/src/`.

---

### Task 1: Compaction gets its own attempt

The end-of-capture compaction currently runs only `if (!timedOut && options.afterFlush)`, and the drain loop `return`s out of `flush` before reaching it when the flush deadline trips. Both make a single stall during an hour of recording permanently disable the fold — the defect that stranded 7289 words in the user's database. A stall in the live write path says nothing about whether compaction can succeed afterwards.

**Files:**

- Modify: `apps/desktop/src/stt/transcript-persistence-worker.ts:17-40` (constants and options), `:203-234` (the flush tail)
- Test: `apps/desktop/src/stt/transcript-persistence-worker.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `createTranscriptPersistenceWorker(persist, onError, options)` where `options` gains two optional numbers, `compactionTimeoutMs?: number` and `compactionAttempts?: number`. Behaviour change: `options.afterFlush` now runs on every `flush()`, including after a persist or flush timeout.

- [ ] **Step 1: Write the failing tests**

Append these four tests inside the existing `describe("createTranscriptPersistenceWorker", …)` block in `apps/desktop/src/stt/transcript-persistence-worker.test.ts`, after `"bounds flush independently of the persist deadline"`:

```ts
it("compacts even after a persist timeout disabled the live write path", async () => {
  vi.useFakeTimers();
  const persist = vi.fn(() => new Promise<void>(() => {}));
  const onError = vi.fn();
  const afterFlush = vi.fn(async () => {});
  const worker = createImmediateTranscriptPersistenceWorker(persist, onError, {
    persistTimeoutMs: 50,
    flushTimeoutMs: 1_000,
    afterFlush,
  });

  worker.enqueue(delta("word-1"));
  const flushed = worker.flush();
  await vi.advanceTimersByTimeAsync(50);

  await expect(flushed).resolves.toBeUndefined();
  expect(afterFlush).toHaveBeenCalledOnce();
});

it("compacts even after the flush deadline expired", async () => {
  vi.useFakeTimers();
  const persist = vi.fn(() => new Promise<void>(() => {}));
  const onError = vi.fn();
  const afterFlush = vi.fn(async () => {});
  const worker = createImmediateTranscriptPersistenceWorker(persist, onError, {
    persistTimeoutMs: 1_000,
    flushTimeoutMs: 25,
    afterFlush,
  });

  worker.enqueue(delta("word-1"));
  const flushed = worker.flush();
  await vi.advanceTimersByTimeAsync(25);

  await expect(flushed).resolves.toBeUndefined();
  expect(afterFlush).toHaveBeenCalledOnce();
});

it("retries a failing compaction and reports only the last failure", async () => {
  const onError = vi.fn();
  const afterFlush = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("changed too frequently"))
    .mockResolvedValueOnce(undefined);
  const worker = createImmediateTranscriptPersistenceWorker(
    async () => {},
    onError,
    { afterFlush },
  );

  await worker.flush();

  expect(afterFlush).toHaveBeenCalledTimes(2);
  expect(onError).not.toHaveBeenCalled();
});

it("gives up on compaction after its attempt ceiling", async () => {
  const onError = vi.fn();
  const afterFlush = vi
    .fn<() => Promise<void>>()
    .mockRejectedValue(new Error("changed too frequently"));
  const worker = createImmediateTranscriptPersistenceWorker(
    async () => {},
    onError,
    { afterFlush, compactionAttempts: 2 },
  );

  await worker.flush();

  expect(afterFlush).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "changed too frequently" }),
  );
});

it("bounds a hung compaction by its own deadline", async () => {
  vi.useFakeTimers();
  const onError = vi.fn();
  const afterFlush = vi.fn(() => new Promise<void>(() => {}));
  const worker = createImmediateTranscriptPersistenceWorker(
    async () => {},
    onError,
    { afterFlush, compactionTimeoutMs: 30, compactionAttempts: 1 },
  );

  const flushed = worker.flush();
  await vi.advanceTimersByTimeAsync(30);

  await expect(flushed).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "Transcript compaction timed out after 30ms",
    }),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F desktop exec vitest run src/stt/transcript-persistence-worker.test.ts`
Expected: the first two FAIL (`afterFlush` never called), the retry tests FAIL (`afterFlush` called once), the deadline test FAIL (`onError` never called with that message). The nine pre-existing tests must still PASS.

- [ ] **Step 3: Add the compaction constants and options**

In `apps/desktop/src/stt/transcript-persistence-worker.ts`, after `const TRANSCRIPT_FLUSH_TIMEOUT_MS = 20_000;` add:

```ts
const TRANSCRIPT_COMPACTION_TIMEOUT_MS = 20_000;
const TRANSCRIPT_COMPACTION_ATTEMPTS = 3;
```

Extend the options type (currently `afterFlush`, `batchWindowMs`, `persistTimeoutMs`, `flushTimeoutMs`) with:

```ts
compactionTimeoutMs?: number;
compactionAttempts?: number;
```

and, next to the existing `const flushTimeoutMs = …` line:

```ts
const compactionTimeoutMs =
  options.compactionTimeoutMs ?? TRANSCRIPT_COMPACTION_TIMEOUT_MS;
const compactionAttempts =
  options.compactionAttempts ?? TRANSCRIPT_COMPACTION_ATTEMPTS;
```

- [ ] **Step 4: Add the compaction runner**

In the same file, after the `stopAfterTimeout` helper, add:

```ts
// The live write path and the end-of-capture fold fail independently: a
// stalled delta write says nothing about whether the journal can be folded
// afterwards, so compaction gets its own deadline instead of inheriting the
// flush budget the drain may already have spent.
const compactWithinDeadline = (afterFlush: () => Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new TranscriptPersistenceTimeoutError(
          `Transcript compaction timed out after ${compactionTimeoutMs}ms`,
        ),
      );
    }, compactionTimeoutMs);
    Promise.resolve()
      .then(afterFlush)
      .then(
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timeoutId);
          reject(error as Error);
        },
      );
  });
const compact = async (afterFlush: () => Promise<void>) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= compactionAttempts; attempt += 1) {
    try {
      await compactWithinDeadline(afterFlush);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  reportError(lastError);
};
```

- [ ] **Step 5: Run compaction unconditionally at the end of flush**

In `flush`, replace the drain loop's early `return` on a flush timeout with `break`, so the timeout ends draining without skipping the fold:

```ts
if (result === flushTimedOut) {
  stopAfterTimeout(
    new TranscriptPersistenceTimeoutError(
      `Transcript persistence flush timed out after ${flushTimeoutMs}ms`,
    ),
  );
  break;
}
```

Then replace the whole `if (!timedOut && options.afterFlush) { … }` block that follows the loop with:

```ts
if (options.afterFlush) {
  await compact(options.afterFlush);
}
```

The `flushTimedOut` symbol and the shared `timeout` promise stay as they are — they still bound draining.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -F desktop exec vitest run src/stt/transcript-persistence-worker.test.ts`
Expected: PASS, all fourteen. The two pre-existing timeout tests must still assert `onError` called exactly once — they pass no `afterFlush`, so nothing new fires for them.

- [ ] **Step 7: Verify the capture-lifecycle contract still holds**

Run: `pnpm -F desktop exec vitest run src/stt/useStartListening.test.ts`
Expected: PASS. `flushLiveTranscriptDeltasToDatabaseMock` is still called with the transcript id (`useStartListening.test.ts:2576`); a transcript write failure still sets `transcriptWriteError`, so `getPostCaptureRepairReasons` still reports `transcript_persistence_failed` and batch repair is still requested. Compaction folding what did reach the journal does not make the capture look healthy.

- [ ] **Step 8: Commit**

```bash
pnpm exec dprint fmt
pnpm -F desktop typecheck
pnpm exec oxlint --quiet --format=github apps/desktop/src/
git add apps/desktop/src/stt/transcript-persistence-worker.ts apps/desktop/src/stt/transcript-persistence-worker.test.ts
git commit -m "fix(stt): run end-of-capture compaction even after a write stall"
```

---

### Task 2: Reconciliation sweep

The load-bearing part of the fix. Task 1 closes the two defects we found; the sweep covers the ones we have not — a crash, a force-quit, a power loss, a future edge in the capture state machine. A transcript with journal rows and no running capture is by definition one that should have been compacted already.

**Files:**

- Create: `apps/desktop/src/stt/transcript-compaction-sweep.ts`
- Create: `apps/desktop/src/stt/transcript-compaction-sweep.test.ts`
- Modify: `apps/desktop/src/main/lifecycle.tsx:43-60` (`ClassicMainServices` and its sibling wrapper components)

**Interfaces:**

- Consumes: `flushLiveTranscriptDeltasToDatabase(transcriptId: string): Promise<void>` from `~/stt/queries` (it is `mutateTranscript(transcriptId)` with no mutation — the compare-and-set fold), `liveQueryClient.execute` from `~/db`, `listenerCommands.getCaptureSnapshot()` from `@anlg/plugin-transcription` returning `{ status: "ok" | "error", data: { activeSessionId: string | null, finalizingSessionIds: string[] } }`.
- Produces: `selectStrandedTranscriptIds(rows, busySessionIds): string[]`, `runTranscriptCompactionSweep(): Promise<{ compacted: number; failed: number; skipped: number }>`, `useTranscriptCompactionSweep(): void`, and `resetTranscriptCompactionSweepState(): void` for tests.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/stt/transcript-compaction-sweep.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  flush: vi.fn(),
  getCaptureSnapshot: vi.fn(),
}));

vi.mock("~/db", () => ({
  liveQueryClient: { execute: mocks.execute },
}));

vi.mock("./queries", () => ({
  flushLiveTranscriptDeltasToDatabase: mocks.flush,
}));

vi.mock("@anlg/plugin-transcription", () => ({
  commands: { getCaptureSnapshot: mocks.getCaptureSnapshot },
}));

import {
  resetTranscriptCompactionSweepState,
  runTranscriptCompactionSweep,
  selectStrandedTranscriptIds,
} from "./transcript-compaction-sweep";

describe("selectStrandedTranscriptIds", () => {
  it("keeps transcripts whose session has no running capture", () => {
    expect(
      selectStrandedTranscriptIds(
        [
          { transcript_id: "transcript-1", session_id: "session-1" },
          { transcript_id: "transcript-2", session_id: "session-2" },
        ],
        ["session-2"],
      ),
    ).toEqual(["transcript-1"]);
  });

  it("drops every transcript of a busy session", () => {
    expect(
      selectStrandedTranscriptIds(
        [
          { transcript_id: "transcript-1", session_id: "session-1" },
          { transcript_id: "transcript-2", session_id: "session-1" },
        ],
        ["session-1"],
      ),
    ).toEqual([]);
  });

  it("deduplicates repeated transcript rows", () => {
    expect(
      selectStrandedTranscriptIds(
        [
          { transcript_id: "transcript-1", session_id: "session-1" },
          { transcript_id: "transcript-1", session_id: "session-1" },
        ],
        [],
      ),
    ).toEqual(["transcript-1"]);
  });
});

describe("runTranscriptCompactionSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTranscriptCompactionSweepState();
    mocks.getCaptureSnapshot.mockResolvedValue({
      status: "ok",
      data: { activeSessionId: null, finalizingSessionIds: [] },
    });
    mocks.flush.mockResolvedValue(undefined);
  });

  it("folds every stranded transcript", async () => {
    mocks.execute.mockResolvedValueOnce([
      { transcript_id: "transcript-1", session_id: "session-1" },
      { transcript_id: "transcript-2", session_id: "session-2" },
    ]);

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 2,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.flush).toHaveBeenCalledWith("transcript-1");
    expect(mocks.flush).toHaveBeenCalledWith("transcript-2");
  });

  it("never folds a transcript whose capture is running", async () => {
    mocks.getCaptureSnapshot.mockResolvedValue({
      status: "ok",
      data: {
        activeSessionId: "session-1",
        finalizingSessionIds: ["session-2"],
      },
    });
    mocks.execute.mockResolvedValueOnce([
      { transcript_id: "transcript-1", session_id: "session-1" },
      { transcript_id: "transcript-2", session_id: "session-2" },
      { transcript_id: "transcript-3", session_id: "session-3" },
    ]);

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 1,
      failed: 0,
      skipped: 2,
    });
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.flush).toHaveBeenCalledWith("transcript-3");
  });

  it("folds nothing when the capture snapshot cannot be read", async () => {
    mocks.getCaptureSnapshot.mockResolvedValue({
      status: "error",
      error: "listener unavailable",
    });

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 0,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it("continues past a failing transcript and gives up on it after its ceiling", async () => {
    mocks.execute.mockResolvedValue([
      { transcript_id: "transcript-1", session_id: "session-1" },
      { transcript_id: "transcript-2", session_id: "session-2" },
    ]);
    mocks.flush.mockImplementation(async (transcriptId: string) => {
      if (transcriptId === "transcript-1") {
        throw new Error("changed too frequently");
      }
    });

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 1,
      failed: 1,
      skipped: 0,
    });
    await runTranscriptCompactionSweep();
    await runTranscriptCompactionSweep();
    mocks.flush.mockClear();

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 1,
      failed: 0,
      skipped: 1,
    });
    expect(mocks.flush).not.toHaveBeenCalledWith("transcript-1");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F desktop exec vitest run src/stt/transcript-compaction-sweep.test.ts`
Expected: FAIL — `Failed to resolve import "./transcript-compaction-sweep"`.

- [ ] **Step 3: Write the sweep**

Create `apps/desktop/src/stt/transcript-compaction-sweep.ts`:

```ts
import { useEffect } from "react";

import { commands as listenerCommands } from "@anlg/plugin-transcription";

import { flushLiveTranscriptDeltasToDatabase } from "./queries";

import { liveQueryClient } from "~/db";

const SWEEP_INTERVAL_MS = 5 * 60_000;
// A capture that is starting may not be in the listener snapshot yet, so a
// journal row younger than this is left to the capture that is writing it.
const SWEEP_QUIET_PERIOD_MS = 60_000;
const MAX_TRANSCRIPTS_PER_SWEEP = 20;
const MAX_SWEEP_FAILURES = 3;

const STRANDED_TRANSCRIPTS_SQL = `
  SELECT DISTINCT
    transcript.id AS transcript_id,
    transcript.session_id AS session_id
  FROM transcript_live_state AS state
  JOIN transcripts AS transcript
    ON transcript.id = state.transcript_id
    AND transcript.deleted_at IS NULL
  JOIN transcript_live_deltas AS delta
    ON delta.transcript_id = state.transcript_id
  WHERE state.updated_at < ?
  ORDER BY transcript.id
`;

const failureCounts = new Map<string, number>();
let sweepInFlight: Promise<TranscriptCompactionSweepResult> | null = null;

export type TranscriptCompactionSweepResult = {
  compacted: number;
  failed: number;
  skipped: number;
};

export function resetTranscriptCompactionSweepState() {
  failureCounts.clear();
  sweepInFlight = null;
}

export function selectStrandedTranscriptIds(
  rows: ReadonlyArray<{ transcript_id: string; session_id: string }>,
  busySessionIds: readonly string[],
): string[] {
  const busy = new Set(busySessionIds);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (busy.has(row.session_id) || seen.has(row.transcript_id)) continue;
    seen.add(row.transcript_id);
    ids.push(row.transcript_id);
  }
  return ids;
}

export function runTranscriptCompactionSweep(): Promise<TranscriptCompactionSweepResult> {
  sweepInFlight ??= sweep().finally(() => {
    sweepInFlight = null;
  });
  return sweepInFlight;
}

async function sweep(): Promise<TranscriptCompactionSweepResult> {
  const empty = { compacted: 0, failed: 0, skipped: 0 };
  let busySessionIds: string[];
  try {
    const snapshot = await listenerCommands.getCaptureSnapshot();
    if (snapshot.status === "error") {
      // Without the listener's view we cannot tell a stranded transcript from
      // one being written right now, so we fold nothing.
      return empty;
    }
    busySessionIds = [
      ...(snapshot.data.activeSessionId ? [snapshot.data.activeSessionId] : []),
      ...snapshot.data.finalizingSessionIds,
    ];
  } catch (error) {
    console.error(
      "[transcript] compaction sweep could not read the capture snapshot",
      error,
    );
    return empty;
  }

  const quietBefore = new Date(
    Date.now() - SWEEP_QUIET_PERIOD_MS,
  ).toISOString();
  let rows: Array<{ transcript_id: string; session_id: string }>;
  try {
    rows = await liveQueryClient.execute<{
      transcript_id: string;
      session_id: string;
    }>(STRANDED_TRANSCRIPTS_SQL, [quietBefore]);
  } catch (error) {
    console.error(
      "[transcript] compaction sweep could not list stranded transcripts",
      error,
    );
    return empty;
  }

  const candidates = selectStrandedTranscriptIds(rows, busySessionIds);
  let skipped = rows.length - candidates.length;
  let compacted = 0;
  let failed = 0;

  for (const transcriptId of candidates) {
    if ((failureCounts.get(transcriptId) ?? 0) >= MAX_SWEEP_FAILURES) {
      skipped += 1;
      continue;
    }
    if (compacted + failed >= MAX_TRANSCRIPTS_PER_SWEEP) {
      skipped += 1;
      continue;
    }
    try {
      await flushLiveTranscriptDeltasToDatabase(transcriptId);
      failureCounts.delete(transcriptId);
      compacted += 1;
    } catch (error) {
      failureCounts.set(
        transcriptId,
        (failureCounts.get(transcriptId) ?? 0) + 1,
      );
      failed += 1;
      console.error(
        `[transcript] compaction sweep failed for ${transcriptId}`,
        error,
      );
    }
  }

  return { compacted, failed, skipped };
}

export function useTranscriptCompactionSweep() {
  useEffect(() => {
    void runTranscriptCompactionSweep();
    const interval = setInterval(() => {
      void runTranscriptCompactionSweep();
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
```

The skip counting is deliberate: `rows.length - candidates.length` counts transcripts excluded because their capture is live; the two `skipped += 1` branches count the ones past their failure ceiling or past the per-pass cap. Deduplicated rows inflate neither, because the dedup happens before the subtraction only for identical ids — the test `"deduplicates repeated transcript rows"` pins the selection, and `"never folds a transcript whose capture is running"` pins the counting.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F desktop exec vitest run src/stt/transcript-compaction-sweep.test.ts`
Expected: PASS, all seven.

- [ ] **Step 5: Mount the sweep**

In `apps/desktop/src/main/lifecycle.tsx`, add the import next to the other `~/stt` imports:

```ts
import { useTranscriptCompactionSweep } from "~/stt/transcript-compaction-sweep";
```

Add the element to `ClassicMainServices`, after `<OwnEmailDomainSeed />`:

```tsx
<TranscriptCompactionSweep />;
```

and the wrapper next to `OwnEmailDomainSeed`, following the same shape:

```tsx
function TranscriptCompactionSweep() {
  useTranscriptCompactionSweep();
  return null;
}
```

- [ ] **Step 6: Verify the app still typechecks and its tests pass**

Run: `pnpm -F desktop typecheck && pnpm -F desktop test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec dprint fmt
pnpm exec oxlint --quiet --format=github apps/desktop/src/
git add apps/desktop/src/stt/transcript-compaction-sweep.ts apps/desktop/src/stt/transcript-compaction-sweep.test.ts apps/desktop/src/main/lifecycle.tsx
git commit -m "feat(stt): fold stranded transcript journals in a background sweep"
```

---

### Task 3: The shared snapshot becomes delta-aware

`SESSION_CONTENT_SQL` selects `words_json` alone and feeds roughly twelve readers — the enhancer, chat context hydration, contact summaries, chat tools, the AI title and enhance tasks, session move. This is insurance, not the fix: it keeps a stranded transcript usable in the window before the sweep reaches it.

The merge lives in `queries.ts` today as a private function. It moves to a leaf module first: `queries.ts` pulls in `useLiveQuery`, `executeTransaction` and the listener commands, and `content-queries.test.ts` mocks `~/db` with `liveQueryClient` alone — importing `queries.ts` from `content-queries.ts` would fail that mock at import time. The merge itself needs nothing but `~/stt/utils` and `~/stt/transcript-persistence-worker`, both leaves.

**Files:**

- Create: `apps/desktop/src/stt/transcript-snapshot.ts`
- Modify: `apps/desktop/src/stt/queries.ts` — remove the four moved definitions (`materializeTranscriptSnapshot` at `:781-798`, `parseLiveTranscriptDeltas` at `:799-812`, `type MemoryTranscriptStore` at `:816-828`, `mutateTranscriptSnapshot` at `:830-854`) and import them instead
- Modify: `apps/desktop/src/session/content-queries.ts` — `TranscriptJson` (`:33-40`), the transcripts subquery (`:118-129`), the transcript mapping in `mapSessionContentRow` (`:234-246`)
- Test: `apps/desktop/src/session/content-queries.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `apps/desktop/src/stt/transcript-snapshot.ts` exporting
  `materializeTranscriptSnapshot(wordsJson: string, hintsJson: string, transcriptId: string, pendingDeltasJson: string): { wordsJson: string; hintsJson: string }`,
  `mutateTranscriptSnapshot(wordsJson: string, hintsJson: string, transcriptId: string, mutation: (store: MemoryTranscriptStore) => void): { wordsJson: string; hintsJson: string }`,
  `parseLiveTranscriptDeltas(value: string | undefined, transcriptId: string): LiveTranscriptDelta[]`,
  and `type MemoryTranscriptStore`.
  `SessionContentSnapshot["transcripts"][number]` keeps its exact shape — `wordsJson`, `speakerHintsJson`, `words`, `speaker_hints` now carry the merged transcript.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/session/content-queries.test.ts`, inside `describe("session content SQLite snapshots", …)`:

```ts
it("folds pending live deltas into the snapshot transcript", async () => {
  mocks.execute.mockResolvedValueOnce([
    {
      id: "session-1",
      owner_user_id: "user-1",
      owner_email: null,
      title: "Planning",
      created_at: "2026-09-08T09:00:00.000Z",
      event_json: "{}",
      event_id: "",
      raw_note_id: "session-1",
      raw_template_id: "",
      raw_body: "",
      raw_body_format: "prosemirror_json",
      enhanced_notes_json: "[]",
      transcripts_json: JSON.stringify([
        {
          id: "transcript-1",
          started_at_ms: 0,
          ended_at_ms: null,
          memo: "",
          words_json: JSON.stringify([
            { id: "word-1", text: "Hello", start_ms: 0, end_ms: 1, channel: 0 },
          ]),
          speaker_hints_json: "[]",
          pending_deltas_json: JSON.stringify([
            {
              new_words: [
                {
                  id: "word-2",
                  text: "world",
                  start_ms: 2,
                  end_ms: 3,
                  channel: 0,
                  state: "final",
                },
              ],
              replaced_ids: [],
              partials: [],
            },
          ]),
        },
      ]),
      participants_json: "[]",
    },
  ]);

  const snapshot = await loadSessionContentSnapshot("session-1");

  expect(snapshot?.transcripts[0]?.words.map((word) => word.text)).toEqual([
    "Hello",
    "world",
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/session/content-queries.test.ts`
Expected: FAIL — received `["Hello"]`, the pending delta is dropped.

- [ ] **Step 3: Create the leaf module**

Create `apps/desktop/src/stt/transcript-snapshot.ts` and move the four definitions out of `apps/desktop/src/stt/queries.ts` into it **verbatim**, adding `export` to each and the imports they need:

```ts
import type { LiveTranscriptDelta } from "@anlg/plugin-transcription";

import { coalesceLiveTranscriptDeltas } from "~/stt/transcript-persistence-worker";
import { applyLiveTranscriptDelta } from "~/stt/utils";

export type MemoryTranscriptStore = {
  getCell: (
    tableId: "transcripts",
    rowId: string,
    cellId: "words" | "speaker_hints",
  ) => string;
  setCell: (
    tableId: "transcripts",
    rowId: string,
    cellId: "words" | "speaker_hints",
    value: string,
  ) => void;
};

export function materializeTranscriptSnapshot(
  wordsJson: string,
  hintsJson: string,
  transcriptId: string,
  pendingDeltasJson: string,
) {
  const deltas = parseLiveTranscriptDeltas(pendingDeltasJson, transcriptId);
  if (deltas.length === 0) return { wordsJson, hintsJson };

  return mutateTranscriptSnapshot(wordsJson, hintsJson, transcriptId, (store) =>
    applyLiveTranscriptDelta(
      store,
      transcriptId,
      coalesceLiveTranscriptDeltas(deltas),
    ),
  );
}

export function parseLiveTranscriptDeltas(
  value: string | undefined,
  transcriptId: string,
): LiveTranscriptDelta[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as LiveTranscriptDelta[];
  } catch (error) {
    console.error(
      `[transcript] failed to parse live deltas for ${transcriptId}`,
      error,
    );
  }
  return [];
}

export function mutateTranscriptSnapshot(
  wordsJson: string,
  hintsJson: string,
  transcriptId: string,
  mutation: (store: MemoryTranscriptStore) => void,
) {
  const snapshot = { wordsJson, hintsJson };
  const store: MemoryTranscriptStore = {
    getCell: (_tableId, rowId, cellId) => {
      if (rowId !== transcriptId) return "[]";
      return cellId === "words" ? snapshot.wordsJson : snapshot.hintsJson;
    },
    setCell: (_tableId, rowId, cellId, value) => {
      if (rowId !== transcriptId) return;
      if (cellId === "words") {
        snapshot.wordsJson = value;
      } else {
        snapshot.hintsJson = value;
      }
    },
  };

  mutation(store);
  return snapshot;
}
```

- [ ] **Step 4: Point `queries.ts` at the leaf module**

Delete those four definitions from `apps/desktop/src/stt/queries.ts` and add, with the other `~/stt` imports:

```ts
import type { MemoryTranscriptStore } from "~/stt/transcript-snapshot";
import {
  materializeTranscriptSnapshot,
  mutateTranscriptSnapshot,
  parseLiveTranscriptDeltas,
} from "~/stt/transcript-snapshot";
```

`mutateTranscript` (`:685-779`) and `mapTranscriptRow` (`:643`) keep calling them exactly as they do today; their behaviour must not change. If `coalesceLiveTranscriptDeltas` or `applyLiveTranscriptDelta` is now unused in `queries.ts`, drop it from that file's imports — oxlint will say so.

- [ ] **Step 5: Verify nothing regressed in the live path**

Run: `pnpm -F desktop exec vitest run src/stt/queries.test.tsx`
Expected: PASS, unchanged. This is a pure move; a failure here means the move was not verbatim.

- [ ] **Step 6: Select the pending deltas in the shared snapshot**

In `apps/desktop/src/session/content-queries.ts`, add the field to `TranscriptJson`:

```ts
speaker_hints_json: string;
pending_deltas_json: string;
```

and add it to the transcripts subquery's `json_object`, after `'speaker_hints_json', transcript.speaker_hints_json`:

```sql
'pending_deltas_json', COALESCE((
  SELECT json_group_array(json(ordered_delta.delta_json))
  FROM (
    SELECT delta.delta_json
    FROM transcript_live_deltas AS delta
    WHERE delta.transcript_id = transcript.id
    ORDER BY delta.sequence
  ) AS ordered_delta
), '[]')
```

- [ ] **Step 7: Apply the merge in the mapping**

Add the import at the top of `content-queries.ts`:

```ts
import { materializeTranscriptSnapshot } from "~/stt/transcript-snapshot";
```

and rewrite the transcript mapping in `mapSessionContentRow`:

```ts
const transcripts = parseJsonArray<TranscriptJson>(row.transcripts_json)
  .map((transcript) => {
    const merged = materializeTranscriptSnapshot(
      transcript.words_json,
      transcript.speaker_hints_json,
      transcript.id,
      transcript.pending_deltas_json,
    );
    return {
      id: transcript.id,
      started_at: Number(transcript.started_at_ms),
      ended_at:
        transcript.ended_at_ms == null ? null : Number(transcript.ended_at_ms),
      memo: transcript.memo,
      wordsJson: merged.wordsJson,
      speakerHintsJson: merged.hintsJson,
      words: parseJsonArray<WordWithId>(merged.wordsJson),
      speaker_hints: parseJsonArray<SpeakerHintWithId>(merged.hintsJson),
    };
  })
  .sort(
    (left, right) =>
      left.started_at - right.started_at || left.id.localeCompare(right.id),
  );
```

`materializeTranscriptSnapshot` returns the two input strings untouched when there are no deltas, so a compacted transcript takes the same path it does today.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -F desktop exec vitest run src/session/content-queries.test.ts`
Expected: PASS. The existing snapshot tests feed rows without `pending_deltas_json`; `parseLiveTranscriptDeltas` returns `[]` for `undefined`, so they keep their current results.

- [ ] **Step 9: Verify the readers behind the snapshot**

Run: `pnpm -F desktop exec vitest run src/services/enhancer src/session src/store/zustand/ai-task src/stt`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
pnpm exec dprint fmt
pnpm -F desktop typecheck
pnpm exec oxlint --quiet --format=github apps/desktop/src/
git add apps/desktop/src/stt/transcript-snapshot.ts apps/desktop/src/stt/queries.ts apps/desktop/src/session/content-queries.ts apps/desktop/src/session/content-queries.test.ts
git commit -m "fix(session): fold pending live deltas into the shared session snapshot"
```

---

### Task 4: The auto-enhance gate sees the journal

`loadPendingAutoEnhanceJobs` requires `json_array_length(transcript.words_json) > 0`, so a session whose words are still in the journal cannot even self-repair through the retry sweep. The metadata query already solves this in `apps/desktop/src/stt/queries.ts:137-155` (`TRANSCRIPT_METADATA_WITH_PENDING_COLUMNS`); this mirrors that predicate.

**Files:**

- Modify: `apps/desktop/src/services/enhancer/storage.ts:112-120` (the `EXISTS` clause on `transcripts`)
- Test: `apps/desktop/src/services/enhancer/storage.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: no signature change. `loadPendingAutoEnhanceJobs()` keeps returning `Array<{ sessionId, noteId, templateId, expectedBody, expectedContentFormat, generation }>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/services/enhancer/storage.test.ts`, inside `describe("enhancer SQLite storage", …)` and next to the existing `loadPendingAutoEnhanceJobs` test around line 182:

```ts
it("accepts a transcript whose words are still in the live journal", async () => {
  mocks.execute.mockResolvedValueOnce([]);

  await loadPendingAutoEnhanceJobs();

  const sql = String(mocks.execute.mock.calls[0]?.[0]);
  expect(sql).toContain("transcript_live_deltas");
  expect(sql).toContain("json_array_length(transcript.words_json) > 0");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/services/enhancer/storage.test.ts`
Expected: FAIL — the SQL does not mention `transcript_live_deltas`.

- [ ] **Step 3: Widen the predicate**

In `apps/desktop/src/services/enhancer/storage.ts`, replace the `AND EXISTS ( … )` block that requires words with:

```sql
AND EXISTS (
  SELECT 1
  FROM transcripts AS transcript
  WHERE transcript.session_id = session.id
    AND transcript.deleted_at IS NULL
    AND (
      (
        json_valid(transcript.words_json)
        AND json_type(transcript.words_json) = 'array'
        AND json_array_length(transcript.words_json) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM transcript_live_deltas AS delta
        WHERE delta.transcript_id = transcript.id
          AND json_valid(delta.delta_json)
          AND COALESCE(
            json_array_length(delta.delta_json, '$.new_words'),
            0
          ) > 0
      )
    )
)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F desktop exec vitest run src/services/enhancer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec dprint fmt
pnpm -F desktop typecheck
pnpm exec oxlint --quiet --format=github apps/desktop/src/
git add apps/desktop/src/services/enhancer/storage.ts apps/desktop/src/services/enhancer/storage.test.ts
git commit -m "fix(enhancer): let the auto-enhance gate see words still in the journal"
```

---

## Out of scope

- The search index deliberately waits for `words_json` (`crates/db-app/src/schema_tests/search_index.rs:130-137`). That stays: the sweep makes the words land in `words_json` within minutes, which is what the index is waiting for. No Rust change is part of this plan.
- No repair of transcripts whose deltas are gone. Nothing deletes them except the cascade from a successful fold.
