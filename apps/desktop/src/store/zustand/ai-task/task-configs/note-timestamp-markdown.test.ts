import { afterEach, describe, expect, it, vi } from "vitest";

import { annotateNoteMarkdown } from "./note-timestamp-markdown";

function jsonSnapshot(content: unknown[]) {
  return {
    rawContent: JSON.stringify({ type: "doc", content }),
    rawContentFormat: "json",
    rawMarkdown: "ignored",
  };
}

const anchoredParagraph = {
  type: "paragraph",
  attrs: { recordedAtMs: 724_000 },
  content: [{ type: "text", text: "clarify pricing" }],
};

describe("annotateNoteMarkdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("falls back to the stored markdown when a content element is malformed", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const markdown = annotateNoteMarkdown({
      rawContent: JSON.stringify({
        type: "doc",
        content: [
          null,
          {
            type: "paragraph",
            attrs: { recordedAtMs: 724_000 },
            content: [{ type: "text", text: "clarify pricing" }],
          },
        ],
      }),
      rawContentFormat: "json",
      rawMarkdown: "stored",
    });

    expect(markdown).toBe("stored");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] failed to annotate note positions",
      expect.any(TypeError),
    );
  });

  it("falls back to the stored markdown when a node beside an anchor cannot be serialized", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // json2md logs its own internal parse failure via console.error before
    // returning "" — expected noise from the unrecognized node type, not a
    // symptom of this test.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
        {
          type: "notARealNodeType",
          content: [{ type: "text", text: "mystery" }],
        },
      ]),
    );

    expect(markdown).toBe("ignored");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] failed to annotate note positions",
      expect.any(Error),
    );
  });

  it("annotates normally when an anchored paragraph sits beside a legitimately empty paragraph", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
        { type: "paragraph" },
      ]),
    );

    expect(markdown).toBe("[12:04] clarify pricing\n\n");
  });

  it("pins the output of two adjacent top-level bullet lists", () => {
    // Two same-type lists serialized as separate top-level blocks and joined
    // by a blank line: each keeps its own "- " marker rather than merging
    // into one list with both items. Pinned so a serializer change is caught.
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
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "two" }] },
              ],
            },
          ],
        },
      ]),
    );

    expect(markdown).toBe("[12:04] clarify pricing\n\n- one\n\n- two");
  });

  it("falls back to the stored markdown when a top-level element is a bare string", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const markdown = annotateNoteMarkdown(
      jsonSnapshot([anchoredParagraph, "loose string"]),
    );

    expect(markdown).toBe("ignored");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] failed to annotate note positions",
      expect.any(Error),
    );
  });

  it("falls back to the stored markdown when a top-level element is a bare number", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const markdown = annotateNoteMarkdown(
      jsonSnapshot([anchoredParagraph, 42]),
    );

    expect(markdown).toBe("ignored");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] failed to annotate note positions",
      expect.any(Error),
    );
  });

  it("falls back to the stored markdown when a top-level element has no type", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const markdown = annotateNoteMarkdown(
      jsonSnapshot([anchoredParagraph, { foo: "bar" }]),
    );

    expect(markdown).toBe("ignored");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] failed to annotate note positions",
      expect.any(Error),
    );
  });

  it("annotates normally when a whitespace-only paragraph sits beside an anchor", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        anchoredParagraph,
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
      ]),
    );

    expect(markdown).toBe("[12:04] clarify pricing\n\n");
  });

  it("annotates normally when a hardBreak-only paragraph sits beside an anchor", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        anchoredParagraph,
        { type: "paragraph", content: [{ type: "hardBreak" }] },
      ]),
    );

    expect(markdown).toBe("[12:04] clarify pricing\n\n");
  });

  it("falls back to the stored markdown when real text sits next to a malformed nested child", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The malformed nested child fails the whole paragraph's construction in
    // prosemirror-model, which json2md swallows internally via console.error
    // — expected noise from this scenario, not a symptom of the test.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        anchoredParagraph,
        {
          type: "paragraph",
          content: [
            { type: "text", text: "real text" },
            { type: "notARealNodeType" },
          ],
        },
      ]),
    );

    expect(markdown).toBe("ignored");
    expect(consoleWarn).toHaveBeenCalledWith(
      "[enhance] failed to annotate note positions",
      expect.any(Error),
    );
  });
});
