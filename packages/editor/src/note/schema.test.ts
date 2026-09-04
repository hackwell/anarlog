import { DOMParser, DOMSerializer } from "prosemirror-model";
import { describe, expect, it } from "vitest";

import { schema } from "./schema";

describe("note schema paragraph anchors", () => {
  it("defaults recordedAtMs to null", () => {
    const paragraph = schema.node("paragraph");

    expect(paragraph.attrs.recordedAtMs).toBeNull();
  });

  it("round-trips recordedAtMs through the DOM", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 724_000 }, [
        schema.text("clarify pricing"),
      ]),
    ]);
    const container = document.createElement("div");
    container.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(doc.content),
    );

    expect(
      container.querySelector("p")?.getAttribute("data-recorded-at-ms"),
    ).toBe("724000");

    const parsed = DOMParser.fromSchema(schema).parse(container);

    expect(parsed.child(0).attrs.recordedAtMs).toBe(724_000);
  });

  it("omits the attribute from the DOM when there is no anchor", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("plain")]),
    ]);
    const container = document.createElement("div");
    container.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(doc.content),
    );

    expect(
      container.querySelector("p")?.hasAttribute("data-recorded-at-ms"),
    ).toBe(false);
  });

  it("ignores a non-numeric attribute in parsed HTML", () => {
    const container = document.createElement("div");
    container.innerHTML = '<p data-recorded-at-ms="later">typed</p>';

    const parsed = DOMParser.fromSchema(schema).parse(container);

    expect(parsed.child(0).attrs.recordedAtMs).toBeNull();
  });
});
