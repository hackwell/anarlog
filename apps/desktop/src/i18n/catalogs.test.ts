import { i18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { createI18n, getCatalogLocalesForDisplayLocale } from "./catalogs";

describe("i18n catalogs", () => {
  it("loads only English when it is the active locale", () => {
    expect(getCatalogLocalesForDisplayLocale("en")).toEqual(["en"]);
  });

  it("loads the active locale with English as its fallback", () => {
    expect(getCatalogLocalesForDisplayLocale("de")).toEqual(["en", "de"]);
  });

  it("caches and activates dynamically imported catalogs", async () => {
    const first = await createI18n("de");
    const second = await createI18n("de");

    expect(first).toBe(i18n);
    expect(first.locale).toBe("de");
    expect(second.locale).toBe("de");
    expect(first._("0L47q7")).not.toBe("0L47q7");
  });

  it("does not let a slower catalog overwrite a newer locale", async () => {
    const stale = createI18n("de");
    const latest = createI18n("en");

    await latest;
    expect(i18n.locale).toBe("en");

    await stale;
    expect(i18n.locale).toBe("en");
  });
});
