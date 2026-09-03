import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  createHuman: vi.fn(),
  addParticipant: vi.fn(),
  execute: vi.fn(),
  setting: { value: true },
}));

vi.mock("@anlg/plugin-detect", () => ({
  commands: { listMeetingParticipants: mocks.list },
}));
vi.mock("~/contacts/queries", () => ({ createHuman: mocks.createHuman }));
vi.mock("~/session/queries/participants", () => ({
  addSessionParticipant: mocks.addParticipant,
}));
vi.mock("~/db", () => ({ liveQueryClient: { execute: mocks.execute } }));
vi.mock("~/settings/queries", () => ({
  getStoredSettingValues: vi.fn(async () => ({
    values: { capture_meeting_participants: mocks.setting.value },
    hasValues: new Set(["capture_meeting_participants"]),
  })),
}));

import {
  MEETING_PARTICIPANT_SYNC_INTERVAL_MS,
  startMeetingParticipantSync,
} from "./meeting-participant-sync";

const teams = { id: "com.microsoft.teams2", name: "Microsoft Teams" };

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("startMeetingParticipantSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(mocks).forEach(
      (mock) => typeof mock === "function" && mock.mockReset(),
    );
    mocks.setting.value = true;
    mocks.list.mockResolvedValue({
      status: "ok",
      data: [
        { name: "Jörg Weller", isSelf: true, app: teams },
        { name: "Gebert, Mattan", isSelf: false, app: teams },
      ],
    });
    mocks.execute.mockResolvedValue([]);
    mocks.createHuman.mockResolvedValue("human-new");
    mocks.addParticipant.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("adds a shown name once and skips the user's own tile", async () => {
    const stop = startMeetingParticipantSync({
      sessionId: "session-1",
      ownerUserId: "user-1",
    });
    await flush();
    await vi.advanceTimersByTimeAsync(MEETING_PARTICIPANT_SYNC_INTERVAL_MS);

    expect(mocks.createHuman).toHaveBeenCalledTimes(1);
    expect(mocks.createHuman).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      name: "Gebert, Mattan",
    });
    expect(mocks.addParticipant).toHaveBeenCalledTimes(1);
    expect(mocks.addParticipant).toHaveBeenCalledWith(
      "session-1",
      "human-new",
      "auto",
    );
    await stop();
  });

  test("reuses a contact with the same name", async () => {
    mocks.execute.mockResolvedValue([{ id: "human-known" }]);
    const stop = startMeetingParticipantSync({ sessionId: "session-1" });
    await flush();

    expect(mocks.createHuman).not.toHaveBeenCalled();
    expect(mocks.addParticipant).toHaveBeenCalledWith(
      "session-1",
      "human-known",
      "auto",
    );
    await stop();
  });

  test("does nothing while the setting is off", async () => {
    mocks.setting.value = false;
    const stop = startMeetingParticipantSync({ sessionId: "session-1" });
    await flush();

    expect(mocks.list).not.toHaveBeenCalled();
    await stop();
  });

  test("picks up a participant who joins later", async () => {
    const stop = startMeetingParticipantSync({ sessionId: "session-1" });
    await flush();
    mocks.list.mockResolvedValue({
      status: "ok",
      data: [
        { name: "Gebert, Mattan", isSelf: false, app: teams },
        { name: "Anna Beispiel", isSelf: false, app: teams },
      ],
    });
    await vi.advanceTimersByTimeAsync(MEETING_PARTICIPANT_SYNC_INTERVAL_MS);

    expect(mocks.createHuman).toHaveBeenCalledTimes(2);
    expect(mocks.createHuman).toHaveBeenLastCalledWith({
      ownerUserId: undefined,
      name: "Anna Beispiel",
    });
    await stop();
  });
});
