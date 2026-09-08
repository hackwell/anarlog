import { useEffect } from "react";

import { commands as listenerCommands } from "@anlg/plugin-transcription";

import { flushLiveTranscriptDeltasToDatabase } from "./queries";

import { liveQueryClient } from "~/db";

const SWEEP_INTERVAL_MS = 5 * 60_000;
// A capture that is starting may not be in the listener snapshot yet, so a
// journal row younger than this is left to the capture that is writing it.
const SWEEP_QUIET_PERIOD_MS = 60_000;
const MAX_TRANSCRIPTS_PER_SWEEP = 20;
const MAX_SWEEP_FAILURES = 3;

const STRANDED_TRANSCRIPTS_SQL = `
  SELECT DISTINCT
    transcript.id AS transcript_id,
    transcript.session_id AS session_id
  FROM transcript_live_state AS state
  JOIN transcripts AS transcript
    ON transcript.id = state.transcript_id
    AND transcript.deleted_at IS NULL
  JOIN transcript_live_deltas AS delta
    ON delta.transcript_id = state.transcript_id
  WHERE state.updated_at < ?
  ORDER BY transcript.id
`;

const failureCounts = new Map<string, number>();
let sweepInFlight: Promise<TranscriptCompactionSweepResult> | null = null;

export type TranscriptCompactionSweepResult = {
  compacted: number;
  failed: number;
  skipped: number;
};

export function resetTranscriptCompactionSweepState() {
  failureCounts.clear();
  sweepInFlight = null;
}

export function selectStrandedTranscriptIds(
  rows: ReadonlyArray<{ transcript_id: string; session_id: string }>,
  busySessionIds: readonly string[],
): string[] {
  const busy = new Set(busySessionIds);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (busy.has(row.session_id) || seen.has(row.transcript_id)) continue;
    seen.add(row.transcript_id);
    ids.push(row.transcript_id);
  }
  return ids;
}

export function runTranscriptCompactionSweep(): Promise<TranscriptCompactionSweepResult> {
  sweepInFlight ??= sweep().finally(() => {
    sweepInFlight = null;
  });
  return sweepInFlight;
}

async function sweep(): Promise<TranscriptCompactionSweepResult> {
  const empty = { compacted: 0, failed: 0, skipped: 0 };
  let busySessionIds: string[];
  try {
    const snapshot = await listenerCommands.getCaptureSnapshot();
    if (snapshot.status === "error") {
      // Without the listener's view we cannot tell a stranded transcript from
      // one being written right now, so we fold nothing.
      return empty;
    }
    busySessionIds = [
      ...(snapshot.data.activeSessionId ? [snapshot.data.activeSessionId] : []),
      ...snapshot.data.finalizingSessionIds,
    ];
  } catch (error) {
    console.error(
      "[transcript] compaction sweep could not read the capture snapshot",
      error,
    );
    return empty;
  }

  const quietBefore = new Date(
    Date.now() - SWEEP_QUIET_PERIOD_MS,
  ).toISOString();
  let rows: Array<{ transcript_id: string; session_id: string }>;
  try {
    rows = await liveQueryClient.execute<{
      transcript_id: string;
      session_id: string;
    }>(STRANDED_TRANSCRIPTS_SQL, [quietBefore]);
  } catch (error) {
    console.error(
      "[transcript] compaction sweep could not list stranded transcripts",
      error,
    );
    return empty;
  }

  const candidates = selectStrandedTranscriptIds(rows, busySessionIds);
  let skipped = rows.length - candidates.length;
  let compacted = 0;
  let failed = 0;

  for (const transcriptId of candidates) {
    if ((failureCounts.get(transcriptId) ?? 0) >= MAX_SWEEP_FAILURES) {
      skipped += 1;
      continue;
    }
    if (compacted + failed >= MAX_TRANSCRIPTS_PER_SWEEP) {
      skipped += 1;
      continue;
    }
    try {
      await flushLiveTranscriptDeltasToDatabase(transcriptId);
      failureCounts.delete(transcriptId);
      compacted += 1;
    } catch (error) {
      failureCounts.set(
        transcriptId,
        (failureCounts.get(transcriptId) ?? 0) + 1,
      );
      failed += 1;
      console.error(
        `[transcript] compaction sweep failed for ${transcriptId}`,
        error,
      );
    }
  }

  return { compacted, failed, skipped };
}

export function useTranscriptCompactionSweep() {
  useEffect(() => {
    void runTranscriptCompactionSweep();
    const interval = setInterval(() => {
      void runTranscriptCompactionSweep();
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
