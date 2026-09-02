import { useMemo } from "react";

import { executeTransaction, liveQueryClient, useLiveQuery } from "~/db";
import { enqueueDatabaseWrite } from "~/db/write-queue";
import { id } from "~/shared/utils";

export type MeetingSnapshotRecord = {
  id: string;
  attachmentId: string;
  filename: string;
  path: string;
  capturedAtMs: number;
  width: number;
  height: number;
  appName: string;
  windowTitle: string;
};

export const MAX_MEETING_SNAPSHOTS = 60;

const EMPTY_RECORDS: MeetingSnapshotRecord[] = [];

const MEETING_SNAPSHOT_RECORDS_SQL = `
  SELECT id, body
  FROM session_documents
  WHERE session_id = ?
    AND kind = 'meeting_snapshot'
    AND deleted_at IS NULL
  ORDER BY sort_order, created_at, id
  LIMIT ${MAX_MEETING_SNAPSHOTS}
`;

export function persistMeetingSnapshotRecord(
  sessionId: string,
  record: Omit<MeetingSnapshotRecord, "id">,
): Promise<string> {
  const snapshotId = id();
  const createdAt = new Date(record.capturedAtMs).toISOString();
  return enqueueDatabaseWrite(`session:${sessionId}`, async () => {
    await executeTransaction([
      {
        sql: `
          INSERT INTO session_documents (
            id, session_id, kind, body, body_format, title, source_hash,
            generation_metadata_json, sort_order, created_by, updated_by,
            created_at, updated_at, deleted_at
          )
          SELECT
            ?, id, 'meeting_snapshot', ?, 'json', ?, '', ?, ?, owner_user_id,
            owner_user_id, ?, ?, NULL
          FROM sessions
          WHERE id = ? AND deleted_at IS NULL
        `,
        params: [
          snapshotId,
          JSON.stringify(record),
          record.filename,
          JSON.stringify({ source: "meeting_window_capture", version: 1 }),
          record.capturedAtMs,
          createdAt,
          createdAt,
          sessionId,
        ],
      },
    ]);
    return snapshotId;
  });
}

export function parseMeetingSnapshotDocument(row: {
  id: string;
  body: string;
}): MeetingSnapshotRecord | null {
  try {
    const value = JSON.parse(row.body) as Partial<MeetingSnapshotRecord>;
    if (
      typeof value.attachmentId !== "string" ||
      typeof value.filename !== "string" ||
      typeof value.path !== "string" ||
      typeof value.capturedAtMs !== "number" ||
      typeof value.width !== "number" ||
      typeof value.height !== "number"
    ) {
      return null;
    }
    return {
      id: row.id,
      attachmentId: value.attachmentId,
      filename: value.filename,
      path: value.path,
      capturedAtMs: value.capturedAtMs,
      width: value.width,
      height: value.height,
      appName: typeof value.appName === "string" ? value.appName : "",
      windowTitle:
        typeof value.windowTitle === "string" ? value.windowTitle : "",
    };
  } catch {
    return null;
  }
}

function parseRows(rows: Array<{ id: string; body: string }>) {
  return rows.flatMap((row) => {
    const record = parseMeetingSnapshotDocument(row);
    return record ? [record] : [];
  });
}

export async function loadMeetingSnapshotRecords(
  sessionId: string,
): Promise<MeetingSnapshotRecord[]> {
  if (!sessionId) return [];
  const rows = await liveQueryClient.execute<{ id: string; body: string }>(
    MEETING_SNAPSHOT_RECORDS_SQL,
    [sessionId],
  );
  return parseRows(rows);
}

export function useMeetingSnapshotRecords(
  sessionId: string,
): MeetingSnapshotRecord[] {
  const { data = EMPTY_RECORDS } = useLiveQuery<
    { id: string; body: string },
    MeetingSnapshotRecord[]
  >({
    sql: MEETING_SNAPSHOT_RECORDS_SQL,
    params: [sessionId],
    enabled: Boolean(sessionId),
    mapRows: parseRows,
  });
  return useMemo(() => (sessionId ? data : EMPTY_RECORDS), [data, sessionId]);
}
