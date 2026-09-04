import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useRef } from "react";

import type { NoteTimestampConfig } from "@anlg/editor/note";

import { useAudioPlayer } from "~/audio-player";
import { useListener } from "~/stt/contexts";
import { useSessionTranscriptMetadata } from "~/stt/queries";

export function formatRecordingPosition(recordedAtMs: number): string {
  if (!Number.isFinite(recordedAtMs)) {
    return "--:--";
  }

  const total = Math.max(0, Math.round(recordedAtMs / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function earliestTranscriptStartedAtMs(
  transcripts: { startedAt: number }[],
): number | null {
  const starts = transcripts
    .map((transcript) => transcript.startedAt)
    .filter((startedAt) => Number.isFinite(startedAt) && startedAt > 0);

  return starts.length > 0 ? Math.min(...starts) : null;
}

export function useNoteTimestampConfig(sessionId: string): NoteTimestampConfig {
  const transcripts = useSessionTranscriptMetadata(sessionId);
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const { seek, start, audioExists } = useAudioPlayer();
  // The recording's zero point is the earliest transcript start, the same base
  // the transcript uses when a word click seeks the audio.
  const baseMs = useMemo(
    () => earliestTranscriptStartedAtMs(transcripts),
    [transcripts],
  );
  // "active" is the live-recording session mode (see ~/store/zustand/listener/general.ts);
  // "running_batch", "finalizing" and "inactive" are not a live capture in progress.
  const isRecording = sessionMode === "active";

  const getRecordedAtMs = useCallback(
    () => (isRecording && baseMs !== null ? Date.now() - baseMs : null),
    [isRecording, baseMs],
  );

  // Assigned during render so the callback identity (fixed at plugin
  // registration) can still read the current value.
  const audioExistsRef = useRef(audioExists);
  audioExistsRef.current = audioExists;

  const onActivate = useCallback(
    (recordedAtMs: number) => {
      if (!audioExistsRef.current) {
        return;
      }
      seek(recordedAtMs / 1000);
      start();
    },
    [seek, start],
  );

  return useMemo(
    () => ({
      getRecordedAtMs,
      formatLabel: formatRecordingPosition,
      onActivate,
      activateLabel: t`Jump to this point in the recording`,
    }),
    [getRecordedAtMs, onActivate],
  );
}
