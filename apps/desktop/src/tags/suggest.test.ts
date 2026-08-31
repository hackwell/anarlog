import { describe, expect, test } from "vitest";

import { reconcile, transcriptToText } from "./suggest";

const vocabulary = ["Kunden", "Intern", "PIM-Migration"];

describe("reconcile", () => {
  test("keeps a tag the model copied exactly", () => {
    expect(reconcile({ chosen: ["Kunden"], proposed: [] }, vocabulary)).toEqual(
      {
        chosen: ["Kunden"],
        proposed: [],
      },
    );
  });

  // The whole point of the vocabulary: a near-miss has to land on the tag that
  // exists, or the archive ends up with two chips holding half the recordings.
  test("lands a near-miss on the existing tag", () => {
    expect(
      reconcile({ chosen: ["kunde", " INTERN "], proposed: [] }, vocabulary)
        .chosen,
    ).toEqual(["Kunden", "Intern"]);
  });

  test("demotes an invented tag from chosen to proposed", () => {
    const result = reconcile(
      { chosen: ["Kunden", "Preisverhandlung"], proposed: [] },
      vocabulary,
    );

    expect(result.chosen).toEqual(["Kunden"]);
    expect(result.proposed).toEqual(["Preisverhandlung"]);
  });

  // Proposing something that already exists is a hit, not a new tag - otherwise
  // the person is asked to confirm a word they already have.
  test("treats a proposal that already exists as a hit", () => {
    const result = reconcile(
      { chosen: [], proposed: ["kunden", "Personalthema"] },
      vocabulary,
    );

    expect(result.chosen).toEqual(["Kunden"]);
    expect(result.proposed).toEqual(["Personalthema"]);
  });

  test("never repeats the same tag", () => {
    const result = reconcile(
      { chosen: ["Kunden", "kunde"], proposed: ["Kunden"] },
      vocabulary,
    );

    expect(result.chosen).toEqual(["Kunden"]);
    expect(result.proposed).toEqual([]);
  });

  test("caps what it returns", () => {
    const result = reconcile(
      {
        chosen: vocabulary,
        proposed: ["Eins", "Zwei", "Drei", "Vier"],
      },
      vocabulary,
    );

    expect(result.chosen.length).toBeLessThanOrEqual(4);
    expect(result.proposed.length).toBeLessThanOrEqual(2);
  });

  test("survives a model that returns nothing usable", () => {
    expect(reconcile({ chosen: ["", "  "], proposed: [] }, vocabulary)).toEqual(
      { chosen: [], proposed: [] },
    );
  });
});

describe("transcriptToText", () => {
  test("joins the words back into a sentence", () => {
    const words = JSON.stringify([
      { text: " Das", start_ms: 0 },
      { text: " ist", start_ms: 400 },
      { text: " ein Test", start_ms: 800 },
    ]);
    expect(transcriptToText(words)).toBe("Das ist ein Test");
  });

  // A half-written transcript must not take the tag editor down with it.
  test("returns nothing for missing or broken input", () => {
    expect(transcriptToText(null)).toBe("");
    expect(transcriptToText("not json")).toBe("");
    expect(transcriptToText("{}")).toBe("");
  });
});
