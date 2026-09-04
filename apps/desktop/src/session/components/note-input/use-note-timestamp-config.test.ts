import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcripts: [] as { startedAt: number; hasWords: boolean }[],
  live: {
    sessionId: null as string | null,
    status: "inactive" as "inactive" | "active" | "finalizing",
    seconds: 0,
  },
  audioExists: false,
  seek: vi.fn(),
  start: vi.fn(),
}));

vi.mock("~/stt/queries", () => ({
  useSessionTranscriptMetadata: () => mocks.transcripts,
}));

vi.mock("~/stt/contexts", () => ({
  useListenerStore: () => ({
    getState: () => ({ live: mocks.live }),
  }),
}));

vi.mock("~/audio-player", () => ({
  useAudioPlayer: () => ({
    seek: mocks.seek,
    start: mocks.start,
    audioExists: mocks.audioExists,
  }),
}));

import {
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

describe("useNoteTimestampConfig", () => {
  beforeEach(() => {
    mocks.transcripts = [];
    mocks.live = { sessionId: null, status: "inactive", seconds: 0 };
    mocks.audioExists = false;
    mocks.seek.mockReset();
    mocks.start.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("anchors to the capture start when recording has produced no transcript yet", () => {
    // This is the reported bug: a record-only (or not-yet-transcribed) capture
    // has no transcript row at all, so the base must come from the live capture
    // itself, not from `~/stt/queries`.
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    mocks.transcripts = [];
    mocks.live = { sessionId: "session-1", status: "active", seconds: 5 };

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBe(5_000);
  });

  it("prefers the capture start over a transcript that starts later (batch transcription case)", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    // Capture started 5s ago (95_000); batch transcription only started at
    // 98_000, once transcription itself began, well after the capture start.
    mocks.live = { sessionId: "session-1", status: "active", seconds: 5 };
    mocks.transcripts = [{ startedAt: 98_000, hasWords: true }];

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBe(5_000);
  });

  it("prefers a transcript that starts earlier than the capture (resumed session case)", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    // Capture (this segment) started 5s ago (95_000); an earlier segment's
    // transcript started at 90_000, before this capture segment began.
    mocks.live = { sessionId: "session-1", status: "active", seconds: 5 };
    mocks.transcripts = [{ startedAt: 90_000, hasWords: true }];

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBe(10_000);
  });

  it("computes the position from the earliest transcript start while recording", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    mocks.live = { sessionId: "session-1", status: "active", seconds: 1 };
    mocks.transcripts = [
      { startedAt: 95_000, hasWords: true },
      { startedAt: 96_000, hasWords: true },
    ];

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBe(5_000);
  });

  it("bases the position on the earliest transcript that has words, not a wordless leading row", () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    mocks.live = { sessionId: "session-1", status: "active", seconds: 1 };
    mocks.transcripts = [
      { startedAt: 90_000, hasWords: false },
      { startedAt: 95_000, hasWords: true },
    ];

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBe(5_000);
  });

  it("returns null when not capturing, even with a transcript present", () => {
    mocks.transcripts = [{ startedAt: 1_000, hasWords: true }];
    mocks.live = { sessionId: "session-1", status: "inactive", seconds: 0 };

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBeNull();
  });

  it("returns null when not capturing and there is no transcript", () => {
    mocks.transcripts = [];
    mocks.live = { sessionId: "session-1", status: "inactive", seconds: 0 };

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBeNull();
  });

  it("ignores another session's active capture", () => {
    mocks.live = { sessionId: "other-session", status: "active", seconds: 5 };
    mocks.transcripts = [];

    const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

    expect(result.current.getRecordedAtMs()).toBeNull();
  });

  it.each(["finalizing", "inactive"] as const)(
    "does not contribute a capture start while this session's status is %s",
    (status) => {
      mocks.live = { sessionId: "session-1", status, seconds: 5 };
      mocks.transcripts = [];

      const { result } = renderHook(() => useNoteTimestampConfig("session-1"));

      expect(result.current.getRecordedAtMs()).toBeNull();
    },
  );

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
