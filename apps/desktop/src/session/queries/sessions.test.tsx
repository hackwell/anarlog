import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  executeTransaction: vi.fn().mockResolvedValue(undefined),
  options: null as null | {
    enabled?: boolean;
    mapRows?: (rows: Array<Record<string, unknown>>) => unknown;
    params?: unknown[];
    sql: string;
  },
  rows: [] as Array<Record<string, unknown>>,
  loading: false,
}));

vi.mock("~/db", () => ({
  executeTransaction: mocks.executeTransaction,
  liveQueryClient: { execute: mocks.execute },
  useLiveQuery: (options: {
    enabled?: boolean;
    mapRows?: (rows: Array<Record<string, unknown>>) => unknown;
    params?: unknown[];
    sql: string;
  }) => {
    mocks.options = options;
    return {
      data:
        options.enabled === false || mocks.loading
          ? undefined
          : options.mapRows
            ? options.mapRows(mocks.rows)
            : mocks.rows,
    };
  },
}));

import {
  preloadSession,
  updateSession,
  useSession,
  useSessionSummariesByIds,
} from "./sessions";

describe("session SQLite queries", () => {
  beforeEach(() => {
    mocks.options = null;
    mocks.rows = [];
    mocks.loading = false;
    mocks.execute.mockReset();
    mocks.executeTransaction.mockClear();
  });

  it("uses prefetched content while the live subscription starts", async () => {
    mocks.loading = true;
    mocks.execute.mockResolvedValue([
      {
        id: "prefetched-session",
        owner_user_id: "user-1",
        created_at: "2026-08-24T09:00:00.000Z",
        folder_path: "",
        event_json: "{}",
        title: "Planning",
        raw_body:
          '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Ready immediately"}]}]}',
        raw_body_format: "prosemirror_json",
        raw_template_id: "",
        locked: 0,
      },
    ]);

    await preloadSession("prefetched-session");
    const { result } = renderHook(() => useSession("prefetched-session"));

    expect(result.current?.raw_md).toContain("Ready immediately");
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining("FROM sessions"),
      ["prefetched-session"],
    );
  });

  it("reads the customer back on the session record", async () => {
    mocks.loading = true;
    mocks.execute.mockResolvedValue([
      {
        id: "customer-session",
        owner_user_id: "user-1",
        created_at: "2026-08-24T09:00:00.000Z",
        folder_path: "",
        event_json: "{}",
        title: "Planning",
        raw_body: "",
        raw_body_format: "prosemirror_json",
        raw_template_id: "",
        locked: 0,
        organization_id: "org-7",
      },
    ]);

    await preloadSession("customer-session");
    const { result } = renderHook(() => useSession("customer-session"));

    expect(result.current?.organization_id).toBe("org-7");
  });

  it("reads a persisted customer-clear flag back on the session record", async () => {
    mocks.loading = true;
    mocks.execute.mockResolvedValue([
      {
        id: "cleared-session",
        owner_user_id: "user-1",
        created_at: "2026-08-24T09:00:00.000Z",
        folder_path: "",
        event_json: "{}",
        title: "Planning",
        raw_body: "",
        raw_body_format: "prosemirror_json",
        raw_template_id: "",
        locked: 0,
        organization_id: "",
        customer_cleared: 1,
      },
    ]);

    await preloadSession("cleared-session");
    const { result } = renderHook(() => useSession("cleared-session"));

    expect(result.current?.customer_cleared).toBe(true);
  });

  it("persists an explicit clear with json_set so it survives a restart", async () => {
    await updateSession("s1", {
      organization_id: "",
      customer_cleared: true,
    });

    const [statements] = mocks.executeTransaction.mock.calls[0] as [
      Array<{ sql: string; params: unknown[] }>,
    ];
    const sessionUpdate = statements[0];

    expect(sessionUpdate.sql).toContain("organization_id = ?");
    expect(sessionUpdate.sql).toContain("metadata_json = json_set(");
    expect(sessionUpdate.sql).toContain("'$.customerCleared'");
    expect(sessionUpdate.sql).toContain("json('true')");
  });

  it("clears the persisted flag with json_remove instead of overwriting metadata_json", async () => {
    await updateSession("s1", {
      organization_id: "org-schmidt",
      customer_cleared: false,
    });

    const [statements] = mocks.executeTransaction.mock.calls[0] as [
      Array<{ sql: string; params: unknown[] }>,
    ];
    const sessionUpdate = statements[0];

    expect(sessionUpdate.sql).toContain("metadata_json = json_remove(");
    expect(sessionUpdate.sql).toContain("'$.customerCleared'");
    // The fallback keeps every other metadata_json key when the column
    // starts out invalid, rather than blowing the whole document away.
    expect(sessionUpdate.sql).toContain("json_valid(metadata_json)");
  });

  it("leaves metadata_json alone when the clear flag is not part of the change", async () => {
    await updateSession("s1", { title: "Renamed" });

    const [statements] = mocks.executeTransaction.mock.calls[0] as [
      Array<{ sql: string; params: unknown[] }>,
    ];
    const sessionUpdate = statements[0];

    expect(sessionUpdate.sql).not.toContain("metadata_json");
  });

  it("deduplicates concurrent session preloads", async () => {
    mocks.execute.mockResolvedValue([]);

    await Promise.all([
      preloadSession("deduplicated-session"),
      preloadSession("deduplicated-session"),
    ]);

    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("loads deduplicated summaries only for referenced ids", () => {
    mocks.rows = [
      {
        id: "session-1",
        title: "Planning",
        created_at: "2026-07-10T09:00:00.000Z",
      },
    ];

    const { result } = renderHook(() =>
      useSessionSummariesByIds(["session-1", "session-1", ""]),
    );

    expect(result.current).toEqual(mocks.rows);
    expect(mocks.options?.enabled).toBe(true);
    expect(mocks.options?.params).toEqual(["session-1"]);
    expect(mocks.options?.sql).toContain("WHERE id IN (?)");
  });

  it("does not expose summaries when no ids are referenced", () => {
    mocks.rows = [
      {
        id: "session-1",
        title: "Planning",
        created_at: "2026-07-10T09:00:00.000Z",
      },
    ];

    const { result } = renderHook(() => useSessionSummariesByIds([]));

    expect(result.current).toEqual([]);
    expect(mocks.options?.enabled).toBe(false);
    expect(mocks.options?.params).toEqual([]);
    expect(mocks.options?.sql).toContain("WHERE id IN (NULL)");
  });

  it("keeps the last resolved summaries while a by-id query is loading", () => {
    mocks.rows = [
      {
        id: "session-1",
        title: "Planning",
        created_at: "2026-07-10T09:00:00.000Z",
      },
    ];

    const { result, rerender } = renderHook(
      ({ ids }) => useSessionSummariesByIds(ids),
      { initialProps: { ids: ["session-1"] } },
    );

    expect(result.current).toEqual(mocks.rows);

    mocks.loading = true;
    rerender({ ids: ["session-1", "session-2"] });

    expect(result.current).toEqual([
      {
        id: "session-1",
        title: "Planning",
        created_at: "2026-07-10T09:00:00.000Z",
      },
    ]);
    expect(mocks.options?.params).toEqual(["session-1", "session-2"]);
  });

  it("drops held summaries when no ids are referenced", () => {
    mocks.rows = [
      {
        id: "session-1",
        title: "Planning",
        created_at: "2026-07-10T09:00:00.000Z",
      },
    ];

    const { result, rerender } = renderHook(
      ({ ids }) => useSessionSummariesByIds(ids),
      { initialProps: { ids: ["session-1"] } },
    );

    expect(result.current).toEqual(mocks.rows);

    mocks.loading = true;
    rerender({ ids: [] });

    expect(result.current).toEqual([]);
  });
});
