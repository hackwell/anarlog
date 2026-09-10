import { beforeEach, describe, expect, it } from "vitest";

import {
  PENDING_AUTO_ENHANCE_SETTING_PREFIX,
  PENDING_AUTO_ENHANCE_SQL,
} from "./storage";

import { createTestDatabase, type TestDatabase } from "~/test/sqlite";

const SESSION = "session-1";
const NOTE = "note-1";
const BODY = "the summary body";

function seedPendingJob(db: TestDatabase) {
  db.exec(`
    INSERT INTO sessions (id, title) VALUES ('${SESSION}', 'Planning');
    INSERT INTO session_documents (id, session_id, kind, body, body_format, template_id)
      VALUES ('${NOTE}', '${SESSION}', 'summary', '${BODY}', 'markdown', 'template-1');
    INSERT INTO app_settings (id, value_json)
      VALUES (
        '${PENDING_AUTO_ENHANCE_SETTING_PREFIX}${SESSION}',
        json_object(
          'noteId', '${NOTE}',
          'body', '${BODY}',
          'bodyFormat', 'markdown',
          'templateId', 'template-1',
          'generation', 'gen-1'
        )
      );
    INSERT INTO transcripts (id, session_id, started_at_ms, words_json, speaker_hints_json)
      VALUES ('transcript-1', '${SESSION}', 0, '[]', '[]');
  `);
}

describe("the pending auto-enhance gate against a real database", () => {
  let db: TestDatabase;

  const pending = () =>
    db
      .execute<{ session_id: string }>(PENDING_AUTO_ENHANCE_SQL, [
        PENDING_AUTO_ENHANCE_SETTING_PREFIX.length + 1,
        PENDING_AUTO_ENHANCE_SETTING_PREFIX.length + 1,
        `${PENDING_AUTO_ENHANCE_SETTING_PREFIX}%`,
      ])
      .map((row) => row.session_id);

  beforeEach(() => {
    db = createTestDatabase();
    seedPendingJob(db);
  });

  it("admits a session whose words are in the transcript", () => {
    db.exec(`
      UPDATE transcripts
      SET words_json = json('[{"id":"w1","text":"hi","start_ms":0,"end_ms":1,"channel":0}]')
      WHERE id = 'transcript-1';
    `);

    expect(pending()).toEqual([SESSION]);
  });

  it("admits a session whose words are still only in the live journal", () => {
    db.exec(`
      INSERT INTO transcript_live_state (transcript_id, next_sequence, updated_at)
        VALUES ('transcript-1', 1, '2026-09-10T08:00:00.000Z');
      INSERT INTO transcript_live_deltas (id, transcript_id, sequence, delta_json, created_at)
        VALUES (
          'd1', 'transcript-1', 0,
          json('{"new_words":[{"id":"w1","text":"hi"}],"replaced_ids":[],"partials":[]}'),
          '2026-09-10T08:00:00.000Z'
        );
    `);

    expect(pending()).toEqual([SESSION]);
  });

  it("leaves out a session with no words anywhere", () => {
    expect(pending()).toEqual([]);
  });

  it("leaves out a session whose journal holds no words", () => {
    db.exec(`
      INSERT INTO transcript_live_state (transcript_id, next_sequence, updated_at)
        VALUES ('transcript-1', 1, '2026-09-10T08:00:00.000Z');
      INSERT INTO transcript_live_deltas (id, transcript_id, sequence, delta_json, created_at)
        VALUES (
          'd1', 'transcript-1', 0,
          json('{"new_words":[],"replaced_ids":["gone"],"partials":[]}'),
          '2026-09-10T08:00:00.000Z'
        );
    `);

    expect(pending()).toEqual([]);
  });
});
