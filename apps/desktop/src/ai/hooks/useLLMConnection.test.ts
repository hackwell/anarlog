import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLanguageModel,
  normalizeLLMProviderId,
} from "./useLLMConnection";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

describe("normalizeLLMProviderId", () => {
  it("maps the legacy hosted provider id to Session Echo", () => {
    expect(normalizeLLMProviderId("hyprnote")).toBe("anarlog");
  });

  it("preserves current provider ids", () => {
    expect(normalizeLLMProviderId("openai")).toBe("openai");
  });
});

describe("ChatGPT request parameters", () => {
  const subscriptionKey = JSON.stringify({
    type: "oauth",
    refresh: "refresh-token",
    access: "access-token",
    expires: Date.now() + 60 * 60 * 1000,
  });

  const sendRequest = async (
    apiKey: string,
    modelId: string,
    options: { maxOutputTokens?: number; temperature?: number; topP?: number },
  ): Promise<Record<string, unknown>> => {
    const model = createLanguageModel({
      providerId: "chatgpt",
      modelId,
      baseUrl: "https://api.openai.com/v1",
      apiKey,
    });

    await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      ...options,
    });

    const { calls } = vi.mocked(tauriFetch).mock;
    const call = calls[calls.length - 1];
    return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.mocked(tauriFetch).mockReset();
    vi.mocked(tauriFetch).mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  });

  it("drops max_output_tokens on the ChatGPT subscription path", async () => {
    const body = await sendRequest(subscriptionKey, "gpt-5", {
      maxOutputTokens: 512,
    });

    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.store).toBe(false);
  });

  it("keeps max_output_tokens on the ChatGPT API key path", async () => {
    const body = await sendRequest("sk-test-key", "gpt-5", {
      maxOutputTokens: 512,
    });

    expect(body.max_output_tokens).toBe(512);
  });

  it("drops the sampling controls the subscription endpoint rejects", async () => {
    const subscription = await sendRequest(subscriptionKey, "gpt-4.1", {
      temperature: 0,
      topP: 0.5,
    });

    expect(subscription).not.toHaveProperty("temperature");
    expect(subscription).not.toHaveProperty("top_p");

    const apiKey = await sendRequest("sk-test-key", "gpt-4.1", {
      temperature: 0,
      topP: 0.5,
    });

    expect(apiKey.temperature).toBe(0);
    expect(apiKey.top_p).toBe(0.5);
  });

  it("warns that the subscription endpoint forced the parameters out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendRequest(subscriptionKey, "gpt-5", { maxOutputTokens: 512 });

    expect(warn).toHaveBeenCalledWith(
      "[chatgpt] dropped request parameters the ChatGPT subscription endpoint rejects: max_output_tokens",
    );

    warn.mockRestore();
  });
});
