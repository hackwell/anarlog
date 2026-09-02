import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  listMicApps: vi.fn(),
  capture: vi.fn(),
  attachmentSave: vi.fn(),
  attachmentRemove: vi.fn(),
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
  commands: {
    attachmentSave: mocks.attachmentSave,
    attachmentRemove: mocks.attachmentRemove,
  },
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
  await vi.advanceTimersByTimeAsync(0);
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
    mocks.attachmentRemove.mockResolvedValue({ status: "ok", data: null });
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

  test("skips an untitled window even without a mic match", async () => {
    mocks.inspect.mockResolvedValue({
      status: "ok",
      data: [{ ...inspection, windowTitle: null }],
    });
    mocks.listMicApps.mockResolvedValue({ status: "ok", data: [] });
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();

    expect(mocks.capture).not.toHaveBeenCalled();
    await stop();
  });

  test("captures a titled window even without a mic match", async () => {
    mocks.inspect.mockResolvedValue({
      status: "ok",
      data: [{ ...inspection, windowTitle: "Zoom Meeting" }],
    });
    mocks.listMicApps.mockResolvedValue({
      status: "ok",
      data: [{ id: "com.other.app", name: "Other" }],
    });
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();

    expect(mocks.capture).toHaveBeenCalledWith(
      { pid: 42, appName: "zoom.us", title: "Zoom Meeting" },
      { imagePolicy: { maxLongSide: 1600 } },
    );
    await stop();
  });

  test("rolls back the saved file when cataloging fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.catalog.mockRejectedValue(new Error("catalog down"));
    const stop = startMeetingSnapshotCapture({ sessionId: "session-1" });
    await flush();

    expect(mocks.attachmentRemove).toHaveBeenCalledWith("session-1", "att-1");
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalled();
    await stop();
    consoleWarn.mockRestore();
  });
});
