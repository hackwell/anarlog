import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, suggestTagsMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  suggestTagsMock: vi.fn(),
}));

vi.mock("~/db", () => ({ liveQueryClient: { execute: executeMock } }));
vi.mock("./suggest", async () => ({
  ...(await vi.importActual<typeof import("./suggest")>("./suggest")),
  suggestTags: suggestTagsMock,
}));

import { sessionHasTags, useTagSuggestions } from "./suggestion-store";

const model = {} as never;
const longTranscript = JSON.stringify(
  Array.from({ length: 80 }, (_, index) => ({ text: `word${index}` })),
);

describe("tag suggestion store", () => {
  beforeEach(() => {
    useTagSuggestions.setState({ bySession: {} });
    executeMock.mockReset();
    suggestTagsMock.mockReset();
    executeMock.mockImplementation(async (sql: string) =>
      sql.includes("FROM transcripts")
        ? [{ words_json: longTranscript }]
        : [{ name: "Kunde" }],
    );
    suggestTagsMock.mockResolvedValue({ chosen: ["Kunde"], proposed: [] });
  });

  it("asks once per session and keeps the answer", async () => {
    await useTagSuggestions.getState().request("s1", model);
    await useTagSuggestions.getState().request("s1", model);

    expect(suggestTagsMock).toHaveBeenCalledOnce();
    expect(suggestTagsMock.mock.calls[0]?.[0]).toMatchObject({
      vocabulary: ["Kunde"],
    });
    expect(useTagSuggestions.getState().bySession.s1).toEqual({
      chosen: ["Kunde"],
      proposed: [],
    });
  });

  it("asks again only when forced", async () => {
    await useTagSuggestions.getState().request("s1", model);
    await useTagSuggestions.getState().request("s1", model, { force: true });

    expect(suggestTagsMock).toHaveBeenCalledTimes(2);
  });

  it("drops a dismissed name", async () => {
    await useTagSuggestions.getState().request("s1", model);
    useTagSuggestions.getState().dismiss("s1", "Kunde");

    expect(useTagSuggestions.getState().bySession.s1).toEqual({
      chosen: [],
      proposed: [],
    });
  });

  it("skips the model for a short transcript", async () => {
    executeMock.mockImplementation(async (sql: string) =>
      sql.includes("FROM transcripts") ? [{ words_json: "[]" }] : [],
    );

    await useTagSuggestions.getState().request("s2", model);

    expect(suggestTagsMock).not.toHaveBeenCalled();
    expect(useTagSuggestions.getState().bySession.s2).toEqual({
      chosen: [],
      proposed: [],
    });
  });

  it("reports whether a session already carries tags", async () => {
    executeMock.mockResolvedValueOnce([{ n: 2 }]);
    expect(await sessionHasTags("s1")).toBe(true);
    executeMock.mockResolvedValueOnce([{ n: 0 }]);
    expect(await sessionHasTags("s1")).toBe(false);
  });
});
