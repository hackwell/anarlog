# Meeting Slide Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a meeting is recorded, screenshot only the meeting window whenever its content changes, keep the frames as session attachments, show them in the note, and feed them to the summary.

**Architecture:** A TypeScript capture loop in `apps/desktop/src/stt/` (mirroring `meeting-chat-capture.ts`) asks the existing `@anlg/plugin-detect` inspection for the meeting app's pid + window title, captures that window through the existing `@anlg/plugin-screen` command, diffs a 32×32 greyscale thumbnail against the last kept frame, and stores kept frames via the existing attachment pipeline plus one `session_documents` row per frame (`kind = 'meeting_snapshot'`). The enhance transform appends those frames to its image context; a thumbnail strip in the Notes tab lets the user drop a slide into the note.

**Tech Stack:** TypeScript/React (desktop app), Vitest, existing Tauri plugins `@anlg/plugin-detect`, `@anlg/plugin-screen`, `@anlg/plugin-fs-sync`, `@anlg/plugin-permissions`. The only Rust change is registering the already-built screen plugin in the desktop app (one line).

**Spec:** `docs/superpowers/specs/2026-09-02-meeting-slide-snapshots-design.md`

## Global Constraints

- Communication in German, code/commits/docs in English; commits follow Conventional Commits (`feat(scope): …`).
- Every commit runs `pnpm exec dprint fmt`, `pnpm fmt:check`, `pnpm -F desktop typecheck`, `pnpm exec oxlint --quiet --format=github apps/desktop/src/`, and the affected Vitest files (`pnpm -F desktop exec vitest run <path>`).
- Any task adding `<Trans>`/`` t` `` strings runs `pnpm -F desktop exec lingui extract --clean --workers 1`, fills the German `msgstr` in `apps/desktop/src/i18n/locales/de/messages.po`, runs `pnpm -F desktop exec lingui compile --strict --workers 1`, re-runs extract to confirm stability, and commits every file under `apps/desktop/src/i18n/locales`.
- No new npm or cargo dependencies.
- Use `cn` from `@anlg/utils` with an array for conditional classNames; comments explain why, not what.
- Setting default is `false`; nothing captures unless the user turns it on.
- Kept frames per session are capped at 60; capture interval 10 s; a frame is kept when it is the first one or differs ≥ 6 % from the last kept frame and ≥ 15 s passed since it.

---

## File Structure

| File                                                                                | Responsibility                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/desktop/src/settings/schema.ts` (modify)                                      | Setting `capture_meeting_snapshots`                                       |
| `apps/desktop/src/settings/general/index.tsx` (modify)                              | Form plumbing for the new setting                                         |
| `apps/desktop/src/settings/general/meeting-settings.tsx` (modify)                   | Switch row under "Capture meeting chat in Memos"                          |
| `apps/desktop/src/stt/meeting-snapshot-diff.ts` (create)                            | Pure frame comparison + base64 → 32×32 grey decoding                      |
| `apps/desktop/src/stt/meeting-snapshot-records.ts` (create)                         | `MeetingSnapshotRecord`, persist/load/live-query over `session_documents` |
| `apps/desktop/src/stt/meeting-snapshot-capture.ts` (create)                         | The 10 s capture loop: detect → capture → diff → store                    |
| `apps/desktop/src/stt/capture-lifecycle.ts` (modify)                                | Stop ref for the loop, stopped alongside chat capture                     |
| `apps/desktop/src/stt/useStartListening.ts` (modify)                                | Start the loop when listening starts                                      |
| `apps/desktop/package.json`, `apps/desktop/src-tauri/src/lib.rs` (modify)           | Link and register the existing screen plugin                              |
| `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-transform.ts` (modify) | Snapshot paths into the enhance image context                             |
| `apps/desktop/src/session/editor-activity.ts` (modify)                              | `getCanonicalSessionEditor` getter                                        |
| `apps/desktop/src/session/components/note-input/snapshot-strip.tsx` (create)        | Thumbnail strip, click inserts the image into the note                    |
| `apps/desktop/src/session/components/note-input/raw.tsx` (modify)                   | Mount the strip above the editor                                          |

---

### Task 1: Setting and switch

**Files:**

- Modify: `apps/desktop/src/settings/schema.ts` (next to `capture_meeting_chat`, ~line 149)
- Modify: `apps/desktop/src/settings/general/index.tsx` (the three places `capture_meeting_chat` appears, ~lines 46, 71, 112, 323)
- Modify: `apps/desktop/src/settings/general/meeting-settings.tsx`
- Test: `apps/desktop/src/settings/general/meeting-settings.test.tsx`

**Interfaces:**

- Produces: setting key `capture_meeting_snapshots: boolean` (default `false`), readable via `resolveConfigValue("capture_meeting_snapshots", await getStoredSettingValues())`.
- Produces: `MeetingSettingsView` prop `captureMeetingSnapshots: SettingItem`.

- [ ] **Step 1: Write the failing test**

Add to `meeting-settings.test.tsx`, inside `describe("MeetingSettingsView")`, and extend `renderMeetingSettings` with a `captureMeetingSnapshots = setting(false)` default that is passed as `captureMeetingSnapshots={captureMeetingSnapshots}`:

```tsx
it("toggles slide capture from the meeting window", () => {
  const captureMeetingSnapshots = setting(false);
  renderMeetingSettings({ captureMeetingSnapshots });

  fireEvent.click(
    screen.getByRole("switch", {
      name: "Capture slides from the meeting window",
    }),
  );

  expect(captureMeetingSnapshots.onChange).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/settings/general/meeting-settings.test.tsx`
Expected: FAIL — TypeScript complains about the unknown prop / the switch is not found.

- [ ] **Step 3: Add the setting**

`schema.ts`, directly after the `capture_meeting_chat` entry:

```ts
capture_meeting_snapshots: {
  type: "boolean",
  path: ["general", "capture_meeting_snapshots"],
  default: false as boolean,
},
```

`general/index.tsx`: add `"capture_meeting_snapshots",` to the field list next to `"capture_meeting_chat",`; add `capture_meeting_snapshots: settingsValue.capture_meeting_snapshots,` and `capture_meeting_snapshots: normalizedValue.capture_meeting_snapshots,` next to their `capture_meeting_chat` siblings; pass the prop after `captureMeetingChat`:

