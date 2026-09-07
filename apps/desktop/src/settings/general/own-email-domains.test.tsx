import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  value: undefined as string | undefined,
  setOwnEmailDomains: vi.fn(),
}));

vi.mock("~/settings/queries", () => ({
  useStoredSettingValue: () => ({ value: mocks.value, hasValue: true }),
  useSetSettingValue: () => mocks.setOwnEmailDomains,
}));

import { OwnEmailDomainsRow } from "./own-email-domains";

describe("OwnEmailDomainsRow", () => {
  beforeEach(() => {
    mocks.value = undefined;
    mocks.setOwnEmailDomains.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("picks up a value seeded after mount when the field is untouched", () => {
    const { rerender } = render(<OwnEmailDomainsRow />);

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");

    mocks.value = '["flagbit.de"]';
    rerender(<OwnEmailDomainsRow />);

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "flagbit.de",
    );
  });

  it("does not overwrite a value seeded while the field is focused", () => {
    const { rerender } = render(<OwnEmailDomainsRow />);
    const input = screen.getByRole("textbox");

    fireEvent.focus(input);
    mocks.value = '["flagbit.de"]';
    rerender(<OwnEmailDomainsRow />);

    expect((input as HTMLInputElement).value).toBe("");
  });

  it("commits the edited draft on blur, not the value it resynced from", () => {
    render(<OwnEmailDomainsRow />);
    const input = screen.getByRole("textbox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "flagbit.de" } });
    fireEvent.blur(input);

    expect(mocks.setOwnEmailDomains).toHaveBeenCalledWith('["flagbit.de"]');
  });
});
