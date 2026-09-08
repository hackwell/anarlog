import type { LiveTranscriptDelta } from "@anlg/plugin-transcription";

import { coalesceLiveTranscriptDeltas } from "~/stt/transcript-persistence-worker";
import { applyLiveTranscriptDelta } from "~/stt/utils";

export type MemoryTranscriptStore = {
  getCell: (
    tableId: "transcripts",
    rowId: string,
    cellId: "words" | "speaker_hints",
  ) => string;
  setCell: (
    tableId: "transcripts",
    rowId: string,
    cellId: "words" | "speaker_hints",
    value: string,
  ) => void;
};

export function materializeTranscriptSnapshot(
  wordsJson: string,
  hintsJson: string,
  transcriptId: string,
  pendingDeltasJson: string,
) {
  const deltas = parseLiveTranscriptDeltas(pendingDeltasJson, transcriptId);
  if (deltas.length === 0) return { wordsJson, hintsJson };

  return mutateTranscriptSnapshot(wordsJson, hintsJson, transcriptId, (store) =>
    applyLiveTranscriptDelta(
      store,
      transcriptId,
      coalesceLiveTranscriptDeltas(deltas),
    ),
  );
}

export function parseLiveTranscriptDeltas(
  value: string | undefined,
  transcriptId: string,
): LiveTranscriptDelta[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as LiveTranscriptDelta[];
  } catch (error) {
    console.error(
      `[transcript] failed to parse live deltas for ${transcriptId}`,
      error,
    );
  }
  return [];
}

export function mutateTranscriptSnapshot(
  wordsJson: string,
  hintsJson: string,
  transcriptId: string,
  mutation: (store: MemoryTranscriptStore) => void,
) {
  const snapshot = { wordsJson, hintsJson };
  const store: MemoryTranscriptStore = {
    getCell: (_tableId, rowId, cellId) => {
      if (rowId !== transcriptId) return "[]";
      return cellId === "words" ? snapshot.wordsJson : snapshot.hintsJson;
    },
    setCell: (_tableId, rowId, cellId, value) => {
      if (rowId !== transcriptId) return;
      if (cellId === "words") {
        snapshot.wordsJson = value;
      } else {
        snapshot.hintsJson = value;
      }
    },
  };

  mutation(store);
  return snapshot;
}
