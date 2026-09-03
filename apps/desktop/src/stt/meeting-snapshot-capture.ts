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
  loadMeetingSnapshotRecords,
  persistMeetingSnapshotRecord,
} from "~/stt/meeting-snapshot-records";

export const MEETING_SNAPSHOT_INTERVAL_MS = 10_000;
export const MEETING_SNAPSHOT_MIN_GAP_MS = 15_000;
export const MEETING_SNAPSHOT_CHANGE_THRESHOLD = 0.06;
const MAX_LONG_SIDE = 1600;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

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
  // The cap is per session, not per listening run: a session that was stopped
  // and resumed continues counting where it left off.
  let keptCount: number | null = null;
  let lastCaptureError = "";
  let noTargetLogged = false;
  let interval: ReturnType<typeof setInterval> | null = null;

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
        if (interval) clearInterval(interval);
        return;
      }
    }
    if (stopped || !(await captureIsEnabled())) return;
    keptCount ??= (await loadMeetingSnapshotRecords(sessionId)).length;
    if (keptCount >= MAX_MEETING_SNAPSHOTS) return;

    const target = await findMeetingWindow();
    if (!target) {
      if (!noTargetLogged) {
        noTargetLogged = true;
        console.info("[listener] no meeting window to capture slides from");
      }
      return;
    }
    if (stopped || !(await captureIsEnabled())) return;

    const captured = await screenCommands.captureTargetWindowContext(
      {
        windowId: null,
        pid: target.pid,
        appName: target.app.name,
        title: target.windowTitle ?? null,
        contentRect: target.contentFrame
          ? {
              x: Math.round(target.contentFrame.x),
              y: Math.round(target.contentFrame.y),
              width: Math.round(target.contentFrame.width),
              height: Math.round(target.contentFrame.height),
            }
          : null,
      },
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
    if (stopped || !(await captureIsEnabled())) return;

    const capturedAtMs = now();
    if (
      lastKept &&
      capturedAtMs - lastKept.atMs < MEETING_SNAPSHOT_MIN_GAP_MS
    ) {
      return;
    }

    const grey = await decodeToGreyThumbnail(
      captured.data.dataBase64,
      captured.data.mimeType,
    );
    if (lastKept) {
      const changed = frameDifference(lastKept.grey, grey);
      if (changed < MEETING_SNAPSHOT_CHANGE_THRESHOLD) {
        return;
      }
    }

    const bytes = Uint8Array.from(atob(captured.data.dataBase64), (char) =>
      char.charCodeAt(0),
    );
    const extension = IMAGE_EXTENSIONS[captured.data.mimeType] ?? "png";
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
    try {
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
        // The inspection has no title when the AX tree was too large to scope;
        // the window list still knows what the window is called.
        windowTitle:
          target.windowTitle ??
          (captured.data.subject.kind === "window"
            ? captured.data.subject.window.title
            : ""),
        text: await recognizeText(captured.data.dataBase64),
      });
    } catch (error) {
      console.warn(
        "[listener] failed to catalog meeting snapshot, rolling back",
        error,
      );
      try {
        const cleanup = await fsSyncCommands.attachmentRemove(
          sessionId,
          saved.data.attachmentId,
        );
        if (cleanup.status === "error") {
          console.warn(
            "[listener] failed to roll back meeting snapshot file",
            cleanup.error,
          );
        }
      } catch (cleanupError) {
        console.warn(
          "[listener] failed to roll back meeting snapshot file",
          cleanupError,
        );
      }
      return;
    }
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
  interval = setInterval(() => {
    void capture();
  }, MEETING_SNAPSHOT_INTERVAL_MS);

  return async () => {
    stopped = true;
    if (interval) clearInterval(interval);
    await inFlight;
  };
}

// The detect plugin returns an entry for every running browser/Slack/Discord,
// so a bare entry is not evidence of a meeting. Two things are: the app is on
// the mic, or the AX inspection resolved a meeting window title. The title is
// missing for large pages (the Zoom web client blows the AX node cap), which is
// why mic use alone is enough. Without a title the capture side picks the
// app's frontmost window by pid.
// ponytail: frontmost window of the pid, not the meeting tab, when a browser
// has several windows open; add a title heuristic if that bites.
async function findMeetingWindow(): Promise<MeetingAccessibilityInspection | null> {
  const inspected = await detectCommands.inspectMeetingAccessibility();
  if (inspected.status === "error" || inspected.data.length === 0) return null;
  const micApps = await detectCommands.listMicUsingApplications();
  const micIds = new Set(
    micApps.status === "ok" ? micApps.data.map((app) => app.id) : [],
  );
  const onMic = inspected.data.find((entry) => micIds.has(entry.app.id));
  if (onMic) return onMic;
  return (
    inspected.data.find(
      (entry) =>
        typeof entry.windowTitle === "string" &&
        entry.windowTitle.trim() !== "",
    ) ?? null
  );
}

// Only kept frames are read: OCR at accurate level costs a few hundred ms, and
// most ticks are discarded as unchanged.
async function recognizeText(dataBase64: string) {
  const result = await screenCommands.recognizeImageText(dataBase64);
  if (result.status === "error") {
    console.warn("[listener] slide text recognition failed", result.error);
    return "";
  }
  return result.data.trim();
}

function timeStamp(atMs: number) {
  const date = new Date(atMs);
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
}
