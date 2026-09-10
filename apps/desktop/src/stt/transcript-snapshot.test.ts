import { describe, expect, it, vi } from "vitest";

import { parseLiveTranscriptDeltas } from "./transcript-snapshot";

const delta = {
  new_words: [
    {
      id: "w1",
      text: "hi",
      start_ms: 0,
      end_ms: 1,
      channel: 0,
      state: "final",
    },
  ],
  replaced_ids: [],
  partials: [],
};

describe("parseLiveTranscriptDeltas", () => {
  it("reads the deltas from a text column", () => {
    expect(parseLiveTranscriptDeltas(JSON.stringify([delta]), "t1")).toEqual([
      delta,
    ]);
  });

  it("reads the deltas SQLite already parsed for a nested json_object", () => {
    expect(parseLiveTranscriptDeltas([delta], "t1")).toEqual([delta]);
  });

  it("treats an empty parsed array as no deltas, without complaining", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(parseLiveTranscriptDeltas([], "t1")).toEqual([]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("reports text that is not JSON", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(parseLiveTranscriptDeltas("{oh no", "t1")).toEqual([]);
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });
});
