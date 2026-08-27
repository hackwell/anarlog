import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/imports/screen", () => ({
  MeetingImportScreen: () => <div>Import list</div>,
}));

import { SettingsImports } from ".";

describe("SettingsImports", () => {
  afterEach(cleanup);

  it("renders the imports page title", () => {
    render(<SettingsImports />);

    expect(screen.getByText("Imports")).toBeTruthy();
    expect(screen.getByText("Import list")).toBeTruthy();
  });
});
