import { describe, expect, it } from "vitest";

import { resolveSessionCustomer } from "./resolve";

const own = ["flagbit.de"];
const base = { knownContacts: [], ownDomains: own, recentOrganizationIds: [] };

const us = {
  email: "joerg@flagbit.de",
  organization_id: "",
  organization_name: "",
};

const from = (email: string, organizationId = "", name = "") => ({
  email,
  organization_id: organizationId,
  organization_name: name,
});

describe("resolveSessionCustomer", () => {
  it("assigns when a participant is a known contact of an organization", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("anna@kunde.de", "org-mueller", "Müller")],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("gives the meeting to the organization with more participants", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          us,
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("bea@kunde.de", "org-mueller", "Müller"),
          from("cem@agentur.de", "org-agentur", "Agentur"),
        ],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("breaks a tie with the most recently used customer", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          us,
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("cem@agentur.de", "org-agentur", "Agentur"),
        ],
        recentOrganizationIds: ["org-agentur", "org-mueller"],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-agentur",
      reason: "known_contact",
    });
  });

  it("assigns nothing on a tie no recent use can settle", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          us,
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("cem@agentur.de", "org-agentur", "Agentur"),
        ],
      }),
    ).toEqual({ kind: "none" });
  });

  it("only suggests when the domain matches a known contact's organization", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("neu@kunde.de")],
        knownContacts: [
          { email: "anna@kunde.de", organization_id: "org-mueller" },
        ],
      }),
    ).toEqual({
      kind: "suggest",
      organizationId: "org-mueller",
      reason: "domain_match",
    });
  });

  it("suggests creating an organization for an unknown external domain", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("neu@fremd.de")],
      }),
    ).toEqual({ kind: "suggest_create", domain: "fremd.de" });
  });

  it("says nothing for an internal meeting", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("maja@flagbit.de")],
      }),
    ).toEqual({ kind: "none" });
  });

  it("says nothing when there are no participants", () => {
    expect(resolveSessionCustomer({ ...base, participants: [] })).toEqual({
      kind: "none",
    });
  });

  it("never matches or proposes on a freemailer domain", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("anna@gmail.com")],
        knownContacts: [{ email: "bea@gmail.com", organization_id: "org-x" }],
      }),
    ).toEqual({ kind: "none" });
  });

  it("still counts a freemailer participant who is a known contact", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [us, from("anna@gmail.com", "org-mueller", "Müller")],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("prefers the counted evidence over a domain inference", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [
          from("anna@kunde.de", "org-mueller", "Müller"),
          from("bea@andere.de"),
        ],
        knownContacts: [
          { email: "cem@andere.de", organization_id: "org-andere" },
        ],
      }),
    ).toEqual({
      kind: "assign",
      organizationId: "org-mueller",
      reason: "known_contact",
    });
  });

  it("ignores our own people when they carry an organization", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [from("joerg@flagbit.de", "org-flagbit", "Flagbit")],
      }),
    ).toEqual({ kind: "none" });
  });

  it("falls back to the first external participant when nothing is configured", () => {
    expect(
      resolveSessionCustomer({
        ...base,
        participants: [from("anna@kunde.de")],
        ownDomains: [],
      }),
    ).toEqual({ kind: "suggest_create", domain: "kunde.de" });
  });
});
