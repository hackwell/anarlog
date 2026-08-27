import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { config, providerConfig, startServerForPathMock } = vi.hoisted(() => ({
  config: {
    current_stt_provider: "local_file",
    current_stt_model: "local-file",
    local_stt_model_path: "",
  },
  providerConfig: {
    type: "stt",
    base_url: "   ",
    api_key: "",
  },
  startServerForPathMock: vi.fn(),
}));

vi.mock("@anlg/plugin-local-stt", () => ({
  commands: {
    getServerForModel: vi.fn(),
    isModelDownloaded: vi.fn(),
    startServerForPath: startServerForPathMock,
  },
}));

vi.mock("~/settings/providers", () => ({
  useAiProvider: () => providerConfig,
}));

vi.mock("~/shared/config", () => ({
  useConfigValues: () => config,
}));

vi.mock("~/stt/capabilities", () => ({
  isLocalFileSttModel: (provider: string, model: string) =>
    provider === "local_file" && model === "local-file",
  isOnDeviceSttModel: () => false,
  isRealtimeLocalModel: () => false,
}));

import { useSTTConnection } from "./useSTTConnection";

describe("useSTTConnection", () => {
  beforeEach(() => {
    config.current_stt_provider = "local_file";
    config.current_stt_model = "local-file";
    config.local_stt_model_path = "";
    providerConfig.base_url = "   ";
    providerConfig.api_key = "";
    startServerForPathMock.mockReset();
  });

  it("uses the stored endpoint and key for a self-configured provider", () => {
    config.current_stt_provider = "deepgram";
    config.current_stt_model = "nova-3";
    providerConfig.base_url = " https://api.deepgram.com/v1/listen ";
    providerConfig.api_key = " user-key ";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    expect(result.current.conn).toEqual({
      provider: "deepgram",
      model: "nova-3",
      baseUrl: "https://api.deepgram.com/v1/listen",
      apiKey: "user-key",
    });
  });

  it("starts a selected local model file and exposes its local URL", async () => {
    config.current_stt_provider = "local_file";
    config.current_stt_model = "local-file";
    config.local_stt_model_path = "/models/ggml-small.bin";
    startServerForPathMock.mockResolvedValue({
      status: "ok",
      data: "http://127.0.0.1:4040/v1",
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSTTConnection(), { wrapper });

    await waitFor(() =>
      expect(result.current.conn).toEqual({
        provider: "local_file",
        model: "local-file",
        baseUrl: "http://127.0.0.1:4040/v1",
        apiKey: "",
      }),
    );
    expect(startServerForPathMock).toHaveBeenCalledWith(
      "/models/ggml-small.bin",
    );
  });
});
