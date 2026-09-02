# Meeting Slide Snapshots — Design

## Problem

During a recorded meeting the interesting visual content (shared slides, a
screen share, a whiteboard) lives in the meeting window. Session Echo captures
audio only, so a summary of a slide-driven meeting has no access to the slides.
Full-screen screenshots are the wrong tool on a large monitor: they are huge,
mostly irrelevant, and leak unrelated windows.

## Goal

While a session is being recorded, periodically capture **only the meeting
window** (Zoom, Teams, Google Meet, Slack, Discord, Webex — native or in a
browser), keep a frame only when the picture materially changed, store the
frames as session attachments, show them in the note, and hand them to the
summary model as image context.

## Non-goals (v1)

- No OCR or per-slide LLM analysis; the enhance step already accepts images.
- No video, no capture when no meeting app is detected, no full-display fallback.
- No Windows/Linux implementation beyond compiling; the meeting-window detection
  (`crates/detect/meeting_ax`) is macOS + Linux, window capture (`xcap`) is
  cross-platform, but v1 is verified on macOS only.

## Existing building blocks

| Need                                   | Existing piece                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Which app/window is the meeting        | `detectCommands.inspectMeetingAccessibility()` → `MeetingAccessibilityInspection { app: {id, name}, pid, platform, surface, windowTitle }` (`crates/detect/src/meeting_ax`)                                                                                                    |
| Which apps currently use the mic       | `detectCommands.listMicUsingApplications()` → `InstalledApp[]`                                                                                                                                                                                                                 |
| Capture one window by pid + title      | `screenCommands.captureTargetWindowContext({pid, appName, title}, {imagePolicy: {maxLongSide}})` → `WindowContextCapture { mimeType, dataBase64, width, height, capturedAtMs, subject }` (`crates/screen-core`, xcap; falls back to the largest usable window of the same pid) |
| Store a file as a session attachment   | `fsSyncCommands.attachmentSave(sessionId, bytes, filename)` + `catalogLocalNoteAttachment(...)` (`session/attachments.ts`)                                                                                                                                                     |
| Per-session side records               | `session_documents` rows with a custom `kind` (pattern: `stt/meeting-chat-records.ts`, kind `meeting_chat`)                                                                                                                                                                    |
| Periodic capture loop during a session | `stt/meeting-chat-capture.ts` (`startMeetingChatCapture` → stop fn, wired in `useStartListening`, stopped in `capture-lifecycle.ts`)                                                                                                                                           |
| Images into the summary prompt         | `collectEnhanceImageContext(sessionId, markdown[])` resolves `![..](path)` to attachments (`enhance-images.ts`, 10 images / 768 KB budget)                                                                                                                                     |
| Screen-recording permission            | `permissionsCommands.checkPermission("screenRecording")` → `"neverRequested" \| "denied" \| "authorized"`                                                                                                                                                                      |

## Design

### Setting

`capture_meeting_snapshots: boolean`, default `false`, under Settings ›
General › Meetings next to "Capture meeting chat in Memos". Copy:
"Capture slides from the meeting window" / "Keep a screenshot of the meeting
window whenever the shared content changes. Needs Screen Recording access."

### Capture loop (`stt/meeting-snapshot-capture.ts`)

`startMeetingSnapshotCapture({ sessionId, isEnabled? }) → () => Promise<void>`

Every 10 s while the session is active:

1. Setting off → do nothing (keep polling so switching it on mid-meeting works).
2. First tick: `checkPermission("screenRecording")`. Not `"authorized"` → one
   warning toast with an action that opens Settings › Permissions, then the loop
   stops for this session.
3. `inspectMeetingAccessibility()`; pick the inspection whose `app.id` is in
   `listMicUsingApplications()`, else the first one. None → skip tick.
4. `captureTargetWindowContext({ pid, appName: app.name, title: windowTitle },
   { imagePolicy: { maxLongSide: 1600 } })`. Error → skip tick (log once).
5. Change detection: downscale to 32×32 grey (`meeting-snapshot-diff.ts`),
   compare with the last **kept** frame. Keep when it is the first frame, or
   `frameDifference ≥ 0.06` **and** ≥ 15 s since the last kept frame.
   Two people talking on camera changes pixels constantly; a 32×32 grey
   comparison with a 6 % threshold ignores webcam noise but catches a slide
   flip, which changes most of the window.
6. Keep: decode base64 → bytes; `attachmentSave(sessionId, bytes,
   "slide-HHMMSS.<ext>")`; `catalogLocalNoteAttachment`; then
   `persistMeetingSnapshotRecord`. Cap at 60 kept frames per session.

### Records (`stt/meeting-snapshot-records.ts`)

`session_documents` rows, `kind = 'meeting_snapshot'`, `body_format = 'json'`,
one row per kept frame:

```ts
type MeetingSnapshotRecord = {
  id: string; // document id
  attachmentId: string;
  filename: string;
  path: string; // absolute local path from attachmentSave
  capturedAtMs: number;
  width: number;
  height: number;
  appName: string;
  windowTitle: string;
};
```

`useMeetingSnapshotRecords(sessionId)` (live query) for the UI,
`loadMeetingSnapshotRecords(sessionId)` for the enhance transform.

### Summary context

`enhance-transform.ts` loads the records and appends
`![Slide HH:MM](path)` lines to the inputs of `collectEnhanceImageContext`, so
the existing budget/sampling logic applies. The system prompt already says
attached images are visual context.

### Note UI

A thumbnail strip (`session/components/note-input/snapshot-strip.tsx`) at the
top of the **Notes** tab whenever the session has snapshots: thumbnails in
capture order with the time as caption; clicking one inserts the image at the
end of the note (image node with `attachmentId`), so a slide becomes part of
the note only when the user wants it there. The strip is not shown in the
summary or transcript tabs.

### Lifecycle

Started right after `startMeetingChatCapture` in `useStartListening`, stopped in
the same place chat capture is stopped (`capture-lifecycle.ts`), via a second
ref `stopMeetingSnapshotCaptureRef`.

## Risks

- Browser meetings: the window title only names the meeting while the meeting
  tab is the active tab. If the user switches tabs in that window, captures
  pause naturally (no inspection → skip) — acceptable.
- Zoom full-screen share opens a separate, untitled window; the same-pid
  fallback picks the largest usable window, which is that one.
- Screen Recording permission prompts once; the toast points to Settings.
