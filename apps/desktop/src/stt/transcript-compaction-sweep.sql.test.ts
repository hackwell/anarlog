import { beforeEach, describe, expect, it } from "vitest";

import { STRANDED_TRANSCRIPTS_SQL } from "./transcript-compaction-sweep";

import { createTestDatabase, type TestDatabase } from "~/test/sqlite";

const OLD = "2026-09-10T08:00:00.000Z";
const RECENT = "2026-09-10T09:59:30.000Z";
const QUIET_BEFORE = "2026-09-10T09:59:00.000Z";

function seedTranscript(
  db: TestDatabase,
  id: string,
  options: { updatedAt?: string; deleted?: boolean; withDeltas?: boolean } = {},
) {
  db.exec(`
    INSERT INTO sessions (id, title) VALUES ('session-${id}', 'Meeting');
    INSERT INTO transcripts (id, session_id, started_at_ms, words_json, speaker_hints_json, deleted_at)
      VALUES ('${id}', 'session-${id}', 0, '[]', '[]', ${
        options.deleted ? `'${OLD}'` : "NULL"
      });
  `);
  if (options.withDeltas === false) return;
  db.exec(`
    INSERT INTO transcript_live_state (transcript_id, next_sequence, updated_at)
      VALUES ('${id}', 1, '${options.updatedAt ?? OLD}');
    INSERT INTO transcript_live_deltas (id, transcript_id, sequence, delta_json, created_at)
      VALUES ('d-${id}', '${id}', 0, '{"new_words":[],"replaced_ids":[],"partials":[]}', '${OLD}');
  `);
}

describe("STRANDED_TRANSCRIPTS_SQL against a real database", () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  const stranded = () =>
    db
      .execute<{ transcript_id: string }>(STRANDED_TRANSCRIPTS_SQL, [
        QUIET_BEFORE,
      ])
      .map((row) => row.transcript_id);

  it("finds a transcript whose journal has gone quiet", () => {
    seedTranscript(db, "quiet");

    expect(stranded()).toEqual(["quiet"]);
  });

  it("leaves a journal that is still being written alone", () => {
    seedTranscript(db, "live", { updatedAt: RECENT });

    expect(stranded()).toEqual([]);
  });

  it("ignores a deleted transcript", () => {
    seedTranscript(db, "gone", { deleted: true });

    expect(stranded()).toEqual([]);
  });

  it("ignores a transcript with no journal rows at all", () => {
    seedTranscript(db, "folded", { withDeltas: false });

    expect(stranded()).toEqual([]);
  });

  it("returns a transcript once however many journal rows it has", () => {
    seedTranscript(db, "many");
    db.exec(`
      INSERT INTO transcript_live_deltas (id, transcript_id, sequence, delta_json, created_at)
        VALUES
          ('d-many-2', 'many', 1, '{"new_words":[],"replaced_ids":[],"partials":[]}', '${OLD}'),
          ('d-many-3', 'many', 2, '{"new_words":[],"replaced_ids":[],"partials":[]}', '${OLD}');
    `);

    expect(stranded()).toEqual(["many"]);
  });
});
