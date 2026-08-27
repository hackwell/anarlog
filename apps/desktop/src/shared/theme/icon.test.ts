import { describe, expect, it } from "vitest";

import {
  hasDarkAppIconVariant,
  normalizeAppIconPreference,
  resolveAppIconName,
  resolveDockIconName,
} from "./icon";

describe("app icon preference", () => {
  it("falls back to the default icon for unknown values", () => {
    expect(normalizeAppIconPreference(undefined)).toBe("default");
    expect(normalizeAppIconPreference("unknown")).toBe("default");
    expect(normalizeAppIconPreference("dev")).toBe("dev");
    expect(normalizeAppIconPreference("staging")).toBe("staging");
    expect(normalizeAppIconPreference("journal")).toBe("journal");
    expect(normalizeAppIconPreference("notepad")).toBe("notepad");
    expect(normalizeAppIconPreference("stone")).toBe("stone");
    expect(normalizeAppIconPreference("typewriter-key")).toBe("typewriter-key");
    expect(normalizeAppIconPreference("walnut")).toBe("walnut");
  });

  it("resolves the default icon from the app channel", () => {
    expect(resolveAppIconName("default", "de.flagbit.sessionecho")).toBe(
      "stable",
    );
    expect(
      resolveAppIconName("default", "de.flagbit.sessionecho.staging"),
    ).toBe("staging");
    expect(resolveAppIconName("default", "de.flagbit.sessionecho.dev")).toBe(
      "dev",
    );
  });

  it("follows the system appearance for the system theme", () => {
    expect(
      resolveDockIconName(
        "anagram",
        "system",
        false,
        "de.flagbit.sessionecho.dev",
      ),
    ).toBe("anagram");
    expect(
      resolveDockIconName(
        "anagram",
        "system",
        true,
        "de.flagbit.sessionecho.dev",
      ),
    ).toBe("anagram-dark");
    expect(
      resolveDockIconName("staging", "system", true, "de.flagbit.sessionecho"),
    ).toBe("staging-dark");
  });

  it("overrides the system appearance with an explicit theme", () => {
    expect(
      resolveDockIconName(
        "anagram",
        "dark",
        false,
        "de.flagbit.sessionecho.dev",
      ),
    ).toBe("anagram-dark");
    expect(
      resolveDockIconName(
        "anagram",
        "light",
        true,
        "de.flagbit.sessionecho.dev",
      ),
    ).toBe("anagram");
    expect(
      resolveDockIconName("default", "dark", false, "de.flagbit.sessionecho"),
    ).toBe("stable-dark");
  });

  it("keeps theme-independent icons unchanged", () => {
    expect(
      resolveDockIconName("journal", "system", true, "de.flagbit.sessionecho"),
    ).toBe("journal");
    expect(
      resolveDockIconName("stone", "dark", false, "de.flagbit.sessionecho"),
    ).toBe("stone");
    expect(hasDarkAppIconVariant("anagram")).toBe(true);
    expect(hasDarkAppIconVariant("walnut")).toBe(false);
  });
});
