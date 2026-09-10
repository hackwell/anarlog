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
  pendingDeltasJson: string | readonly unknown[],
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

// The deltas reach this function in two shapes. Read from a column of their own
// they arrive as text; nested inside a `json_object`, SQLite keeps the JSON
// subtype through the COALESCE and hands back a parsed array instead. Passing
// that array to JSON.parse stringifies it first — to "" when empty and to
// "[object Object]" when not — which is how a delta-aware query came to report a
// syntax error on every load and silently drop every pending word.
export function parseLiveTranscriptDeltas(
  value: string | readonly unknown[] | undefined,
  transcriptId: string,
): LiveTranscriptDelta[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as LiveTranscriptDelta[];
  try {
    const parsed = JSON.parse(value as string);
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
