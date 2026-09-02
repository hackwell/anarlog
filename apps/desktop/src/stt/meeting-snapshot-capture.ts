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
