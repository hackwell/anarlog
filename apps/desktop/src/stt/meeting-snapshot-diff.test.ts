import { describe, expect, it } from "vitest";

import { frameDifference } from "./meeting-snapshot-diff";

describe("frameDifference", () => {
  it("is zero for identical frames", () => {
    const frame = new Uint8Array(1024).fill(120);
    expect(frameDifference(frame, frame)).toBe(0);
  });

  it("ignores small brightness noise", () => {
    const a = new Uint8Array(1024).fill(120);
    const b = new Uint8Array(1024).fill(140);
    expect(frameDifference(a, b)).toBe(0);
  });

  it("counts pixels that changed clearly", () => {
    const a = new Uint8Array(1024).fill(0);
    const b = new Uint8Array(1024).fill(0);
    b.fill(255, 0, 256);
    expect(frameDifference(a, b)).toBeCloseTo(0.25);
  });

  it("treats mismatched sizes as fully different", () => {
    expect(frameDifference(new Uint8Array(16), new Uint8Array(32))).toBe(1);
  });
});
