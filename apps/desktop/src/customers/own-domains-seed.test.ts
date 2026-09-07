import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasValue: false,
  settingsReady: true,
  ownerEmail: "",
  setOwnEmailDomains: vi.fn(),
}));

vi.mock("~/settings/queries", () => ({
  useStoredSettingValue: () => ({ value: undefined, hasValue: mocks.hasValue }),
  useSettingsReady: () => mocks.settingsReady,
  useSetSettingValue: () => mocks.setOwnEmailDomains,
}));

vi.mock("~/shared/owner-user", () => ({
  useOwnerUserEmail: () => mocks.ownerEmail,
}));

import { ownDomainSeed, useSeedOwnEmailDomain } from "./own-domains";

describe("ownDomainSeed", () => {
  it("takes the domain of our own address", () => {
    expect(ownDomainSeed("Joerg@Flagbit.DE")).toEqual(["flagbit.de"]);
  });

  it("never claims a freemailer as our own", () => {
    expect(ownDomainSeed("joerg@gmail.com")).toBeNull();
    expect(ownDomainSeed("")).toBeNull();
    expect(ownDomainSeed("not-an-address")).toBeNull();
  });
});

describe("useSeedOwnEmailDomain", () => {
  beforeEach(() => {
    mocks.hasValue = false;
    mocks.settingsReady = true;
    mocks.ownerEmail = "";
    mocks.setOwnEmailDomains = vi.fn();
  });

  it("seeds once from the signed-in user's address", () => {
    mocks.ownerEmail = "joerg@flagbit.de";

    const { rerender } = renderHook(() => useSeedOwnEmailDomain());
    rerender();

    expect(mocks.setOwnEmailDomains).toHaveBeenCalledTimes(1);
    expect(mocks.setOwnEmailDomains).toHaveBeenCalledWith('["flagbit.de"]');
  });

  it("leaves a list the user deliberately emptied alone", () => {
    mocks.hasValue = true;
    mocks.ownerEmail = "joerg@flagbit.de";

    renderHook(() => useSeedOwnEmailDomain());

    expect(mocks.setOwnEmailDomains).not.toHaveBeenCalled();
  });

  it("waits for the settings to load before deciding it was never set", () => {
    mocks.settingsReady = false;
    mocks.ownerEmail = "joerg@flagbit.de";

    renderHook(() => useSeedOwnEmailDomain());

    expect(mocks.setOwnEmailDomains).not.toHaveBeenCalled();
  });

  it("stays quiet until an own address is known", () => {
    renderHook(() => useSeedOwnEmailDomain());

    expect(mocks.setOwnEmailDomains).not.toHaveBeenCalled();
  });
});
