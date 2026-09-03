import { describe, expect, it } from "vitest";

import {
  frameDifference,
  hasNewSlideText,
  slideTextLines,
} from "./meeting-snapshot-diff";

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

describe("hasNewSlideText", () => {
  // OCR output of consecutive Teams frames: only the timer and noise differ.
  const teamsFrame = (timer: string, noise: string) =>
    slideTextLines(
      [
        "•* Woyack GmbH",
        "Mattan Onboarding",
        "Einstellungen ändern",
        'Ihr Status wird auf „Nicht stören" festgelegt.',
        ", 2",
        noise,
        timer,
        "Apps",
        "Reagieren",
        "Kamera",
        "Mikro",
        "He",
      ].join("\n"),
    );

  it("ignores a running timer and OCR jitter", () => {
    const previous = teamsFrame("03:21", "v");
    const current = teamsFrame("04:07", "+J");
    expect(hasNewSlideText(previous, current)).toBe(false);
  });

  it("treats truncated repeats of known words as known", () => {
    const previous = slideTextLines("Heben\nVerlassen\nMikrofon stummschalten");
    const current = slideTextLines("He\nVerlassen\nMikro");
    expect(hasNewSlideText(previous, current)).toBe(false);
  });

  it("keeps a frame that adds a sentence", () => {
    const previous = teamsFrame("02:07", "v");
    const current = slideTextLines(
      'Woyack GmbH\nMattan Onboarding\n02:47\nIhr Status wird auf „Nicht stören" festgelegt.\nSie werden nur für dringende Nachrichten benachrichtigt.',
    );
    expect(hasNewSlideText(previous, current)).toBe(true);
  });

  it("needs readable words on the first frame", () => {
    expect(hasNewSlideText(null, slideTextLines("•*\n, 2\n03:21\nv"))).toBe(
      false,
    );
    expect(
      hasNewSlideText(null, slideTextLines("Q3 Roadmap\n- Onboarding v2")),
    ).toBe(true);
  });
});
