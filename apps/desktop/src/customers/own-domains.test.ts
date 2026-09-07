import { describe, expect, it } from "vitest";

import { parseOwnDomains, serializeOwnDomains } from "./own-domains";

describe("parseOwnDomains", () => {
  it("reads a stored list", () => {
    expect(parseOwnDomains('["flagbit.de","flagbit.com"]')).toEqual([
      "flagbit.de",
      "flagbit.com",
    ]);
  });

  it("normalizes and drops what is not usable", () => {
    expect(
      parseOwnDomains('["  Flagbit.DE ","","@x",42,"flagbit.de"]'),
    ).toEqual(["flagbit.de"]);
  });

  it("survives malformed storage", () => {
    expect(parseOwnDomains("not json")).toEqual([]);
    expect(parseOwnDomains('{"a":1}')).toEqual([]);
    expect(parseOwnDomains("")).toEqual([]);
  });
});

describe("serializeOwnDomains", () => {
  it("round-trips", () => {
    expect(parseOwnDomains(serializeOwnDomains(["Flagbit.DE"]))).toEqual([
      "flagbit.de",
    ]);
  });
});
