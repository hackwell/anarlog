# Note Timestamp Anchors — Design

## Problem

A note line written during a recording has no relation to the recording. Three
weeks later "clarify pricing" gives no way back to what was said around it, and
the summary sees the note and the transcript as two unrelated texts.

## Goal

While a session is being recorded, remember for each note paragraph **when in
the recording it was written**, show that time next to the paragraph, let a
click jump the audio there, and hand the times to the summary model.

## Non-goals (v1)

- No anchors on headings (they come from templates and briefs, not from typing).
- No transcript scroll-sync on click; seeking the audio is enough, the
  transcript view follows playback on its own.
- Markdown export and fs-sync drop anchors. The ProseMirror JSON in
  `session_documents.raw_body` is the only carrier.
- A chat tool that rewrites the whole memo (`chat/tools/edit-memo.ts`) replaces
  the document from markdown and therefore drops anchors. Accepted.
- No backfill for existing notes.

## Existing building blocks

| Need | Existing piece |
| --- | --- |
| Audio timeline base | `useSessionTranscriptMetadata(sessionId)` (`stt/queries.ts:197`), rows ordered by `started_at_ms`; the first row's `startedAt` is the timeline zero |
| The same base used for seeking | `getTranscriptTimelineOffsetMs` (`session/components/note-input/transcript/renderer/data-hooks.ts`): `offset = transcriptStartedAt - earliestStartedAt`, so an absolute instant maps to `absolute - earliestStartedAt` |
| Seek + play | `useAudioPlayer()` → `seek(sec)`, `start()`, `audioExists` (`audio-player/provider.tsx:74-90`) |
| Is a recording running | `useListener((state) => state.getSessionMode(sessionId))` → `"running_active"` while live (`store/zustand/listener/general.ts:249`) |
| Stamping attributes onto nodes as they appear | `taskIdentityPlugin()` (`packages/editor/src/plugins/task-identity.ts`) |
| Which textblocks a transaction touched | `getChangedTextblockRanges(doc, transactions)` (`packages/editor/src/plugins/changed-ranges.ts:36`) |
| Optional plugin driven by a config prop | `fileHandlerConfig` / `mentionConfig` in `packages/editor/src/note/index.tsx:725-770` |
| Config hook per session | `useNoteFileHandlerConfig(sessionId)`, used in `session/components/note-input/raw.tsx:117` |
| Note editor already has the audio player in scope | `raw.tsx:113` (`useAudioPlayer()`) |

## Design

### What is stored

A new attribute on **paragraph**, in the note schema only
(`packages/editor/src/note/schema.ts`):

```ts
attrs: { recordedAtMs: { default: null } }
```

`recordedAtMs` is the position on the session's audio timeline in milliseconds:
`Date.now() - earliestTranscriptStartedAtMs` at the moment the paragraph got its
first character. Storing a timeline position rather than a wall clock keeps
every consumer context-free: the label is pure formatting and the seek target is
`recordedAtMs / 1000`, exactly what the transcript's word click uses.

`packages/editor/src/markdown/schema.ts` is deliberately **not** changed, so
`md2json` / `json2md` output stays as it is today.

DOM round-trip so in-app copy/paste keeps anchors:
`toDOM` emits `data-recorded-at-ms` when set, `parseDOM` reads it back.

### Stamping

`noteTimestampPlugin(configRef)` in `packages/editor/src/plugins/note-timestamp.ts`,
an `appendTransaction` plugin in the shape of `taskIdentityPlugin`:

1. Nothing to do when no transaction changed the document.
2. `getRecordedAtMs()` returns `null` when no recording is running → no stamping.
3. Consider only the textblocks the transaction touched. **Bail out when it
   touched more than three**: applying a template, inserting a pre-meeting
   brief or replacing the document rewrites many blocks at once and must not be
   stamped as if it had been typed now.
4. Stamp a paragraph when it has text content and `recordedAtMs === null`.
   Existing values are never overwritten, so editing an old line keeps its
   original time.

### Display

The same plugin decorates every paragraph with `recordedAtMs !== null` with a
widget at the paragraph start (`side: -1`, `ignoreSelection: true`):

```html
<button class="note-timestamp" contenteditable="false" tabindex="-1">12:04</button>
```

Styled in `packages/editor/src/styles/prosemirror/nodes/note-timestamp.css`,
absolutely positioned in the left margin of the paragraph, `opacity: 0` until
the paragraph is hovered or holds the caret. Label format `m:ss`, `h:mm:ss` from
an hour. The widget is only rendered when the config supplies `onActivate`, so a
session without audio shows no dead buttons. Clicking calls
`onActivate(recordedAtMs)`.

### Wiring

`NoteEditor` takes an optional `timestampConfig` prop; the plugin is added when
it is present, the same way `fileHandlerPlugin` is. The config is held in a ref
inside the editor so its identity may change without reconfiguring the plugin
list — reconfiguring would create a fresh `history()` and throw away undo.

`useNoteTimestampConfig(sessionId)` in the desktop app supplies it:

- `getRecordedAtMs()` → `null` unless the session mode is `"running_active"` and
  a transcript row with a usable `startedAt` exists; otherwise
  `Date.now() - earliestStartedAt`.
- `formatLabel(ms)` → `"12:04"`.
- `onActivate(ms)` → `seek(ms / 1000)` then `start()`, and `undefined` while
  `audioExists` is false.

Typing in the first seconds of a recording, before the transcript row exists,
yields no anchor. Accepted: the gap is seconds long and the alternative is a
second, less reliable clock.

### Summary context

`getSessionContext` in `enhance-transform.ts` currently passes
`snapshot.rawMarkdown` as `postMeetingMemo`. When the snapshot is JSON, the note
is annotated first: each stamped paragraph gets a `[12:04] ` prefix on its first
text node, then `json2md` renders it. The prompt templates stay untouched; a
transcript in the same prompt already carries times, so the model reads the
prefixes without being told.

## Risks

- Adding attrs to `paragraph` makes `Node.toJSON()` emit
  `"attrs":{"recordedAtMs":null}` for every paragraph in the note schema. That
  is ProseMirror behaviour, costs ~30 bytes per paragraph, and breaks test
  fixtures that compare whole documents (about seven files in
  `packages/editor`, plus desktop tests that mount the real editor). Mechanical
  to fix, and limited to the note schema.
- A widget decoration inside a paragraph is an atom in the document flow.
  `ignoreSelection` plus `contenteditable="false"` keeps the caret out of it;
  arrow-key travel across the line has to be verified by hand.
