import { beforeEach, describe, expect, it } from "vitest";

import {
  mapSessionContentRow,
  SESSION_CONTENT_SQL,
  type SessionContentSnapshot,
} from "./content-queries";

import { createTestDatabase, type TestDatabase } from "~/test/sqlite";

const SESSION = "session-1";
const TRANSCRIPT = "transcript-1";

function delta(id: string, text: string, startMs: number) {
  return JSON.stringify({
    new_words: [
      {
        id,
        text,
        start_ms: startMs,
        end_ms: startMs + 1,
        channel: 0,
        state: "final",
      },
    ],
    replaced_ids: [],
    partials: [],
  });
}

function loadSnapshot(db: TestDatabase): SessionContentSnapshot {
  const rows = db.execute<never>(SESSION_CONTENT_SQL, [SESSION]);
  expect(rows).toHaveLength(1);
  return mapSessionContentRow(rows[0]!);
}

describe("SESSION_CONTENT_SQL against a real database", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
    db.exec(`
      INSERT INTO sessions (id, title) VALUES ('${SESSION}', 'Planning');
      INSERT INTO session_documents (id, session_id, kind, body, body_format)
        VALUES ('${SESSION}', '${SESSION}', 'note', '', 'prosemirror_json');
      INSERT INTO transcripts (id, session_id, started_at_ms, words_json, speaker_hints_json)
        VALUES (
          '${TRANSCRIPT}', '${SESSION}', 0,
          json('[{"id":"word-1","text":"Hello","start_ms":0,"end_ms":1,"channel":0}]'),
          '[]'
        );
    `);
  });

  it("reads a transcript that has been folded already", () => {
    const snapshot = loadSnapshot(db);
    const transcript = snapshot.transcripts[0]!;

    expect(transcript.words.map((word) => word.text)).toEqual(["Hello"]);
    expect(transcript.hasUnpersistedWords).toBe(false);
  });

  it("folds words that are still only in the live journal", () => {
    db.exec(`
      INSERT INTO transcript_live_state (transcript_id, next_sequence, updated_at)
        VALUES ('${TRANSCRIPT}', 2, '2026-09-10T09:00:00.000Z');
      INSERT INTO transcript_live_deltas (id, transcript_id, sequence, delta_json, created_at)
        VALUES
          ('d1', '${TRANSCRIPT}', 0, '${delta("word-2", "world", 2)}', '2026-09-10T09:00:00.000Z'),
          ('d2', '${TRANSCRIPT}', 1, '${delta("word-3", "again", 4)}', '2026-09-10T09:00:01.000Z');
    `);

    const transcript = loadSnapshot(db).transcripts[0]!;

    // The assertion that was false in production for two releases: the words
    // arrived as a parsed array, JSON.parse stringified it, and every pending
    // word was silently dropped.
    expect(transcript.words.map((word) => word.text)).toEqual([
      "Hello",
      "world",
      "again",
    ]);
    expect(transcript.hasUnpersistedWords).toBe(true);
    // The compare-and-set guard has to stay the stored value, not the merge.
    expect(JSON.parse(transcript.wordsJson)).toHaveLength(1);
  });

  it("keeps the deltas in sequence order, not insertion order", () => {
    db.exec(`
      INSERT INTO transcript_live_state (transcript_id, next_sequence, updated_at)
        VALUES ('${TRANSCRIPT}', 2, '2026-09-10T09:00:00.000Z');
      INSERT INTO transcript_live_deltas (id, transcript_id, sequence, delta_json, created_at)
        VALUES
          ('later', '${TRANSCRIPT}', 1, '${delta("word-3", "again", 4)}', '2026-09-10T09:00:01.000Z'),
          ('earlier', '${TRANSCRIPT}', 0, '${delta("word-2", "world", 2)}', '2026-09-10T09:00:00.000Z');
    `);

    expect(
      loadSnapshot(db).transcripts[0]!.words.map((word) => word.text),
    ).toEqual(["Hello", "world", "again"]);
  });
});
