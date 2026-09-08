# Transcript Compaction Reliability — Design

## Problem

An hour-long recording produced a complete, readable transcript on screen and
refused to summarize: "Not enough words recorded (2/5 minimum)".

In the user's database, `transcripts.words_json` held **2 words** while
`transcript_live_deltas` held **7289** across 502 rows. The live journal had
never been folded into the transcript row.

`transcript_live_deltas` is a write-ahead journal, not a store. Deltas are
deleted only by cascade from `transcript_live_state`; `mutateTranscript`
(`apps/desktop/src/stt/queries.ts:685-779`) folds pending deltas into
`words_json` and drops the state row in one compare-and-set transaction; the
Rust schema tests call the mechanism "journal" and "compaction"
(`crates/db-app/src/schema_tests/transcript_live_deltas.rs:29,67`). Stranded
rows are a failure, not a resting state.

Two independent defects produced it, and a third made it invisible until the
user asked for a summary.

### 1. One stall permanently disables compaction

`apps/desktop/src/stt/transcript-persistence-worker.ts:215` runs the
end-of-capture compaction only `if (!timedOut && options.afterFlush)`.
`timedOut` is a one-way latch (`:56-69`) tripped by **any single** delta write
exceeding 15 s (`:20`), or by the final drain exceeding 20 s (`:205-212`). Over
an hour and ~500 sequential writes through the same write-queue key, one stall
is entirely plausible — and it disables the compaction that runs at the end,
even though every delta afterwards is still journalled successfully. That is
why the transcript displays complete: the display reads the journal directly
(`apps/desktop/src/stt/queries.ts:93-111`).

### 2. A failed compaction is never retried

If compaction throws — for instance the five-attempt compare-and-set loop
exhausting with `Transcript … changed too frequently` (`queries.ts:777`) —
`transcript-persistence-worker.ts:219-224` catches it, records the error and
returns. Nothing tries again. Downstream, a terminal batch-repair failure
clears the recovery marker (`apps/desktop/src/stt/capture-lifecycle.ts:130-152`),
so the stranded deltas are never revisited.

### 3. Almost every non-live reader shares the blind spot

The display merges words and pending deltas. Nothing else does.
`SESSION_CONTENT_SQL` (`apps/desktop/src/session/content-queries.ts:93-146`)
selects `words_json` alone and feeds roughly twelve call sites: the enhancer,
chat context hydration, contact summaries, chat tools, AI title and enhance
tasks, session move. Half a dozen standalone queries do the same, including the
pending-auto-enhance gate (`services/enhancer/storage.ts:118-120`), which means
a session in this state cannot even self-repair through the retry sweep. The
search index deliberately waits for `words_json`
(`crates/db-app/src/schema_tests/search_index.rs:130-137`), so the meeting was
also **unfindable**, not merely unsummarizable.

The summary's error message was the only symptom loud enough to notice. Chat
context and contact summaries would have degraded silently.

## Goals

- A capture that stalls or errors still ends with its transcript compacted.
- A transcript left with pending deltas is repaired without the user knowing it
  happened.
- The readers behind the shared snapshot see the same transcript the display
  shows, even before compaction runs.

## Non-goals

- No schema change. The journal, its state row and the cascade stay as they are.
- No change to the live display path, which is already correct.
- No repair of transcripts whose deltas are gone. Nothing has deleted them.
- Not a rewrite of the capture state machine. The reconciliation below is
  deliberately independent of it.

## Design

### Compaction always gets its own attempt

Separate the guard that protects the **live write path** from the compaction
that runs **at the end of a capture**. A stall during the capture says nothing
about whether compaction can succeed afterwards, so `timedOut` must stop
gating it. Compaction gets its own timeout and its own error handling, and a
failure there is retried a small number of times before being recorded.

### A reconciliation sweep, independent of the capture lifecycle

On app start, and periodically thereafter, fold any transcript that has pending
deltas and no active capture.

This is the load-bearing part of the fix. The two defects above are the ones we
found; the sweep covers the ones we have not — a crash, a force-quit, a power
loss, a future edge case in the capture state machine. It depends on nothing
but the database: a transcript with delta rows and no live capture is, by
definition, a transcript that should have been compacted already.

It must skip any transcript whose capture is currently running, or it would
race the live writer.

### The shared snapshot becomes delta-aware

`SESSION_CONTENT_SQL` gains the pending deltas and applies them, fixing about a
dozen readers at once. This is insurance, not the fix: it keeps a stranded
transcript usable in the window before the sweep reaches it, and it keeps every
AI path honest if compaction ever fails again.

The merge must reuse the semantics the accumulator already implements
(`apps/desktop/src/stt/utils.ts`, `applyLiveDelta`): drop words whose ids appear
in `replaced_ids` or among the new words, append the new words, sort by
`start_ms`, ignore `partials`. Reimplementing that by hand in SQL would create a
second definition of what a transcript is, which is the very problem this design
exists to remove.

## Risks

- **The sweep racing a live capture.** The one way this fix could destroy data
  rather than save it. Active captures must be excluded, and the compaction path
  keeps its compare-and-set guard.
- **A startup sweep over many transcripts.** It must not block startup or the
  first paint; it is background work.
- **Widening the snapshot changes AI input.** More complete input is the point,
  but summaries and chat context for an affected session will differ from what
  they would have produced yesterday. That is the correction, not a regression.
- **A permanently failing compaction could now retry forever.** Retries need a
  ceiling.
