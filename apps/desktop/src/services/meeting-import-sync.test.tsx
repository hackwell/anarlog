import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connected: false,
  connectedImportSyncQueryOptions: vi.fn(),
}));

vi.mock("~/imports/connected-import", () => ({
  connectedImportCredentialsQueryOptions: (providerId: string) => ({
    queryKey: ["credentials", providerId],
  }),
  connectedImportSyncQueryOptions: (
    provider: { id: string },
    enabled: boolean,
  ) => mocks.connectedImportSyncQueryOptions(provider, enabled),
  isLocalConnectedImport: (provider: { directImport?: string }) =>
    provider.directImport === "mcp-oauth" || provider.directImport === "cli",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: ({ queries }: { queries: { queryKey: string[] }[] }) =>
    queries[0]?.queryKey[0] === "credentials"
      ? queries.map(() => ({ data: mocks.connected ? {} : null }))
      : queries.map(() => ({})),
}));

import { MeetingImportSync } from "./meeting-import-sync";

describe("MeetingImportSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connected = false;
    mocks.connectedImportSyncQueryOptions.mockImplementation(
      (provider: { id: string }, enabled: boolean) => ({
        queryKey: ["sync", provider.id, String(enabled)],
      }),
    );
  });

  afterEach(cleanup);

  it("pauses connected imports until a provider is connected", () => {
    render(<MeetingImportSync />);

    expect(mocks.connectedImportSyncQueryOptions).toHaveBeenCalled();
    expect(
      mocks.connectedImportSyncQueryOptions.mock.calls.every(
        ([, enabled]) => enabled === false,
      ),
    ).toBe(true);
  });

  it("syncs local MCP and CLI imports without an account", () => {
    mocks.connected = true;

    render(<MeetingImportSync />);

    expect(
      mocks.connectedImportSyncQueryOptions.mock.calls.map(
        ([provider]) => provider.id,
      ),
    ).toEqual(expect.arrayContaining(["granola", "plaud"]));
    expect(
      mocks.connectedImportSyncQueryOptions.mock.calls.every(
        ([, enabled]) => enabled === true,
      ),
    ).toBe(true);
  });
});
