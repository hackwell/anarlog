import { render, screen } from "@testing-library/react";
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
});
