import { describe, expect, it } from "vitest";

import { annotateNoteMarkdown } from "./note-timestamp-markdown";

function jsonSnapshot(content: unknown[]) {
  return {
    rawContent: JSON.stringify({ type: "doc", content }),
    rawContentFormat: "json",
    rawMarkdown: "ignored",
  };
}

describe("annotateNoteMarkdown", () => {
  it("prefixes an anchored paragraph with its position", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
      ]),
    );

    expect(markdown.trim()).toBe("[12:04] clarify pricing");
  });

  it("leaves paragraphs without an anchor alone", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "prepared" }] },
      ]),
    );

    expect(markdown.trim()).toBe("[12:04] clarify pricing\n\nprepared");
  });

  it("returns the stored markdown for a markdown note", () => {
    expect(
      annotateNoteMarkdown({
        rawContent: "- typed",
        rawContentFormat: "markdown",
        rawMarkdown: "- typed",
      }),
    ).toBe("- typed");
  });

  it("returns the stored markdown when the note has no anchors at all", () => {
    const snapshot = jsonSnapshot([
      { type: "paragraph", content: [{ type: "text", text: "prepared" }] },
    ]);

    expect(annotateNoteMarkdown(snapshot)).toBe(snapshot.rawMarkdown);
  });

  it("falls back to the stored markdown when the content will not parse", () => {
    expect(
      annotateNoteMarkdown({
        rawContent: "{ not json",
        rawContentFormat: "json",
        rawMarkdown: "stored",
      }),
    ).toBe("stored");
  });

  it("leaves a note's own square brackets untouched", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "see [1] for details" }],
        },
      ]),
    );

    expect(markdown.trim()).toBe(
      "[12:04] clarify pricing\n\nsee \\[1\\] for details",
    );
  });

  it("serializes a bullet list following an anchored paragraph without a prefix", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "follow up" }],
                },
              ],
            },
          ],
        },
      ]),
    );

    expect(markdown.trim()).toBe("[12:04] clarify pricing\n\n- follow up");
  });
});