```tsx
captureMeetingSnapshots={{
  value: values.capture_meeting_snapshots,
  onChange: (value) =>
    submitFieldValue("capture_meeting_snapshots", value),
}}
```

`meeting-settings.tsx`: add `captureMeetingSnapshots: SettingItem;` to the props type and destructuring, and render directly after the "Capture meeting chat in Memos" row (inside the same macOS-only block):

```tsx
<SettingSwitchRow
  title={<Trans>Capture slides from the meeting window</Trans>}
  description={
    <Trans>
      Keep a screenshot of the meeting window whenever the shared content
      changes. Needs Screen Recording access.
    </Trans>
  }
  checked={captureMeetingSnapshots.value}
  onChange={captureMeetingSnapshots.onChange}
/>;
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F desktop exec vitest run src/settings/general && pnpm -F desktop typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 5: i18n + commit**

Run the lingui extract/compile sequence from Global Constraints; German strings:

- "Capture slides from the meeting window" → "Folien aus dem Meeting-Fenster festhalten"
- "Keep a screenshot of the meeting window whenever the shared content changes. Needs Screen Recording access." → "Speichert einen Screenshot des Meeting-Fensters, sobald sich der geteilte Inhalt ändert. Benötigt Zugriff auf Bildschirmaufnahme."

```bash
git add apps/desktop/src/settings apps/desktop/src/i18n
git commit -m "feat(settings): add a switch for meeting slide snapshots"
```

---

### Task 2: Frame comparison

**Files:**

- Create: `apps/desktop/src/stt/meeting-snapshot-diff.ts`
- Test: `apps/desktop/src/stt/meeting-snapshot-diff.test.ts`

**Interfaces:**

- Produces: `frameDifference(a: Uint8Array, b: Uint8Array): number` — fraction in `[0, 1]` of pixels whose grey values differ by more than 24; arrays of unequal length return `1`.
- Produces: `decodeToGreyThumbnail(dataBase64: string, mimeType: string, size?: number): Promise<Uint8Array>` — `size × size` (default 32) greyscale via an `OffscreenCanvas`; rejects when the image cannot be decoded.
- Produces: `THUMBNAIL_SIZE = 32`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { frameDifference } from "./meeting-snapshot-diff";

describe("frameDifference", () => {
  it("is zero for identical frames", () => {
    const frame = new Uint8Array(1024).fill(120);
    expect(frameDifference(frame, frame)).toBe(0);
  });

  it("ignores small brightness noise", () => {
    const a = new Uint8Array(1024).fill(120);
    const b = new Uint8Array(1024).fill(140);
    expect(frameDifference(a, b)).toBe(0);
  });

  it("counts pixels that changed clearly", () => {
    const a = new Uint8Array(1024).fill(0);
    const b = new Uint8Array(1024).fill(0);
    b.fill(255, 0, 256);
    expect(frameDifference(a, b)).toBeCloseTo(0.25);
  });

  it("treats mismatched sizes as fully different", () => {
    expect(frameDifference(new Uint8Array(16), new Uint8Array(32))).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/stt/meeting-snapshot-diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export const THUMBNAIL_SIZE = 32;

// A slide flip changes most of the window; webcam tiles and cursor movement
// change a few pixels by a lot or many pixels by a little. Counting only
// clear per-pixel changes on a coarse thumbnail separates the two.
const PIXEL_CHANGE_THRESHOLD = 24;

export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 1;
  }
  let changed = 0;
  for (let index = 0; index < a.length; index++) {
    if (Math.abs(a[index]! - b[index]!) > PIXEL_CHANGE_THRESHOLD) {
      changed++;
    }
  }
  return changed / a.length;
}

export async function decodeToGreyThumbnail(
  dataBase64: string,
  mimeType: string,
  size = THUMBNAIL_SIZE,
): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  try {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("2d context unavailable");
    }
    context.drawImage(bitmap, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    const grey = new Uint8Array(size * size);
    for (let pixel = 0; pixel < grey.length; pixel++) {
      const offset = pixel * 4;
      grey[pixel] = Math.round(
        0.299 * data[offset]! +
          0.587 * data[offset + 1]! +
          0.114 * data[offset + 2]!,
      );
    }
    return grey;
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Run test**

Run: `pnpm -F desktop exec vitest run src/stt/meeting-snapshot-diff.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stt/meeting-snapshot-diff.ts apps/desktop/src/stt/meeting-snapshot-diff.test.ts
git commit -m "feat(stt): compare meeting window frames on a grey thumbnail"
```

---

### Task 3: Snapshot records

**Files:**

- Create: `apps/desktop/src/stt/meeting-snapshot-records.ts`
- Test: `apps/desktop/src/stt/meeting-snapshot-records.test.ts`

**Interfaces:**

- Consumes: `executeTransaction`, `liveQueryClient`, `useLiveQuery` from `~/db`; `enqueueDatabaseWrite` from `~/db/write-queue`; `id` from `~/shared/utils`.
- Produces:
  ```ts
  export type MeetingSnapshotRecord = {
    id: string;
    attachmentId: string;
    filename: string;
    path: string;
    capturedAtMs: number;
    width: number;
    height: number;
    appName: string;
    windowTitle: string;
  };
  export const MAX_MEETING_SNAPSHOTS = 60;
  export function persistMeetingSnapshotRecord(
    sessionId: string,
    record: Omit<MeetingSnapshotRecord, "id">,
  ): Promise<string>; // resolves to the new id
  export function loadMeetingSnapshotRecords(
    sessionId: string,
  ): Promise<MeetingSnapshotRecord[]>; // capture order
  export function useMeetingSnapshotRecords(
    sessionId: string,
  ): MeetingSnapshotRecord[];
  export function parseMeetingSnapshotDocument(row: {
    id: string;
    body: string;
  }): MeetingSnapshotRecord | null;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, executeTransactionMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  executeTransactionMock: vi.fn(),
}));

vi.mock("~/db", () => ({
  executeTransaction: executeTransactionMock,
  liveQueryClient: { execute: executeMock },
  useLiveQuery: vi.fn(() => ({ data: [] })),
}));
vi.mock("~/db/write-queue", () => ({
  enqueueDatabaseWrite: (_key: string, run: () => Promise<unknown>) => run(),
}));

