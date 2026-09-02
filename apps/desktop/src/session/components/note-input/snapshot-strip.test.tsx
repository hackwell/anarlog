import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  dispatch: vi.fn(),
}));

vi.mock("~/stt/meeting-snapshot-records", () => ({
  useMeetingSnapshotRecords: () => mocks.records,
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));
vi.mock("~/session/editor-activity", () => ({
  getCanonicalSessionEditor: () => ({
    state: {
      doc: { content: { size: 10 } },
      schema: { nodes: { image: { create: (attrs: unknown) => ({ attrs }) } } },
      tr: { insert: vi.fn((pos: number, node: unknown) => ({ pos, node })) },
    },
    dispatch: mocks.dispatch,
  }),
}));

import { SnapshotStrip } from "./snapshot-strip";

describe("SnapshotStrip", () => {
  afterEach(() => {
    cleanup();
    mocks.records = [];
    mocks.dispatch.mockReset();
  });

  it("renders nothing without snapshots", () => {
    const { container } = render(<SnapshotStrip sessionId="session-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("inserts a clicked slide into the note", () => {
    mocks.records = [
      {
        id: "doc-1",
        attachmentId: "att-1",
        filename: "slide-140301.jpg",
        path: "/tmp/att-1.jpg",
        capturedAtMs: Date.UTC(2026, 8, 2, 14, 3, 1),
        width: 1600,
        height: 900,
        appName: "zoom.us",
        windowTitle: "Zoom Meeting",
      },
    ];
    render(<SnapshotStrip sessionId="session-1" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Insert slide from 14:03" }),
    );

    expect(mocks.dispatch).toHaveBeenCalledWith({
      pos: 10,
      node: {
        attrs: {
          src: "asset://localhost/tmp/att-1.jpg",
          attachmentId: "att-1",
        },
      },
    });
  });
});
