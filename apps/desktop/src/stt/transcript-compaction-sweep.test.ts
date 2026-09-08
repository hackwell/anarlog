import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  flush: vi.fn(),
  getCaptureSnapshot: vi.fn(),
}));

vi.mock("~/db", () => ({
  liveQueryClient: { execute: mocks.execute },
}));

vi.mock("./queries", () => ({
  flushLiveTranscriptDeltasToDatabase: mocks.flush,
}));

vi.mock("@anlg/plugin-transcription", () => ({
  commands: { getCaptureSnapshot: mocks.getCaptureSnapshot },
}));

import {
  resetTranscriptCompactionSweepState,
  runTranscriptCompactionSweep,
  selectStrandedTranscriptIds,
} from "./transcript-compaction-sweep";

describe("selectStrandedTranscriptIds", () => {
  it("keeps transcripts whose session has no running capture", () => {
    expect(
      selectStrandedTranscriptIds(
        [
          { transcript_id: "transcript-1", session_id: "session-1" },
          { transcript_id: "transcript-2", session_id: "session-2" },
        ],
        ["session-2"],
      ),
    ).toEqual(["transcript-1"]);
  });

  it("drops every transcript of a busy session", () => {
    expect(
      selectStrandedTranscriptIds(
        [
          { transcript_id: "transcript-1", session_id: "session-1" },
          { transcript_id: "transcript-2", session_id: "session-1" },
        ],
        ["session-1"],
      ),
    ).toEqual([]);
  });

  it("deduplicates repeated transcript rows", () => {
    expect(
      selectStrandedTranscriptIds(
        [
          { transcript_id: "transcript-1", session_id: "session-1" },
          { transcript_id: "transcript-1", session_id: "session-1" },
        ],
        [],
      ),
    ).toEqual(["transcript-1"]);
  });
});

describe("runTranscriptCompactionSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTranscriptCompactionSweepState();
    mocks.getCaptureSnapshot.mockResolvedValue({
      status: "ok",
      data: { activeSessionId: null, finalizingSessionIds: [] },
    });
    mocks.flush.mockResolvedValue(undefined);
  });

  it("folds every stranded transcript", async () => {
    mocks.execute.mockResolvedValueOnce([
      { transcript_id: "transcript-1", session_id: "session-1" },
      { transcript_id: "transcript-2", session_id: "session-2" },
    ]);

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 2,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.flush).toHaveBeenCalledWith("transcript-1");
    expect(mocks.flush).toHaveBeenCalledWith("transcript-2");
  });

  it("never folds a transcript whose capture is running", async () => {
    mocks.getCaptureSnapshot.mockResolvedValue({
      status: "ok",
      data: {
        activeSessionId: "session-1",
        finalizingSessionIds: ["session-2"],
      },
    });
    mocks.execute.mockResolvedValueOnce([
      { transcript_id: "transcript-1", session_id: "session-1" },
      { transcript_id: "transcript-2", session_id: "session-2" },
      { transcript_id: "transcript-3", session_id: "session-3" },
    ]);

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 1,
      failed: 0,
      skipped: 2,
    });
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.flush).toHaveBeenCalledWith("transcript-3");
  });

  it("folds nothing when the capture snapshot cannot be read", async () => {
    mocks.getCaptureSnapshot.mockResolvedValue({
      status: "error",
      error: "listener unavailable",
    });

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 0,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it("continues past a failing transcript and gives up on it after its ceiling", async () => {
    mocks.execute.mockResolvedValue([
      { transcript_id: "transcript-1", session_id: "session-1" },
      { transcript_id: "transcript-2", session_id: "session-2" },
    ]);
    mocks.flush.mockImplementation(async (transcriptId: string) => {
      if (transcriptId === "transcript-1") {
        throw new Error("changed too frequently");
      }
    });

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 1,
      failed: 1,
      skipped: 0,
    });
    await runTranscriptCompactionSweep();
    await runTranscriptCompactionSweep();
    mocks.flush.mockClear();

    await expect(runTranscriptCompactionSweep()).resolves.toEqual({
      compacted: 1,
      failed: 0,
      skipped: 1,
    });
    expect(mocks.flush).not.toHaveBeenCalledWith("transcript-1");
  });
});
