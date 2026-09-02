import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, executeTransactionMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  executeTransactionMock: vi.fn(),
}));

vi.mock("~/db", () => ({
  executeTransaction: executeTransactionMock,
  liveQueryClient: { execute: executeMock },
  useLiveQuery: vi.fn(() => ({ data: [] })),
}));
vi.mock("~/db/write-queue", () => ({
  enqueueDatabaseWrite: (_key: string, run: () => Promise<unknown>) => run(),
}));

import {
  loadMeetingSnapshotRecords,
  parseMeetingSnapshotDocument,
  persistMeetingSnapshotRecord,
} from "./meeting-snapshot-records";

const record = {
  attachmentId: "att-1",
  filename: "slide-140301.jpg",
  path: "/tmp/att-1.jpg",
  capturedAtMs: 1_700_000_000_000,
  width: 1600,
  height: 900,
  appName: "zoom.us",
  windowTitle: "Zoom Meeting",
};

describe("meeting snapshot records", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeTransactionMock.mockReset().mockResolvedValue([]);
  });

  it("writes one meeting_snapshot document per frame", async () => {
    const snapshotId = await persistMeetingSnapshotRecord("session-1", record);

    expect(snapshotId).toBeTruthy();
    const [statements] = executeTransactionMock.mock.calls[0]!;
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("'meeting_snapshot'");
    expect(statements[0].params[0]).toBe(snapshotId);
    expect(JSON.parse(statements[0].params[1])).toMatchObject(record);
    expect(statements[0].params.at(-1)).toBe("session-1");
  });

  it("parses stored rows and drops malformed ones", () => {
    expect(
      parseMeetingSnapshotDocument({
        id: "doc-1",
        body: JSON.stringify(record),
      }),
    ).toEqual({ id: "doc-1", ...record });
    expect(parseMeetingSnapshotDocument({ id: "doc-2", body: "{" })).toBeNull();
    expect(
      parseMeetingSnapshotDocument({
        id: "doc-3",
        body: JSON.stringify({ path: 1 }),
      }),
    ).toBeNull();
  });

  it("loads records in capture order", async () => {
    executeMock.mockResolvedValue([
      { id: "doc-1", body: JSON.stringify(record) },
      { id: "doc-2", body: JSON.stringify({ ...record, capturedAtMs: 2 }) },
    ]);

    const records = await loadMeetingSnapshotRecords("session-1");

    expect(executeMock.mock.calls[0]![1]).toEqual(["session-1"]);
    expect(records.map((entry) => entry.id)).toEqual(["doc-1", "doc-2"]);
  });
});
