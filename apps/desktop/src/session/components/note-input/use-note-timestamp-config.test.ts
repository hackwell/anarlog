import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcripts: [] as { startedAt: number }[],
  sessionMode: "inactive" as string,
  audioExists: false,
  seek: vi.fn(),
  start: vi.fn(),
}));

vi.mock("~/stt/queries", () => ({
  useSessionTranscriptMetadata: () => mocks.transcripts,
}));

vi.mock("~/stt/contexts", () => ({
  useListener: (
    selector: (state: {
      getSessionMode: (sessionId: string) => string;
    }) => unknown,
  ) => selector({ getSessionMode: () => mocks.sessionMode }),
}));

vi.mock("~/audio-player", () => ({
  useAudioPlayer: () => ({
    seek: mocks.seek,
    start: mocks.start,
    audioExists: mocks.audioExists,
  }),
}));

import {
  earliestTranscriptStartedAtMs,
  formatRecordingPosition,
  useNoteTimestampConfig,
} from "./use-note-timestamp-config";

describe("formatRecordingPosition", () => {
  it("formats minutes and seconds", () => {
    expect(formatRecordingPosition(0)).toBe("0:00");
    expect(formatRecordingPosition(9_000)).toBe("0:09");
    expect(formatRecordingPosition(724_000)).toBe("12:04");
  });

  it("adds hours only past the hour", () => {
    expect(formatRecordingPosition(3_599_000)).toBe("59:59");
    expect(formatRecordingPosition(3_600_000)).toBe("1:00:00");
    expect(formatRecordingPosition(3_725_000)).toBe("1:02:05");
  });

  it("clamps a negative position to zero", () => {
    expect(formatRecordingPosition(-500)).toBe("0:00");
  });

  it("falls back to a stable placeholder for non-finite input", () => {
    expect(formatRecordingPosition(Number.NaN)).toBe("--:--");
    expect(formatRecordingPosition(Number.POSITIVE_INFINITY)).toBe("--:--");
  });
});

describe("earliestTranscriptStartedAtMs", () => {
  it("returns the earliest usable start", () => {
    expect(
      earliestTranscriptStartedAtMs([{ startedAt: 500 }, { startedAt: 100 }]),
    ).toBe(100);
  });

  it("ignores unusable starts", () => {
    expect(earliestTranscriptStartedAtMs([{ startedAt: 0 }])).toBeNull();
    expect(earliestTranscriptStartedAtMs([])).toBeNull();
    expect(
      earliestTranscriptStartedAtMs([
        { startedAt: Number.NaN },
        { startedAt: 400 },
      ]),
    ).toBe(400);
  });
});

describe("useNoteTimestampConfig", () => {
  beforeEach(() => {
    mocks.transcripts = [];
    mocks.sessionMode = "inactive";
    mocks.audioExists = false;
    mocks.seek.mockReset();
    mocks.start.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no recording is running", () => {
    mocks.transcripts = [{ startedAt: 1_000 }];
    mocks.sessionMode = "inactive";

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBeNull();
  });

  it("returns null while recording if no transcript has started yet", () => {
    mocks.transcripts = [];
    mocks.sessionMode = "active";

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBeNull();
  });

  it("computes the position from the earliest transcript start while recording", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    mocks.transcripts = [{ startedAt: 95_000 }, { startedAt: 96_000 }];
    mocks.sessionMode = "active";

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBe(5_000);
  });

  it("exposes onActivate even when no audio exists, and it does not seek", () => {
    mocks.audioExists = false;

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(typeof result.current.onActivate).toBe("function");
    result.current.onActivate?.(5_000);

    expect(mocks.seek).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("seeks and starts playback on activation when audio exists", () => {
    mocks.audioExists = true;

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));
    result.current.onActivate?.(5_000);

    expect(mocks.seek).toHaveBeenCalledWith(5);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("exposes a stable activateLabel", () => {
    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.activateLabel).toBe(
      "Jump to this point in the recording",
    );
  });
});
