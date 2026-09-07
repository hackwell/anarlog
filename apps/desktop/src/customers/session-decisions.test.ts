import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storedOrganizationId: "",
  participants: [] as unknown[],
  updateSession: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/db", () => ({
  executeTransaction: vi.fn(),
  liveQueryClient: { execute: vi.fn() },
  useLiveQuery: () => ({ data: undefined }),
}));

vi.mock("~/session/queries", () => ({
  useSession: () => ({ organization_id: mocks.storedOrganizationId }),
  useUpdateSession: () => mocks.updateSession,
}));

vi.mock("~/session/queries/participants", () => ({
  useSessionParticipants: () => mocks.participants,
}));

vi.mock("~/contacts/queries", () => ({
  useHumans: () => [],
}));

vi.mock("./own-domains", () => ({
  useOwnDomains: () => ["flagbit.de"],
}));

import { resetSessionCustomerDecisions } from "./session-decisions";
import { useSessionCustomer } from "./use-session-customer";

const customerParticipant = {
  id: "participant-1",
  sessionId: "s1",
  humanId: "human-anna",
  source: "auto",
  name: "Anna",
  email: "anna@kunde.de",
  jobTitle: "",
  linkedinUsername: "",
  organizationId: "org-mueller",
  organizationName: "Müller",
};

describe("session customer decisions survive a remount", () => {
  beforeEach(() => {
    resetSessionCustomerDecisions();
    mocks.storedOrganizationId = "";
    mocks.participants = [];
    mocks.updateSession = vi.fn(() => Promise.resolve());
  });

  it("keeps a dismissed suggestion dismissed after the header unmounts", () => {
    mocks.participants = [
      { ...customerParticipant, organizationId: "", organizationName: "" },
    ];

    const first = renderHook(() => useSessionCustomer("s1"));
    expect(first.result.current.suggestion).toEqual({
      kind: "suggest_create",
      domain: "kunde.de",
    });

    first.result.current.dismissSuggestion();
    first.unmount();

    const second = renderHook(() => useSessionCustomer("s1"));
    expect(second.result.current.suggestion).toBeNull();
  });

  it("does not reassign a meeting the user explicitly cleared", () => {
    mocks.storedOrganizationId = "org-mueller";
    mocks.participants = [customerParticipant];

    const first = renderHook(() => useSessionCustomer("s1"));
    first.result.current.clear();
    expect(mocks.updateSession).toHaveBeenCalledWith({ organization_id: "" });

    mocks.storedOrganizationId = "";
    mocks.updateSession = vi.fn(() => Promise.resolve());
    first.unmount();

    const second = renderHook(() => useSessionCustomer("s1"));
    expect(second.result.current.organizationId).toBe("");
    expect(second.result.current.suggestion).toBeNull();
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });

  it("assigns again once the user picks a customer after clearing", () => {
    mocks.storedOrganizationId = "org-mueller";
    mocks.participants = [customerParticipant];

    const first = renderHook(() => useSessionCustomer("s1"));
    first.result.current.clear();
    first.result.current.assign("org-schmidt");
    first.unmount();

    mocks.storedOrganizationId = "";
    mocks.updateSession = vi.fn(() => Promise.resolve());

    const second = renderHook(() => useSessionCustomer("s1"));
    expect(mocks.updateSession).toHaveBeenCalledWith({
      organization_id: "org-mueller",
    });
    expect(second.result.current.suggestion).toBeNull();
  });

  it("scopes a decision to the session it was made for", () => {
    mocks.participants = [
      { ...customerParticipant, organizationId: "", organizationName: "" },
    ];

    const first = renderHook(() => useSessionCustomer("s1"));
    first.result.current.dismissSuggestion();
    first.unmount();

    const other = renderHook(() => useSessionCustomer("s2"));
    expect(other.result.current.suggestion).toEqual({
      kind: "suggest_create",
      domain: "kunde.de",
    });
  });
});
