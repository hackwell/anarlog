import { commands as detectCommands } from "@anlg/plugin-detect";

import { createHuman } from "~/contacts/queries";
import { liveQueryClient } from "~/db";
import { addSessionParticipant } from "~/session/queries/participants";
import { getStoredSettingValues } from "~/settings/queries";
import { resolveConfigValue } from "~/shared/config";

export const MEETING_PARTICIPANT_SYNC_INTERVAL_MS = 15_000;

/**
 * Adds the people shown on the meeting window's video tiles as participants
 * of the session. Added as `auto`, so a chip the user removes stays removed
 * for the rest of the meeting.
 */
export function startMeetingParticipantSync({
  sessionId,
  ownerUserId,
  isEnabled,
}: {
  sessionId: string;
  ownerUserId?: string;
  isEnabled?: () => boolean | Promise<boolean>;
}) {
  const syncIsEnabled =
    isEnabled ??
    (async () =>
      resolveConfigValue(
        "capture_meeting_participants",
        await getStoredSettingValues(),
      ));

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let errorLogged = false;
  const handled = new Set<string>();
  let interval: ReturnType<typeof setInterval> | null = null;

  const syncOnce = async () => {
    if (!(await syncIsEnabled())) return;
    const listed = await detectCommands.listMeetingParticipants();
    if (listed.status === "error") {
      if (!errorLogged) {
        errorLogged = true;
        console.warn(
          "[listener] meeting participant lookup failed",
          listed.error,
        );
      }
      return;
    }
    for (const participant of listed.data) {
      if (stopped) return;
      const name = participant.name.trim();
      const key = name.toLowerCase();
      if (participant.isSelf || !name || handled.has(key)) continue;
      handled.add(key);
      const humanId =
        (await findHumanIdByName(name)) ??
        (await createHuman({ ownerUserId, name }));
      await addSessionParticipant(sessionId, humanId, "auto");
    }
  };

  const sync = () => {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    const pending = syncOnce()
      .catch((error) => {
        console.warn("[listener] meeting participant sync failed", error);
      })
      .finally(() => {
        if (inFlight === pending) inFlight = null;
      });
    inFlight = pending;
    return pending;
  };

  void sync();
  interval = setInterval(() => {
    void sync();
  }, MEETING_PARTICIPANT_SYNC_INTERVAL_MS);

  return async () => {
    stopped = true;
    if (interval) clearInterval(interval);
    await inFlight;
  };
}

async function findHumanIdByName(name: string) {
  const rows = await liveQueryClient.execute<{ id: string }>(
    `
      SELECT id
      FROM humans
      WHERE lower(name) = lower(?) AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
    `,
    [name],
  );
  return rows[0]?.id ?? null;
}
