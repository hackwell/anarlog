import { describe, expect, test } from "vitest";

import { resolveDisplayLocale, SUPPORTED_DISPLAY_LOCALES } from "./locales";

describe("resolveDisplayLocale", () => {
  test("uses exact supported locales", () => {
    expect(resolveDisplayLocale("de")).toBe("de");
  });

  test("supports German and English", () => {
    expect(SUPPORTED_DISPLAY_LOCALES).toEqual(["de", "en"]);
  });

  test("uses base language for regional variants", () => {
    expect(resolveDisplayLocale("de-AT")).toBe("de");
  });

  test("falls back to English for unsupported languages", () => {
    expect(resolveDisplayLocale("eo")).toBe("en");
  });

  test("falls back to English for invalid values", () => {
    expect(resolveDisplayLocale("not a locale")).toBe("en");
  });
});

describe("SUPPORTED_DISPLAY_LOCALES", () => {
  test("matches lingui.config.ts", async () => {
    const { default: linguiConfig } = await import("../../lingui.config");

    expect([...SUPPORTED_DISPLAY_LOCALES].sort()).toEqual(
      [...linguiConfig.locales].sort(),
    );
  });
});
