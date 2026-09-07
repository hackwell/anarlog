import { describe, expect, it } from "vitest";

import { emailDomain, isOwnDomain, isPublicMailProvider } from "./domains";

describe("emailDomain", () => {
  it("takes the domain, lower-cased", () => {
    expect(emailDomain("Anna.Weber@Kunde-Mueller.DE")).toBe("kunde-mueller.de");
  });

  it("trims surrounding whitespace", () => {
    expect(emailDomain("  anna@kunde.de  ")).toBe("kunde.de");
  });

  it("returns nothing usable for input that is not an address", () => {
    expect(emailDomain("")).toBe("");
    expect(emailDomain("anna")).toBe("");
    expect(emailDomain("anna@")).toBe("");
    expect(emailDomain("@kunde.de")).toBe("");
    expect(emailDomain("anna@@kunde.de")).toBe("");
  });
});

describe("isPublicMailProvider", () => {
  it("knows the common ones", () => {
    expect(isPublicMailProvider("gmail.com")).toBe(true);
    expect(isPublicMailProvider("GMX.de")).toBe(true);
    expect(isPublicMailProvider("web.de")).toBe(true);
    expect(isPublicMailProvider("outlook.com")).toBe(true);
  });

  it("treats a company domain as private", () => {
    expect(isPublicMailProvider("kunde-mueller.de")).toBe(false);
  });
});

describe("isOwnDomain", () => {
  it("matches case-insensitively", () => {
    expect(isOwnDomain("Flagbit.DE", ["flagbit.de"])).toBe(true);
  });

  it("does not match a different domain", () => {
    expect(isOwnDomain("kunde.de", ["flagbit.de"])).toBe(false);
  });

  it("is false when nothing is configured", () => {
    expect(isOwnDomain("flagbit.de", [])).toBe(false);
  });
});
