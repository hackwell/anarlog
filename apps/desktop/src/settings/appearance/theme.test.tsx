import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  applyThemePreference: vi.fn(),
  theme: "system",
}));

vi.mock("~/settings/queries", () => ({
  useSetSettingValue: () => mocks.setTheme,
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: () => mocks.theme,
}));

vi.mock("~/shared/theme/provider", () => ({
  applyThemePreference: mocks.applyThemePreference,
}));

import { ThemeSelector } from "./theme";

describe("ThemeSelector", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.theme = "system";
  });

  it("shows visual choices and applies the selected theme immediately", () => {
    render(<ThemeSelector />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen
        .getByRole("radio", { name: /System/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("Bright canvas")).toBeTruthy();
    expect(screen.getByText("Low-light canvas")).toBeTruthy();
    expect(screen.getByText("Match your device")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Dark/ }));

    expect(mocks.applyThemePreference).toHaveBeenCalledWith("dark");
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });
});
