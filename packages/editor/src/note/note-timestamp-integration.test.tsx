import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteEditor } from "./index";

const anchoredContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { recordedAtMs: 724_000 },
      content: [{ type: "text", text: "clarify pricing" }],
    },
  ],
};

describe("NoteEditor timestampConfig", () => {
  it("renders no label without a config", () => {
    render(
      <NoteEditor
        initialContent={anchoredContent}
        enforceTitleHeading={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Jump" })).toBeNull();
  });

  it("renders the label and jumps on click", async () => {
    const onActivate = vi.fn();
    render(
      <NoteEditor
        initialContent={anchoredContent}
        enforceTitleHeading={false}
        timestampConfig={{
          getRecordedAtMs: () => null,
          formatLabel: () => "12:04",
          onActivate,
          activateLabel: "Jump",
        }}
      />,
    );

    const label = await screen.findByRole("button", { name: "Jump" });
    expect(label.textContent).toBe("12:04");

    label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onActivate).toHaveBeenCalledWith(724_000);
  });

  it("renders the label inside the anchored paragraph as the app renders it", async () => {
    // Scoped to this render's own container (rather than the shared `screen`)
    // since this file's earlier tests don't unmount between cases, and this
    // test reuses the same "Jump" label name.
    const { container } = render(
      <NoteEditor
        initialContent={anchoredContent}
        enforceTitleHeading={false}
        timestampConfig={{
          getRecordedAtMs: () => null,
          formatLabel: () => "12:04",
          onActivate: vi.fn(),
          activateLabel: "Jump",
        }}
      />,
    );

    const label = await within(container).findByRole("button", {
      name: "Jump",
    });
    const paragraph = container.querySelector(
      'p[data-recorded-at-ms="724000"]',
    );
    expect(paragraph).not.toBeNull();

    // The label's own stylesheet (note-timestamp.css) targets it as a
    // descendant of this paragraph, not a direct child: the real renderer
    // (@handlewithcare/react-prosemirror's NativeWidgetView) wraps the widget
    // in its own span before inserting our button. A vanilla EditorView would
    // insert the widget as a direct child, so this assertion only fails here,
    // against the app's actual render path.
    expect(paragraph?.contains(label)).toBe(true);
    expect(paragraph?.querySelector(":scope > .note-timestamp")).toBeNull();
  });
});
