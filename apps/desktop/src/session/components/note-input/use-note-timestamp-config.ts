import { t } from "@lingui/core/macro";
import { useCallback, useMemo, useRef } from "react";

import type { NoteTimestampConfig } from "@anlg/editor/note";

import { useAudioPlayer } from "~/audio-player";
import { useListenerStore } from "~/stt/contexts";
import { useSessionTranscriptMetadata } from "~/stt/queries";
import { sessionTimelineBaseMs } from "~/stt/transcript-timeline";

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

export function useNoteTimestampConfig(sessionId: string): NoteTimestampConfig {
  const transcripts = useSessionTranscriptMetadata(sessionId);
  const listenerStore = useListenerStore();
  const { seek, start, audioExists } = useAudioPlayer();
  // The transcript base is the same one the transcript view uses when a word
  // click seeks the audio: the earliest transcript that has words, so a
  // still-wordless leading row never becomes the anchor for a resumed session.
  const transcriptBaseMs = useMemo(
    () => sessionTimelineBaseMs(transcripts),
    [transcripts],
  );

  // Read live capture state imperatively (getState, not a selector) so a
  // second-by-second tick during recording never re-renders the note editor.
  const getRecordedAtMs = useCallback(() => {
    const { live } = listenerStore.getState();
    const isRecording =
      live.sessionId === sessionId && live.status === "active";
    if (!isRecording) {
      return null;
    }

    // The capture's own elapsed time is a zero point that exists from the
    // first keystroke, unlike a transcript row, which only appears once
    // there is a first STT delta (live) or after transcription runs (batch).
    // `live.seconds` only advances on a one-second interval timer, so this
    // can be off by up to a second; labels are minute:second, well within
    // that tolerance.
    const captureStartMs = Date.now() - live.seconds * 1000;
    const baseMs =
      transcriptBaseMs !== null
        ? Math.min(captureStartMs, transcriptBaseMs)
        : captureStartMs;

    return Date.now() - baseMs;
  }, [listenerStore, sessionId, transcriptBaseMs]);

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
