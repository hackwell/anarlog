import type { LanguageModel } from "ai";
import { create } from "zustand";

import { suggestTags, type TagSuggestion, transcriptToText } from "./suggest";

import { liveQueryClient } from "~/db";

type SuggestionState = {
  bySession: Record<string, TagSuggestion | "thinking">;
  request: (
    sessionId: string,
    model: LanguageModel,
    opts?: { force?: boolean },
  ) => Promise<void>;
  dismiss: (sessionId: string, name: string) => void;
};

/**
 * Suggestions live outside the component so they survive switching tabs and
 * can be fetched right after a summary lands, before anyone looks at the note.
 */
export const useTagSuggestions = create<SuggestionState>((set, get) => ({
  bySession: {},

  async request(sessionId, model, opts) {
    const current = get().bySession[sessionId];
    if (current === "thinking" || (current && !opts?.force)) return;
    set((state) => ({
      bySession: { ...state.bySession, [sessionId]: "thinking" },
    }));

    try {
      const [transcript, vocabulary] = await Promise.all([
        loadTranscriptText(sessionId),
        loadTagVocabulary(),
      ]);
      const suggestion =
        transcript.length > 200
          ? await suggestTags({ model, title: "", transcript, vocabulary })
          : { chosen: [], proposed: [] };
      set((state) => ({
        bySession: { ...state.bySession, [sessionId]: suggestion },
      }));
    } catch (error) {
      console.error("[tags] suggestion failed", error);
      set((state) => ({
        bySession: {
          ...state.bySession,
          [sessionId]: { chosen: [], proposed: [] },
        },
      }));
    }
  },

  dismiss(sessionId, name) {
    set((state) => {
      const current = state.bySession[sessionId];
      if (!current || current === "thinking") return state;
      return {
        bySession: {
          ...state.bySession,
          [sessionId]: {
            chosen: current.chosen.filter((entry) => entry !== name),
            proposed: current.proposed.filter((entry) => entry !== name),
          },
        },
      };
    });
  },
}));

async function loadTranscriptText(sessionId: string) {
  const rows = await liveQueryClient.execute<{ words_json: string }>(
    `SELECT words_json FROM transcripts
     WHERE deleted_at IS NULL AND session_id = ?
     ORDER BY started_at_ms`,
    [sessionId],
  );
  return rows
    .map((row) => transcriptToText(row.words_json))
    .join(" ")
    .trim();
}

async function loadTagVocabulary() {
  const rows = await liveQueryClient.execute<{ name: string }>(
    `SELECT name FROM tags WHERE deleted_at IS NULL ORDER BY name`,
  );
  return rows.map((row) => row.name);
}

export async function sessionHasTags(sessionId: string) {
  const rows = await liveQueryClient.execute<{ n: number }>(
    `SELECT COUNT(*) AS n FROM session_tags
     WHERE deleted_at IS NULL AND session_id = ?`,
    [sessionId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