import {
  loadMeetingSnapshotRecords,
  parseMeetingSnapshotDocument,
  persistMeetingSnapshotRecord,
} from "./meeting-snapshot-records";

const record = {
  attachmentId: "att-1",
  filename: "slide-140301.jpg",
  path: "/tmp/att-1.jpg",
  capturedAtMs: 1_700_000_000_000,
  width: 1600,
  height: 900,
  appName: "zoom.us",
  windowTitle: "Zoom Meeting",
};

describe("meeting snapshot records", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeTransactionMock.mockReset().mockResolvedValue([]);
  });

  it("writes one meeting_snapshot document per frame", async () => {
    const snapshotId = await persistMeetingSnapshotRecord("session-1", record);

    expect(snapshotId).toBeTruthy();
    const [statements] = executeTransactionMock.mock.calls[0]!;
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("'meeting_snapshot'");
    expect(statements[0].params[0]).toBe(snapshotId);
    expect(JSON.parse(statements[0].params[1])).toMatchObject(record);
    expect(statements[0].params.at(-1)).toBe("session-1");
  });

  it("parses stored rows and drops malformed ones", () => {
    expect(
      parseMeetingSnapshotDocument({
        id: "doc-1",
        body: JSON.stringify(record),
      }),
    ).toEqual({ id: "doc-1", ...record });
    expect(parseMeetingSnapshotDocument({ id: "doc-2", body: "{" })).toBeNull();
    expect(
      parseMeetingSnapshotDocument({
        id: "doc-3",
        body: JSON.stringify({ path: 1 }),
      }),
    ).toBeNull();
  });

  it("loads records in capture order", async () => {
    executeMock.mockResolvedValue([
      { id: "doc-1", body: JSON.stringify(record) },
      { id: "doc-2", body: JSON.stringify({ ...record, capturedAtMs: 2 }) },
    ]);

    const records = await loadMeetingSnapshotRecords("session-1");

    expect(executeMock.mock.calls[0]![1]).toEqual(["session-1"]);
    expect(records.map((entry) => entry.id)).toEqual(["doc-1", "doc-2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/stt/meeting-snapshot-records.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useMemo } from "react";

import { executeTransaction, liveQueryClient, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { id } from "~/shared/utils";

export type MeetingSnapshotRecord = {
  id: string;
  attachmentId: string;
  filename: string;
  path: string;
  capturedAtMs: number;
  width: number;
  height: number;
  appName: string;
  windowTitle: string;
};

export const MAX_MEETING_SNAPSHOTS = 60;

const EMPTY_RECORDS: MeetingSnapshotRecord[] = [];

const MEETING_SNAPSHOT_RECORDS_SQL = `
  SELECT id, body
  FROM session_documents
  WHERE session_id = ?
    AND kind = 'meeting_snapshot'
    AND deleted_at IS NULL
  ORDER BY sort_order, created_at, id
  LIMIT ${MAX_MEETING_SNAPSHOTS}
`;

export function persistMeetingSnapshotRecord(
  sessionId: string,
  record: Omit<MeetingSnapshotRecord, "id">,
): Promise<string> {
  const snapshotId = id();
  const createdAt = new Date(record.capturedAtMs).toISOString();
  return enqueueDatabaseWrite(`session:${sessionId}`, async () => {
    await executeTransaction([
      {
        sql: `
          INSERT INTO session_documents (
            id, session_id, kind, title, body_format, body, source_hash,
            generation_metadata_json, sort_order, created_by, updated_by,
            created_at, updated_at, deleted_at
          )
          SELECT
            ?, id, 'meeting_snapshot', ?, 'json', ?, '', ?, ?, owner_user_id,
            owner_user_id, ?, ?, NULL
          FROM sessions
          WHERE id = ? AND deleted_at IS NULL
        `,
        params: [
          snapshotId,
          record.filename,
          JSON.stringify(record),
          JSON.stringify({ source: "meeting_window_capture", version: 1 }),
          record.capturedAtMs,
          createdAt,
          createdAt,
          sessionId,
        ],
      },
    ]);
    return snapshotId;
  });
}

export function parseMeetingSnapshotDocument(row: {
  id: string;
  body: string;
}): MeetingSnapshotRecord | null {
  try {
    const value = JSON.parse(row.body) as Partial<MeetingSnapshotRecord>;
    if (
      typeof value.attachmentId !== "string" ||
      typeof value.filename !== "string" ||
      typeof value.path !== "string" ||
      typeof value.capturedAtMs !== "number" ||
      typeof value.width !== "number" ||
      typeof value.height !== "number"
    ) {
      return null;
    }
    return {
      id: row.id,
      attachmentId: value.attachmentId,
      filename: value.filename,
      path: value.path,
      capturedAtMs: value.capturedAtMs,
      width: value.width,
      height: value.height,
      appName: typeof value.appName === "string" ? value.appName : "",
      windowTitle:
        typeof value.windowTitle === "string" ? value.windowTitle : "",
    };
  } catch {
    return null;
  }
}

function parseRows(rows: Array<{ id: string; body: string }>) {
  return rows.flatMap((row) => {
    const record = parseMeetingSnapshotDocument(row);
    return record ? [record] : [];
  });
}

export async function loadMeetingSnapshotRecords(
  sessionId: string,
): Promise<MeetingSnapshotRecord[]> {
  if (!sessionId) return [];
  const rows = await liveQueryClient.execute<{ id: string; body: string }>(
    MEETING_SNAPSHOT_RECORDS_SQL,
    [sessionId],
  );
  return parseRows(rows);
}

export function useMeetingSnapshotRecords(
  sessionId: string,
): MeetingSnapshotRecord[] {
  const { data = EMPTY_RECORDS } = useLiveQuery<
    { id: string; body: string },
    MeetingSnapshotRecord[]
  >({
    sql: MEETING_SNAPSHOT_RECORDS_SQL,
    params: [sessionId],
    enabled: Boolean(sessionId),
    mapRows: parseRows,
  });
  return useMemo(() => (sessionId ? data : EMPTY_RECORDS), [data, sessionId]);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm -F desktop exec vitest run src/stt/meeting-snapshot-records.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stt/meeting-snapshot-records.ts apps/desktop/src/stt/meeting-snapshot-records.test.ts
git commit -m "feat(stt): store meeting window snapshots as session documents"
```

---

### Task 4: Capture loop

**Files:**

- Create: `apps/desktop/src/stt/meeting-snapshot-capture.ts`
- Test: `apps/desktop/src/stt/meeting-snapshot-capture.test.ts`

**Interfaces:**

- Consumes: `commands as detectCommands` from `@anlg/plugin-detect` (`inspectMeetingAccessibility()`, `listMicUsingApplications()`); `commands as screenCommands` from `@anlg/plugin-screen` (`captureTargetWindowContext(target, options)`); `commands as fsSyncCommands` from `@anlg/plugin-fs-sync` (`attachmentSave(sessionId, data: number[], filename)`); `commands as permissionsCommands` from `@anlg/plugin-permissions` (`checkPermission("screenRecording")`); `catalogLocalNoteAttachment`, `sha256Hex` from `~/session/attachments`; `getStoredSettingValues` from `~/settings/queries`; `resolveConfigValue` from `~/shared/config`; `useTabs` from `~/store/zustand/tabs` (for the toast action); Task 2 and Task 3 exports.
- Produces: `startMeetingSnapshotCapture({ sessionId, isEnabled?, now? }): () => Promise<void>`; exported constants `MEETING_SNAPSHOT_INTERVAL_MS = 10_000`, `MEETING_SNAPSHOT_MIN_GAP_MS = 15_000`, `MEETING_SNAPSHOT_CHANGE_THRESHOLD = 0.06`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  listMicApps: vi.fn(),
  capture: vi.fn(),
  attachmentSave: vi.fn(),
  checkPermission: vi.fn(),
  catalog: vi.fn(),
  persist: vi.fn(),
  decode: vi.fn(),
  toastWarning: vi.fn(),
  setting: { value: true },
}));

vi.mock("@anlg/plugin-detect", () => ({
  commands: {
    inspectMeetingAccessibility: mocks.inspect,
    listMicUsingApplications: mocks.listMicApps,
  },
}));
vi.mock("@anlg/plugin-screen", () => ({
  commands: { captureTargetWindowContext: mocks.capture },
}));
vi.mock("@anlg/plugin-fs-sync", () => ({
  commands: { attachmentSave: mocks.attachmentSave },
}));
vi.mock("@anlg/plugin-permissions", () => ({
  commands: { checkPermission: mocks.checkPermission },
}));
vi.mock("~/session/attachments", () => ({
  catalogLocalNoteAttachment: mocks.catalog,
  sha256Hex: vi.fn(async () => "a".repeat(64)),
}));
vi.mock("~/stt/meeting-snapshot-records", () => ({
  persistMeetingSnapshotRecord: mocks.persist,
  MAX_MEETING_SNAPSHOTS: 60,
}));
vi.mock("~/stt/meeting-snapshot-diff", async () => ({
  ...(await vi.importActual<typeof import("./meeting-snapshot-diff")>(
    "./meeting-snapshot-diff",
  )),
  decodeToGreyThumbnail: mocks.decode,
}));
vi.mock("@anlg/ui/components/ui/toast", () => ({
  sonnerToast: { warning: mocks.toastWarning, dismiss: vi.fn() },
}));
vi.mock("~/store/zustand/tabs", () => ({
  useTabs: { getState: () => ({ openNew: vi.fn() }) },
}));
vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: vi.fn(async () => ({
    values: { capture_meeting_snapshots: mocks.setting.value },
    hasValues: new Set(["capture_meeting_snapshots"]),
  })),
}));

import {
  MEETING_SNAPSHOT_INTERVAL_MS,
  MEETING_SNAPSHOT_MIN_GAP_MS,
  startMeetingSnapshotCapture,
} from "./meeting-snapshot-capture";

const inspection = {
  app: { id: "us.zoom.xos", name: "zoom.us" },
  pid: 42,
  platform: "zoom",
  surface: "native",
  accessibilityTrusted: true,
  windowTitle: "Zoom Meeting",
  participantStreams: [],
  activeSpeakers: [],
  warnings: [],
};

function frame(fill: number) {
  return new Uint8Array(1024).fill(fill);
}

function captureResult() {
  return {
    status: "ok" as const,
    data: {
      mimeType: "image/jpeg",
      dataBase64: btoa("frame"),
      capturedAtMs: Date.now(),
      width: 1600,
      height: 900,
      strategy: "window",
      crop: { x: 0, y: 0, width: 1600, height: 900 },
      subject: {
        kind: "window",
        window: {
          id: 1,
          pid: 42,
          appName: "zoom.us",
          title: "Zoom Meeting",
          rect: { x: 0, y: 0, width: 1600, height: 900 },
        },
      },
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("startMeetingSnapshotCapture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T14:03:01.000Z"));
    Object.values(mocks).forEach(
      (mock) => typeof mock === "function" && mock.mockReset(),
    );
    mocks.setting.value = true;
    mocks.checkPermission.mockResolvedValue({
      status: "ok",
      data: "authorized",
    });
    mocks.listMicApps.mockResolvedValue({
      status: "ok",
      data: [{ id: "us.zoom.xos", name: "zoom.us" }],
    });
    mocks.inspect.mockResolvedValue({ status: "ok", data: [inspection] });
    mocks.capture.mockResolvedValue(captureResult());
    mocks.attachmentSave.mockResolvedValue({
      status: "ok",
      data: { path: "/tmp/att-1.jpg", attachmentId: "att-1" },
    });
    mocks.catalog.mockResolvedValue(undefined);
    mocks.persist.mockResolvedValue("doc-1");
    mocks.decode.mockResolvedValue(frame(10));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps the first frame of the meeting window", async () => {
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();

    expect(mocks.capture).toHaveBeenCalledWith(
      { pid: 42, appName: "zoom.us", title: "Zoom Meeting" },
      { imagePolicy: { maxLongSide: 1600 } },
    );
    expect(mocks.attachmentSave).toHaveBeenCalledWith(
      "session-1",
      expect.any(Array),
      "slide-140301.jpg",
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        attachmentId: "att-1",
        path: "/tmp/att-1.jpg",
        appName: "zoom.us",
        windowTitle: "Zoom Meeting",
        width: 1600,
        height: 900,
      }),
    );
    await stop();
  });

  test("skips frames that look like the last kept one", async () => {
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();
    mocks.decode.mockResolvedValue(frame(20));

    await vi.advanceTimersByTimeAsync(MEETING_SNAPSHOT_INTERVAL_MS * 2);

    expect(mocks.attachmentSave).toHaveBeenCalledTimes(1);
    await stop();
  });

  test("keeps a changed frame once the minimum gap passed", async () => {
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();
    mocks.decode.mockResolvedValue(frame(200));

    await vi.advanceTimersByTimeAsync(MEETING_SNAPSHOT_INTERVAL_MS);
    expect(mocks.attachmentSave).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MEETING_SNAPSHOT_MIN_GAP_MS);
    expect(mocks.attachmentSave).toHaveBeenCalledTimes(2);
    await stop();
  });

  test("does nothing while the setting is off", async () => {
    mocks.setting.value = false;
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();

    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    await stop();
  });

  test("warns once and stops without screen recording access", async () => {
    mocks.checkPermission.mockResolvedValue({ status: "ok", data: "denied" });
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();
    await vi.advanceTimersByTimeAsync(MEETING_SNAPSHOT_INTERVAL_MS * 2);

    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.capture).not.toHaveBeenCalled();
    await stop();
  });

  test("skips the tick when no meeting window is found", async () => {
    mocks.inspect.mockResolvedValue({ status: "ok", data: [] });
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();

    expect(mocks.capture).not.toHaveBeenCalled();
    await stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/stt/meeting-snapshot-capture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { commands as detectCommands } from "@anlg/plugin-detect";
import type { MeetingAccessibilityInspection } from "@anlg/plugin-detect";
import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { commands as permissionsCommands } from "@anlg/plugin-permissions";
import { commands as screenCommands } from "@anlg/plugin-screen";
import { sonnerToast } from "@anlg/ui/components/ui/toast";

import { catalogLocalNoteAttachment, sha256Hex } from "~/session/attachments";
import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";
import { useTabs } from "~/store/zustand/tabs";
import {
  decodeToGreyThumbnail,
  frameDifference,
} from "~/stt/meeting-snapshot-diff";
import {
  MAX_MEETING_SNAPSHOTS,
  persistMeetingSnapshotRecord,
} from "~/stt/meeting-snapshot-records";

export const MEETING_SNAPSHOT_INTERVAL_MS = 10_000;
export const MEETING_SNAPSHOT_MIN_GAP_MS = 15_000;
export const MEETING_SNAPSHOT_CHANGE_THRESHOLD = 0.06;
const MAX_LONG_SIDE = 1600;

/**
 * Screenshots only the meeting window, and only when what it shows changed.
 * Everything else on a large monitor is noise, and a frame per tick would be
 * hundreds of near-identical files per meeting.
 */
export function startMeetingSnapshotCapture({
  sessionId,
  isEnabled,
  now = Date.now,
}: {
  sessionId: string;
  isEnabled?: () => boolean | Promise<boolean>;
  now?: () => number;
}) {
  const captureIsEnabled =
    isEnabled ??
    (async () =>
      resolveConfigValue(
        "capture_meeting_snapshots",
        await getStoredSettingValues(),
      ));

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let permissionChecked = false;
  let lastKept: { grey: Uint8Array; atMs: number } | null = null;
  let keptCount = 0;
  let lastCaptureError = "";

  const captureOnce = async () => {
    if (!(await captureIsEnabled())) return;
    if (!permissionChecked) {
      permissionChecked = true;
      const permission =
        await permissionsCommands.checkPermission("screenRecording");
      if (permission.status !== "ok" || permission.data !== "authorized") {
        sonnerToast.warning(
          "Screen Recording access is needed to capture meeting slides.",
          {
            id: "meeting-snapshot-permission",
            action: {
              label: "Open Settings",
              onClick: () =>
                useTabs.getState().openNew({
                  type: "settings",
                  state: { tab: "permissions" },
                }),
            },
          },
        );
        stopped = true;
        return;
      }
    }
    if (keptCount >= MAX_MEETING_SNAPSHOTS) return;

    const target = await findMeetingWindow();
    if (!target || stopped) return;

    const captured = await screenCommands.captureTargetWindowContext(
      { pid: target.pid, appName: target.app.name, title: target.windowTitle },
      { imagePolicy: { maxLongSide: MAX_LONG_SIDE } },
    );
    if (captured.status === "error") {
      if (captured.error !== lastCaptureError) {
        console.warn(
          "[listener] meeting window capture failed",
          captured.error,
        );
        lastCaptureError = captured.error;
      }
      return;
    }
    if (stopped) return;

    const grey = await decodeToGreyThumbnail(
      captured.data.dataBase64,
      captured.data.mimeType,
    );
    const capturedAtMs = now();
    if (lastKept) {
      const changed = frameDifference(lastKept.grey, grey);
      const gapMs = capturedAtMs - lastKept.atMs;
      if (
        changed < MEETING_SNAPSHOT_CHANGE_THRESHOLD ||
        gapMs < MEETING_SNAPSHOT_MIN_GAP_MS
      ) {
        return;
      }
    }

    const bytes = Uint8Array.from(atob(captured.data.dataBase64), (char) =>
      char.charCodeAt(0),
    );
    const extension = captured.data.mimeType === "image/png" ? "png" : "jpg";
    const filename = `slide-${timeStamp(capturedAtMs)}.${extension}`;
    const saved = await fsSyncCommands.attachmentSave(
      sessionId,
      Array.from(bytes),
      filename,
    );
    if (saved.status === "error") {
      console.warn("[listener] failed to store meeting snapshot", saved.error);
      return;
    }
    await catalogLocalNoteAttachment({
      sessionId,
      attachmentId: saved.data.attachmentId,
      filename,
      contentType: captured.data.mimeType,
      sizeBytes: bytes.byteLength,
      sha256: await sha256Hex(bytes.buffer),
    });
    await persistMeetingSnapshotRecord(sessionId, {
      attachmentId: saved.data.attachmentId,
      filename,
      path: saved.data.path,
      capturedAtMs,
      width: captured.data.width,
      height: captured.data.height,
      appName: target.app.name,
      windowTitle: target.windowTitle ?? "",
    });
    lastKept = { grey, atMs: capturedAtMs };
    keptCount++;
  };

  const capture = () => {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    const pending = captureOnce()
      .catch((error) => {
        console.warn("[listener] meeting snapshot tick failed", error);
      })
      .finally(() => {
        if (inFlight === pending) inFlight = null;
      });
    inFlight = pending;
    return pending;
  };

  void capture();
  const interval = setInterval(() => {
    void capture();
  }, MEETING_SNAPSHOT_INTERVAL_MS);

  return async () => {
    stopped = true;
    clearInterval(interval);
    await inFlight;
  };
}

// The meeting app that is on the mic is the one on screen; without that
// signal any detected meeting window will do.
async function findMeetingWindow(): Promise<MeetingAccessibilityInspection | null> {
  const inspected = await detectCommands.inspectMeetingAccessibility();
  if (inspected.status === "error" || inspected.data.length === 0) return null;
  const micApps = await detectCommands.listMicUsingApplications();
  const micIds = new Set(
    micApps.status === "ok" ? micApps.data.map((app) => app.id) : [],
  );
  return (
    inspected.data.find((entry) => micIds.has(entry.app.id)) ??
    inspected.data[0] ??
    null
  );
}

function timeStamp(atMs: number) {
  const date = new Date(atMs);
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
}
```

Note for the implementer: `sha256Hex` takes an `ArrayBuffer` (see `useFileUpload.ts`); `bytes.buffer` is that buffer because `Uint8Array.from` allocates a fresh one. The test's filename expectation (`slide-140301.jpg`) relies on `getUTC*` with the fake system time — keep UTC so the test is timezone-independent.

- [ ] **Step 4: Wire the screen plugin into the app**

The screen plugin is compiled (`tauri-plugin-screen` in `apps/desktop/src-tauri/Cargo.toml`) and allowed (`"screen:default"` in `apps/desktop/src-tauri/capabilities/default.json`) but never registered or imported.

`apps/desktop/package.json`, in `dependencies`, alphabetically next to the other `@anlg/plugin-*` entries:

```json
"@anlg/plugin-screen": "workspace:*",
```

Run: `pnpm install` (workspace link only; the lockfile gains one workspace entry — commit it).

`apps/desktop/src-tauri/src/lib.rs`, directly after `.plugin(tauri_plugin_detect::init())` (~line 201):

```rust
.plugin(tauri_plugin_screen::init())
```

Run: `cargo check -p desktop`
Expected: Finished with no errors.

- [ ] **Step 5: Run test**

Run: `pnpm -F desktop exec vitest run src/stt/meeting-snapshot-capture.test.ts && pnpm -F desktop typecheck`
Expected: PASS (6 tests), 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/stt/meeting-snapshot-capture.ts apps/desktop/src/stt/meeting-snapshot-capture.test.ts apps/desktop/package.json apps/desktop/src-tauri/src/lib.rs pnpm-lock.yaml
git commit -m "feat(stt): capture the meeting window when its content changes"
```

---

### Task 5: Run the loop while listening

**Files:**

- Modify: `apps/desktop/src/stt/capture-lifecycle.ts:173-193` (next to `stopMeetingChatCaptureRef`) and the return object (~lines 754-764)
- Modify: `apps/desktop/src/stt/useStartListening.ts:36-40` (destructuring) and `:207-220` (after `setStopMeetingChatCapture(...)`)
- Test: `apps/desktop/src/stt/useStartListening.test.ts`

**Interfaces:**

- Consumes: `startMeetingSnapshotCapture` from Task 4.
- Produces: `useCaptureLifecycle` returns `setStopMeetingSnapshotCapture(stop: (() => Promise<void>) | null)`; `stopMeetingChatTasks` also awaits the snapshot loop's stop.

- [ ] **Step 1: Write the failing test**

Open `useStartListening.test.ts`, find how `startMeetingChatCapture` is mocked and asserted (search for `startMeetingChatCapture`), and add a sibling mock plus this test in the same describe block that asserts chat capture starts:

```ts
test("starts meeting snapshot capture alongside chat capture", async () => {
  // reuse the arrange steps of the neighbouring chat-capture test verbatim
  await startListeningForTest();

  expect(startMeetingSnapshotCaptureMock).toHaveBeenCalledWith({
    sessionId: "session-1",
  });
  expect(setStopMeetingSnapshotCaptureMock).toHaveBeenCalledWith(
    snapshotStopMock,
  );
});
```

with, in the hoisted mocks: `startMeetingSnapshotCaptureMock: vi.fn(() => snapshotStopMock)`, `snapshotStopMock: vi.fn(async () => {})`, `setStopMeetingSnapshotCaptureMock: vi.fn()`, `vi.mock("~/stt/meeting-snapshot-capture", () => ({ startMeetingSnapshotCapture: startMeetingSnapshotCaptureMock }))`, and `setStopMeetingSnapshotCapture: setStopMeetingSnapshotCaptureMock` added wherever the test builds the `useCaptureLifecycle` return value.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/stt/useStartListening.test.ts`
Expected: FAIL — `startMeetingSnapshotCapture` never called.

- [ ] **Step 3: Implement**

`capture-lifecycle.ts`, after `stopMeetingChatCaptureRef`:

```ts
const stopMeetingSnapshotCaptureRef = useRef<(() => Promise<void>) | null>(
  null,
);
```

Extend `stopMeetingChatTasks` so it stops both loops:

```ts
const stopMeetingChatTasks = useCallback(async () => {
  const stops = [
    stopMeetingChatCaptureRef,
    stopMeetingSnapshotCaptureRef,
  ].flatMap((ref) => {
    const stop = ref.current;
    if (!stop) return [];
    return [
      stop().finally(() => {
        if (ref.current === stop) ref.current = null;
      }),
    ];
  });
  await Promise.all(stops);
}, []);
const setStopMeetingSnapshotCapture = useCallback(
  (stop: (() => Promise<void>) | null) => {
    stopMeetingSnapshotCaptureRef.current = stop;
  },
  [],
);
```

Add `setStopMeetingSnapshotCapture` to the returned object and its memo dependency list next to `setStopMeetingChatCapture`.

`useStartListening.ts`: destructure `setStopMeetingSnapshotCapture` next to `setStopMeetingChatCapture`, import `startMeetingSnapshotCapture` from `~/stt/meeting-snapshot-capture`, and right after the `setStopMeetingChatCapture(startMeetingChatCapture({...}))` call add:

```ts
setStopMeetingSnapshotCapture(startMeetingSnapshotCapture({ sessionId }));
```

Add `setStopMeetingSnapshotCapture` to the `useCallback` dependency list where `setStopMeetingChatCapture` is listed.

- [ ] **Step 4: Run tests**

Run: `pnpm -F desktop exec vitest run src/stt && pnpm -F desktop typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/stt
git commit -m "feat(stt): run meeting snapshot capture while listening"
```

---

### Task 6: Snapshots in the summary context

**Files:**

- Modify: `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-transform.ts` (the `collectEnhanceImageContext` call, ~lines 96-104)
- Test: `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-transform.test.ts`

**Interfaces:**

- Consumes: `loadMeetingSnapshotRecords` from Task 3; `collectEnhanceImageContext(sessionId, markdown: string[])` (existing).
- Produces: exported `snapshotImageMarkdown(records: MeetingSnapshotRecord[]): string[]` — one `![Slide HH:MM](path)` line per record, in capture order.

- [ ] **Step 1: Write the failing test**

Add to the hoisted mocks in `enhance-transform.test.ts`: `loadMeetingSnapshotRecords: vi.fn()`, and `vi.mock("~/stt/meeting-snapshot-records", () => ({ loadMeetingSnapshotRecords: mocks.loadMeetingSnapshotRecords }))`; in `beforeEach`: `mocks.loadMeetingSnapshotRecords.mockResolvedValue([])`. Then:

```ts
it("hands meeting snapshots to the image context", async () => {
  mocks.loadMeetingSnapshotRecords.mockResolvedValue([
    {
      id: "doc-1",
      attachmentId: "att-1",
      filename: "slide-140301.jpg",
      path: "/tmp/att-1.jpg",
      capturedAtMs: Date.UTC(2026, 8, 2, 14, 3, 1),
      width: 1600,
      height: 900,
      appName: "zoom.us",
      windowTitle: "Zoom Meeting",
    },
  ]);
  mocks.collectEnhanceImageContext.mockResolvedValue([]);

  await enhanceTransform.transformArgs(
    { sessionId: "session-1", enhancedNoteId: "note-1", templateId: "" },
    settingsValues,
  );

  const [, markdown] = mocks.collectEnhanceImageContext.mock.calls[0]!;
  expect(markdown).toContain("![Slide 14:03](/tmp/att-1.jpg)");
});
```

Check the existing test's `settingsValues` and provider mocks: `collectEnhanceImageContext` is only called when `modelSupportsImageInput` is true for the configured provider/model. If the existing fixture's provider does not support images, set `current_llm_provider`/`current_llm_model` in this test to a pair `modelSupportsImageInput` accepts (see `settings/ai/shared/model-capabilities.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/store/zustand/ai-task/task-configs/enhance-transform.test.ts`
Expected: FAIL — markdown does not contain the slide line.

- [ ] **Step 3: Implement**

In `enhance-transform.ts` add the import `import { loadMeetingSnapshotRecords, type MeetingSnapshotRecord } from "~/stt/meeting-snapshot-records";` and replace the `imageContext` computation:

```ts
const imageContext = modelSupportsImageInput(
  getOptionalSettingsValue(settingsValues, "current_llm_provider"),
  getOptionalSettingsValue(settingsValues, "current_llm_model"),
)
  ? await collectEnhanceImageContext(sessionId, [
      sessionContext.preMeetingMemo,
      sessionContext.postMeetingMemo,
      ...snapshotImageMarkdown(await loadMeetingSnapshotRecords(sessionId)),
    ])
  : [];
```

and add:

```ts
// Slides ride along as markdown image lines so the existing attachment lookup,
// byte budget, and sampling apply to them like to images in the note.
export function snapshotImageMarkdown(records: MeetingSnapshotRecord[]) {
  return records.map((record) => {
    const date = new Date(record.capturedAtMs);
    const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(
      date.getUTCMinutes(),
    ).padStart(2, "0")}`;
    return `![Slide ${time}](${record.path})`;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F desktop exec vitest run src/store/zustand/ai-task && pnpm -F desktop typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/store/zustand/ai-task/task-configs
git commit -m "feat(enhance): include meeting snapshots as image context"
```

---

### Task 7: Thumbnail strip in the note

**Files:**

- Modify: `apps/desktop/src/session/editor-activity.ts` (add a getter)
- Create: `apps/desktop/src/session/components/note-input/snapshot-strip.tsx`
- Modify: `apps/desktop/src/session/components/note-input/raw.tsx` (mount above the editor)
- Test: `apps/desktop/src/session/components/note-input/snapshot-strip.test.tsx`

**Interfaces:**

- Consumes: `useMeetingSnapshotRecords` from Task 3; `convertFileSrc` from `@tauri-apps/api/core`; `registerCanonicalSessionEditor` registry.
- Produces: `getCanonicalSessionEditor(sessionId: string): EditorView | null` in `editor-activity.ts`; `SnapshotStrip({ sessionId })` component.

- [ ] **Step 1: Write the failing test**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  dispatch: vi.fn(),
}));

vi.mock("~/stt/meeting-snapshot-records", () => ({
  useMeetingSnapshotRecords: () => mocks.records,
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("~/session/editor-activity", () => ({
  getCanonicalSessionEditor: () => ({
    state: {
      doc: { content: { size: 10 } },
      schema: { nodes: { image: { create: (attrs: unknown) => ({ attrs }) } } },
      tr: { insert: vi.fn((pos: number, node: unknown) => ({ pos, node })) },
    },
    dispatch: mocks.dispatch,
  }),
}));

import { SnapshotStrip } from "./snapshot-strip";

describe("SnapshotStrip", () => {
  afterEach(() => {
    cleanup();
    mocks.records = [];
    mocks.dispatch.mockReset();
  });

  it("renders nothing without snapshots", () => {
    const { container } = render(<SnapshotStrip sessionId="session-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("inserts a clicked slide into the note", () => {
    mocks.records = [
      {
        id: "doc-1",
        attachmentId: "att-1",
        filename: "slide-140301.jpg",
        path: "/tmp/att-1.jpg",
        capturedAtMs: Date.UTC(2026, 8, 2, 14, 3, 1),
        width: 1600,
        height: 900,
        appName: "zoom.us",
        windowTitle: "Zoom Meeting",
      },
    ];
    render(<SnapshotStrip sessionId="session-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Insert slide from 14:03" }),
    );

    expect(mocks.dispatch).toHaveBeenCalledWith({
      pos: 10,
      node: {
        attrs: {
          src: "asset://localhost/tmp/att-1.jpg",
          attachmentId: "att-1",
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/session/components/note-input/snapshot-strip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`editor-activity.ts`, after `unregisterCanonicalSessionEditor`:

```ts
export function getCanonicalSessionEditor(
  sessionId: string,
): EditorView | null {
  const editors = mountedCanonicalEditors.get(sessionId);
  return editors ? (editors.keys().next().value ?? null) : null;
}
```

`snapshot-strip.tsx`:

```tsx
import { useLingui } from "@lingui/react/macro";
import { convertFileSrc } from "@tauri-apps/api/core";

import { getCanonicalSessionEditor } from "~/session/editor-activity";
import { useMeetingSnapshotRecords } from "~/stt/meeting-snapshot-records";

/**
 * Slides captured from the meeting window. They stay out of the note until
 * the user picks one, so a forty-slide deck does not bury the notes.
 */
export function SnapshotStrip({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const records = useMeetingSnapshotRecords(sessionId);

  if (records.length === 0) {
    return null;
  }

  const insert = (record: (typeof records)[number]) => {
    const view = getCanonicalSessionEditor(sessionId);
    if (!view) return;
    const node = view.state.schema.nodes.image.create({
      src: convertFileSrc(record.path),
      attachmentId: record.attachmentId,
    });
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, node));
  };

  return (
    <div
      data-session-snapshots
      className="scrollbar-hide flex shrink-0 gap-2 overflow-x-auto px-3 pt-2 pb-1"
    >
      {records.map((record) => {
        const time = formatTime(record.capturedAtMs);
        return (
          <button
            key={record.id}
            type="button"
            aria-label={t`Insert slide from ${time}`}
            title={t`Insert slide from ${time}`}
            onClick={() => insert(record)}
            className="border-border hover:border-foreground/40 flex shrink-0 flex-col gap-1 rounded-md border p-1 text-left"
          >
            <img
              src={convertFileSrc(record.path)}
              alt=""
              width={112}
              height={63}
              className="h-[63px] w-28 rounded-sm object-cover"
            />
            <span className="text-muted-foreground px-0.5 text-[10px] tabular-nums">
              {time}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatTime(atMs: number) {
  const date = new Date(atMs);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}`;
}
```

Timezone note: the summary label (Task 6) and this caption both use UTC for now so the tests are deterministic; the follow-up to show local time is to replace `getUTC*` with `getHours`/`getMinutes` in both places and adjust the two test expectations with a fixed `TZ` — out of scope for v1.

`raw.tsx`: import `SnapshotStrip` and render `<SnapshotStrip sessionId={sessionId} />` as the first child of the element that wraps the editor (directly above the `<NoteEditor …>` / editor component the file renders — locate the JSX where `fileHandlerConfig={fileHandlerConfig}` is passed and place the strip immediately before that element's opening tag, inside the same parent). Any raw-tab test that renders `Raw` needs `vi.mock("./snapshot-strip", () => ({ SnapshotStrip: () => null }))` if it does not already provide a `~/db` live-query mock; run the suite in Step 4 to see which.

- [ ] **Step 4: Run tests**

Run: `pnpm -F desktop exec vitest run src/session && pnpm -F desktop typecheck && pnpm exec oxlint --quiet --format=github apps/desktop/src/`
Expected: PASS, 0 type errors, 0 lint errors.

- [ ] **Step 5: i18n + commit**

German for "Insert slide from {time}": "Folie von {time} einfügen". Run the lingui sequence, then:

```bash
git add apps/desktop/src/session apps/desktop/src/i18n
git commit -m "feat(session): show captured meeting slides above the note"
```

---

### Task 8: Manual verification on the dev build

**Files:** none.

- [ ] **Step 1: Rebuild and launch**

Run: `pkill -f "^target/debug/desktop"; pnpm exec turbo dev:desktop` (TS-only changes hot-reload; a relaunch is only needed if the app was not running).

- [ ] **Step 2: Grant Screen Recording** to the dev build under Settings › Permissions (macOS prompts once; the app may need a relaunch after granting).

- [ ] **Step 3: Enable** Settings › General › Meetings › "Capture slides from the meeting window".

- [ ] **Step 4: Exercise** — start a Zoom/Meet/Teams call (or a browser tab on `meet.google.com` with a shared screen), start listening in Session Echo, change the shared slide three times ≥ 15 s apart. Expected: `~/Library/Application Support/de.flagbit.sessionecho.dev/sessions/<session>/attachments/` gains `slide-HHMMSS.jpg` files only on changes; the Notes tab shows the thumbnail strip; clicking a thumbnail appends the image to the note; "Regenerate summary" produces a summary that references slide content.

- [ ] **Step 5: Negative check** — revoke Screen Recording, start a new session: exactly one warning toast, no files written.

---

## Self-Review

**Spec coverage:** Setting (Task 1), window detection + capture + diff + storage (Tasks 2–4), lifecycle (Task 5), summary context (Task 6), note UI (Task 7), permission handling (Task 4), cap of 60 (Tasks 3–4), verification (Task 8). Non-goals untouched.

**Placeholder scan:** no TBD/TODO; every code step carries the code; the only "locate" instructions (raw.tsx mount point, useStartListening test arrange steps) name the exact anchor to search for.

**Type consistency:** `MeetingSnapshotRecord` fields identical in Tasks 3, 4, 6, 7; `startMeetingSnapshotCapture({ sessionId, isEnabled?, now? })` returns `() => Promise<void>` and is called with `{ sessionId }` in Task 5; `getCanonicalSessionEditor(sessionId)` defined in Task 7 and used there; `snapshotImageMarkdown` defined and used in Task 6.
