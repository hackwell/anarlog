import { describe, expect, it } from "vitest";

import { createTestDatabase, registeredMigrationIds } from "./sqlite";

describe("the test database", () => {
  it("carries the tables the app queries", () => {
    const db = createTestDatabase();
    try {
      const tables = db
        .execute<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
        .map((row) => row.name);

      for (const table of [
        "sessions",
        "session_documents",
        "transcripts",
        "transcript_live_deltas",
        "transcript_live_state",
        "organizations",
        "humans",
      ]) {
        expect(tables).toContain(table);
      }
    } finally {
      db.close();
    }
  });

  it("registers every migration file exactly once", () => {
    const ids = registeredMigrationIds();

    expect(ids.length).toBeGreaterThan(50);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
