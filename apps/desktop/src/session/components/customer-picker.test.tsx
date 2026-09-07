import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPicker } from "./customer-picker";

import type { CustomerResolution } from "~/customers/resolve";

const mocks = vi.hoisted(() => ({
  organizationId: "",
  suggestion: null as CustomerResolution | null,
  assign: vi.fn(),
  dismissSuggestion: vi.fn(),
  organizations: [] as Array<{ id: string; name: string }>,
  createOrganization: vi.fn((_args: { name: string }) =>
    Promise.resolve("org-new"),
  ),
}));

vi.mock("~/customers/use-session-customer", () => ({
  useSessionCustomer: () => ({
    organizationId: mocks.organizationId,
    suggestion: mocks.suggestion,
    assign: mocks.assign,
    dismissSuggestion: mocks.dismissSuggestion,
  }),
}));

vi.mock("~/contacts/queries", () => ({
  useOrganizations: () => mocks.organizations,
  createOrganization: (args: { name: string }) =>
    mocks.createOrganization(args),
}));

describe("CustomerPicker", () => {
  beforeEach(() => {
    mocks.organizationId = "";
    mocks.suggestion = null;
    mocks.assign.mockClear();
    mocks.dismissSuggestion.mockClear();
    mocks.organizations = [
      { id: "org-mueller", name: "Müller" },
      { id: "org-schmidt", name: "Schmidt" },
    ];
    mocks.createOrganization.mockClear();
    mocks.createOrganization.mockResolvedValue("org-new");
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the assigned customer", () => {
    mocks.organizationId = "org-mueller";

    render(<CustomerPicker sessionId="s1" />);

    expect(screen.getByText("Müller")).toBeTruthy();
  });

  it("offers a suggestion and assigns it when confirmed", async () => {
    mocks.suggestion = {
      kind: "suggest",
      organizationId: "org-mueller",
      reason: "domain_match",
    };

    render(<CustomerPicker sessionId="s1" />);

    const suggestion = await screen.findByRole("button", { name: /Müller/ });
    // A suggestion is never applied on its own — only a confirm click writes
    // it. If a future change applied it on mount, this would still pass
    // without the assertion below.
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.createOrganization).not.toHaveBeenCalled();

    suggestion.click();

    expect(mocks.assign).toHaveBeenCalledWith("org-mueller");
  });

  it("stops offering after the suggestion is dismissed", async () => {
    mocks.suggestion = {
      kind: "suggest",
      organizationId: "org-mueller",
      reason: "domain_match",
    };

    render(<CustomerPicker sessionId="s1" />);

    const dismiss = await screen.findByRole("button", {
      name: /verwerfen|dismiss/i,
    });
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.createOrganization).not.toHaveBeenCalled();

    dismiss.click();

    expect(mocks.dismissSuggestion).toHaveBeenCalled();
  });

  it("offers to create a customer from a domain suggestion and assigns the new customer", async () => {
    mocks.suggestion = { kind: "suggest_create", domain: "kunde.de" };

    render(<CustomerPicker sessionId="s1" />);

    const suggestion = await screen.findByRole("button", { name: /kunde\.de/ });
    fireEvent.click(suggestion);

    expect(mocks.createOrganization).toHaveBeenCalledWith({
      name: "kunde.de",
    });
    await vi.waitFor(() => {
      expect(mocks.assign).toHaveBeenCalledWith("org-new");
    });
  });

  it("shows a quiet placeholder that opens the list when there is nothing to offer", () => {
    render(<CustomerPicker sessionId="s1" />);

    const trigger = screen.getByRole("combobox", { name: "Assign customer" });

    expect(trigger.textContent).toBe("Customer");

    fireEvent.click(trigger);

    expect(screen.getByRole("option", { name: "Müller" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Schmidt" })).not.toBeNull();
  });

  it("lets the user change the assigned customer by picking another from the list", () => {
    mocks.organizationId = "org-mueller";

    render(<CustomerPicker sessionId="s1" />);

    fireEvent.click(screen.getByRole("combobox", { name: "Assign customer" }));
    fireEvent.click(screen.getByRole("option", { name: "Schmidt" }));

    expect(mocks.assign).toHaveBeenCalledWith("org-schmidt");
  });

  it("creates a new customer from typed text that matches nothing", async () => {
    render(<CustomerPicker sessionId="s1" />);

    fireEvent.click(screen.getByRole("combobox", { name: "Assign customer" }));
    fireEvent.change(screen.getByPlaceholderText("Search or create customer"), {
      target: { value: "Agentur" },
    });
    fireEvent.click(
      await screen.findByRole("option", {
        name: 'Create "Agentur" as customer',
      }),
    );

    expect(mocks.createOrganization).toHaveBeenCalledWith({ name: "Agentur" });
    await vi.waitFor(() => {
      expect(mocks.assign).toHaveBeenCalledWith("org-new");
    });
  });

  it("assigns an existing customer instead of creating a duplicate from a domain suggestion", async () => {
    mocks.suggestion = { kind: "suggest_create", domain: "kunde.de" };
    mocks.organizations = [
      ...mocks.organizations,
      { id: "org-existing", name: "kunde.de" },
    ];

    render(<CustomerPicker sessionId="s1" />);

    const suggestion = await screen.findByRole("button", {
      name: /kunde\.de/,
    });
    fireEvent.click(suggestion);

    expect(mocks.assign).toHaveBeenCalledWith("org-existing");
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it("shows a distinct state when the assigned customer no longer exists", () => {
    mocks.organizationId = "org-deleted";

    render(<CustomerPicker sessionId="s1" />);

    const trigger = screen.getByRole("combobox", { name: "Assign customer" });

    expect(trigger.textContent).toBe("Customer no longer exists");
    expect(screen.queryByText("Customer")).toBeNull();
  });

  it("does not offer a suggestion that cannot be resolved to a customer name", () => {
    mocks.suggestion = {
      kind: "suggest",
      organizationId: "org-deleted",
      reason: "domain_match",
    };

    render(<CustomerPicker sessionId="s1" />);

    expect(
      screen.queryByRole("button", { name: /verwerfen|dismiss/i }),
    ).toBeNull();
    expect(screen.queryByText("org-deleted")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Assign customer" }),
    ).not.toBeNull();
  });
});
