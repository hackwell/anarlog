import { describe, expect, it, vi } from "vitest";

import { stopTauriListener } from "./stop-tauri-listener";

describe("stopTauriListener", () => {
  it("stops the listener", async () => {
    const stop = vi.fn();
    stopTauriListener(Promise.resolve(stop));

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it("swallows a listener that is already gone", async () => {
    const rejected = Promise.reject(new Error("resource id 1 is invalid"));

    expect(() => stopTauriListener(rejected)).not.toThrow();
    await expect(rejected.catch(() => "handled")).resolves.toBe("handled");
  });

  it("swallows a stop that rejects with a bare string, as Tauri does", async () => {
    const stop = vi.fn(() => Promise.reject("The resource id 7 is invalid"));

    stopTauriListener(Promise.resolve(stop as unknown as () => void));

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });
});
