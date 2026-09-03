# Meeting participants from the Teams window

Date: 2026-09-03 · Status: approved in conversation, pending spec review

## Goal

While a recording runs, the names shown on Microsoft Teams video tiles become
participants of the session, so note and summary know who was there even
without a calendar entry. Teams only, native app only, macOS only.

## Why a separate probe

The existing meeting inspection (`inspect_meeting_accessibility`) caps its
AX walk at depth 18 and 1800 nodes, recognises an active Teams call only by
an English "hang up" button and Teams tiles only by English labels. In a
German Teams client the call controls sit at depth 19–21, tiles at 23–25 and
names at 30, so the inspection never scopes the window. Fixing that touches
every platform; this step adds a narrow probe instead and leaves the merge
for later.

## Evidence (AX dump of a live Teams call, 2026-09-03)

```
d23 AXImage    desc="Video von mir selbst, Jörg Weller, Hat die Kontrolle über Produktionstools, Stummschaltung aufgehoben, Video ist ein, Frame ausfüllen, Hat Kontextmenü"
d25 AXMenuItem desc="Gebert, Mattan Extern unbekannt, Video ist ein, Hat die Kontrolle über Produktionstools, Kontextmenü ist verfügbar"
d30 AXStaticText value="Gebert, Mattan"
```

## Rust: `list_meeting_participants` (crates/detect, macOS)

- Runs for processes of `com.microsoft.teams2` / `com.microsoft.teams`.
- Walks each window to depth 40, at most 4000 nodes, and collects elements
  with role `AXImage` or `AXMenuItem` that carry a description.
- Extraction is a pure function over `(role, description)` pairs:
  - A description starting with a self prefix ("Video von mir selbst, ",
    "Video of myself, ", "Mein Video, ", "My video, ") marks the tile as the
    user; the name is the next segment.
  - Otherwise the name is the text before the first `,` with the trailing
    external marker ("Extern unbekannt", "External unknown", "Extern",
    "External") stripped; a leading role marker such as "Video von " is
    stripped too.
  - A name needs at least three letters; duplicates are folded
    case-insensitively.
- Returns `Vec<MeetingParticipant { name, is_self, app: MeetingApp }>`.
- Unit tests use the strings above plus an English pair.
- `plugins/detect`: command `list_meeting_participants`, build.rs entry,
  default permission, regenerated bindings.

## Frontend: `startMeetingParticipantSync(sessionId)` (apps/desktop/src/stt)

- Started next to `startMeetingSnapshotCapture` in `useStartListening`,
  stopped with it; interval 15 s; one call in flight at a time.
- Skipped while the setting `capture_meeting_participants` is off.
- For every returned name not yet handled in this run: skip `isSelf`,
  look up a human by name (`lower(name) = lower(?)`, not deleted), else
  `createHuman({ ownerUserId, name })`; then
  `addSessionParticipant(sessionId, humanId, "auto")`.
- The existing `auto` semantics apply: removing the chip flips it to
  `excluded`, and `addSessionParticipant` never revives an excluded row for
  `auto`. Session participants stay in one table; no schema change.
- Names surface through the existing participant chips; no new UI.

## Setting

`capture_meeting_participants`, boolean, default **off**, under
Settings › Meetings next to "Capture meeting chat in Memos", macOS/Linux
only like the other AX switches. Copy: "Add participants from the meeting
window" / "Names shown on the meeting's video tiles become participants of
this recording. Needs Accessibility access."

## Tests

- Rust: parser and extraction with the recorded strings.
- TS: sync adds a new name once, skips the self tile, reuses an existing
  human, stays idle while the setting is off, stops cleanly.
- Settings view: switch toggles the setting.

## Out of scope

Zoom, Meet, Slack, Webex; the "People" panel; OCR; speaker-to-name mapping
(planned as step B); merging with `participantStreams` (part of repairing
the inspection).
