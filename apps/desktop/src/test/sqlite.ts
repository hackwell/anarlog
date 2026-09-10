import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// The queries in this app live as strings and are executed by a client the tests
// mock, so their text is never run against a database. This opens a real one,
// built from the real migrations, so a test can hand the real query to a real
// engine and assert on what the mapping code makes of the rows that come back.
//
// It reads the migration files rather than carrying a copy of the schema: a
// column renamed on the Rust side then breaks the query that reads it, here, on
// the commit that renames it.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATIONS_DIR = path.join(REPO_ROOT, "crates/db-app/migrations");
const MIGRATIONS_RS = path.join(REPO_ROOT, "crates/db-app/src/lib.rs");

// The registered order, not the filename order: two e2ee migrations are
// registered earlier than they sort, and a real database is built in this order.
export function registeredMigrationIds(): string[] {
  const source = readFileSync(MIGRATIONS_RS, "utf8");
  return [...source.matchAll(/id:\s*"(\d[^"]*)"/g)].map((match) => match[1]!);
}

export type TestDatabase = {
  execute<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  exec(sql: string): void;
  close(): void;
};

export function createTestDatabase(): TestDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");

  for (const id of registeredMigrationIds()) {
    const file = path.join(MIGRATIONS_DIR, `${id}.sql`);
    let sql: string;
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      throw new Error(
        `migration ${id} is registered in db-app/src/lib.rs but has no file`,
      );
    }
    try {
      database.exec(sql);
    } catch (error) {
      throw new Error(`migration ${id} failed to apply: ${error}`);
    }
  }

  return {
    execute<T>(sql: string, params: unknown[] = []): T[] {
      return database.prepare(sql).all(...(params as never[])) as T[];
    },
    exec(sql: string) {
      database.exec(sql);
    },
    close() {
      database.close();
    },
  };
}
