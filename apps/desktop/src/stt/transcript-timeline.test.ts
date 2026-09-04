import { describe, expect, it } from "vitest";

import { sessionTimelineBaseMs } from "./transcript-timeline";

describe("sessionTimelineBaseMs", () => {
  it("returns null for no transcripts", () => {
    expect(sessionTimelineBaseMs([])).toBeNull();
  });

  it("returns the single transcript's start", () => {
    expect(sessionTimelineBaseMs([{ startedAt: 100, hasWords: true }])).toBe(
      100,
    );
  });

  it("returns the earliest start out of order", () => {
    expect(
      sessionTimelineBaseMs([
        { startedAt: 500, hasWords: true },
        { startedAt: 100, hasWords: true },
      ]),
    ).toBe(100);
  });

  it("ignores a zero startedAt", () => {
    expect(
      sessionTimelineBaseMs([{ startedAt: 0, hasWords: false }]),
    ).toBeNull();
  });

  it("ignores a non-finite startedAt", () => {
    expect(
      sessionTimelineBaseMs([
        { startedAt: Number.NaN, hasWords: true },
        { startedAt: 400, hasWords: true },
      ]),
    ).toBe(400);
  });

  it("prefers the earliest transcript that has words over a wordless earlier one", () => {
    expect(
      sessionTimelineBaseMs([
        { startedAt: 100, hasWords: false },
        { startedAt: 500, hasWords: true },
      ]),
    ).toBe(500);
  });

  it("falls back to all candidates when none have words yet", () => {
    expect(
      sessionTimelineBaseMs([
        { startedAt: 300, hasWords: false },
        { startedAt: 100, hasWords: false },
      ]),
    ).toBe(100);
  });
});
