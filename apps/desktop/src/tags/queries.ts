import { useMemo } from "react";

import { transcriptToText } from "./suggest";

import { executeTransaction, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { DEFAULT_USER_ID, id } from "~/shared/utils";

export type TagRecord = {
  id: string;
  name: string;
  sessionCount: number;
};

const EMPTY_TAGS: TagRecord[] = [];
const EMPTY_IDS: string[] = [];

/**
 * Both tables carry a workspace, and it comes from the same binding every other
 * row uses. Written as SQL rather than read first so the insert stays a single
 * statement: the binding is local identity, not a cloud account.
 */
const WORKSPACE_SQL = `NULLIF((
  SELECT json_extract(value_json, '$.workspace_id')
  FROM app_settings
  WHERE id = 'cloudsync_workspace_binding'
), '')`;

const OWNER_SQL = `COALESCE(
  NULLIF(NULLIF(?, ''), '${DEFAULT_USER_ID}'),
  ${WORKSPACE_SQL},
  '${DEFAULT_USER_ID}'
)`;

/** Every tag with how many recordings carry it, most used first. */
export function useTags(): TagRecord[] {
  const { data = EMPTY_TAGS } = useLiveQuery<
    { id: string; name: string; session_count: number },
    TagRecord[]
  >({
    sql: `
      SELECT
        tags.id,
        tags.name,
        COUNT(DISTINCT session_tags.session_id) AS session_count
      FROM tags
      LEFT JOIN session_tags
        ON session_tags.tag_id = tags.id
        AND session_tags.deleted_at IS NULL
      LEFT JOIN sessions
        ON sessions.id = session_tags.session_id
        AND sessions.deleted_at IS NULL
      WHERE tags.deleted_at IS NULL
      GROUP BY tags.id, tags.name
      ORDER BY session_count DESC, tags.name
    `,
    mapRows: (rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        sessionCount: Number(row.session_count) || 0,
      })),
  });
  return data;
}

export function useSessionIdsForTag(tagId: string | null): Set<string> {
  const { data = EMPTY_IDS } = useLiveQuery<{ session_id: string }, string[]>({
    sql: `
      SELECT DISTINCT session_id
      FROM session_tags
      WHERE deleted_at IS NULL AND tag_id = ?
    `,
    params: [tagId ?? ""],
    mapRows: (rows) => rows.map((row) => row.session_id),
  });
  return useMemo(() => new Set(tagId ? data : []), [data, tagId]);
}

export function useTagsForSession(sessionId: string | null): TagRecord[] {
  const { data = EMPTY_TAGS } = useLiveQuery<
    { id: string; name: string },
    TagRecord[]
  >({
    sql: `
      SELECT tags.id, tags.name
      FROM session_tags
      JOIN tags ON tags.id = session_tags.tag_id AND tags.deleted_at IS NULL
      WHERE session_tags.deleted_at IS NULL AND session_tags.session_id = ?
      ORDER BY tags.name
    `,
    params: [sessionId ?? ""],
    mapRows: (rows) =>
      rows.map((row) => ({ id: row.id, name: row.name, sessionCount: 0 })),
  });
  return sessionId ? data : EMPTY_TAGS;
}

/**
 * Names are the identity here: typing a tag that already exists has to reuse it,
 * or the same word ends up as two chips that each hold half the recordings.
 */
export function createTag(
  name: string,
  ownerUserId = DEFAULT_USER_ID,
): Promise<string> {
  const trimmed = name.trim();
  const tagId = id();
  const now = new Date().toISOString();

  return enqueueDatabaseWrite(`tag:${trimmed.toLowerCase()}`, async () => {
    await executeTransaction([
      {
        sql: `
          INSERT INTO tags (
            id, workspace_id, owner_user_id, name, created_at, updated_at, deleted_at
          )
          SELECT ?, ${WORKSPACE_SQL}, ${OWNER_SQL}, ?, ?, ?, NULL
          WHERE NOT EXISTS (
            SELECT 1 FROM tags
            WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE
          )
        `,
        params: [tagId, ownerUserId, trimmed, now, now, trimmed],
      },
    ]);
    return tagId;
  });
}

export function assignTag(
  sessionId: string,
  tagName: string,
  ownerUserId = DEFAULT_USER_ID,
): Promise<void> {
  const trimmed = tagName.trim();
  if (!trimmed) {
    return Promise.resolve();
  }
  const tagId = id();
  const linkId = id();
  const now = new Date().toISOString();

  return enqueueDatabaseWrite(`session-tag:${sessionId}`, async () => {
    await executeTransaction([
      {
        sql: `
          INSERT INTO tags (
            id, workspace_id, owner_user_id, name, created_at, updated_at, deleted_at
          )
          SELECT ?, ${WORKSPACE_SQL}, ${OWNER_SQL}, ?, ?, ?, NULL
          WHERE NOT EXISTS (
            SELECT 1 FROM tags
            WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE
          )
        `,
        params: [tagId, ownerUserId, trimmed, now, now, trimmed],
      },
      {
        // Re-tagging something already tagged must not add a second row, and
        // must revive a link that was removed earlier.
        sql: `
          INSERT INTO session_tags (
            id, workspace_id, owner_user_id, session_id, tag_id,
            created_at, updated_at, deleted_at
          )
          SELECT ?, ${WORKSPACE_SQL}, ${OWNER_SQL}, ?, tags.id, ?, ?, NULL
          FROM tags
          WHERE tags.deleted_at IS NULL AND tags.name = ? COLLATE NOCASE
            AND NOT EXISTS (
              SELECT 1 FROM session_tags AS existing
              WHERE existing.session_id = ?
                AND existing.tag_id = tags.id
                AND existing.deleted_at IS NULL
            )
        `,
        params: [linkId, ownerUserId, sessionId, now, now, trimmed, sessionId],
      },
    ]);
  });
}

export function unassignTag(sessionId: string, tagId: string): Promise<void> {
  const now = new Date().toISOString();

  return enqueueDatabaseWrite(`session-tag:${sessionId}`, async () => {
    await executeTransaction([
      {
        // Soft delete: the row is what the sync layer tracks, so removing it
        // outright would leave other devices holding a tag nobody can clear.
        sql: `
          UPDATE session_tags
          SET deleted_at = ?, updated_at = ?
          WHERE session_id = ? AND tag_id = ? AND deleted_at IS NULL
        `,
        params: [now, now, sessionId, tagId],
      },
    ]);
  });
}

/** The recording's words as one string, for asking a model what it was about. */
export function useSessionTranscriptText(sessionId: string | null): string {
  const { data = EMPTY_IDS } = useLiveQuery<{ words_json: string }, string[]>({
    sql: `
      SELECT words_json
      FROM transcripts
      WHERE deleted_at IS NULL AND session_id = ?
      ORDER BY started_at_ms
    `,
    params: [sessionId ?? ""],
    mapRows: (rows) => rows.map((row) => row.words_json),
  });

  return useMemo(
    () => (sessionId ? data.map(transcriptToText).join(" ").trim() : ""),
    [data, sessionId],
  );
}
