import { EditorState, type Transaction } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { schema } from "../note/schema";
import {
  type NoteTimestampConfig,
  noteTimestampPlugin,
} from "./note-timestamp";

function createState(
  config: NoteTimestampConfig | undefined,
  doc = schema.node("doc", null, [schema.node("paragraph")]),
) {
  return EditorState.create({
    doc,
    plugins: [noteTimestampPlugin(() => config)],
  });
}

function type(state: EditorState, pos: number, text: string) {
  return state.applyTransaction(state.tr.insertText(text, pos)).state;
}

const recording: NoteTimestampConfig = {
  getRecordedAtMs: () => 724_000,
  formatLabel: () => "12:04",
};

describe("noteTimestampPlugin stamping", () => {
  it("stamps a paragraph with the recording position on its first character", () => {
    const state = type(createState(recording), 1, "clarify pricing");

    expect(state.doc.child(0).attrs.recordedAtMs).toBe(724_000);
  });

  it("does not stamp while no recording runs", () => {
    const state = type(
      createState({ ...recording, getRecordedAtMs: () => null }),
      1,
      "typed before the call",
    );

    expect(state.doc.child(0).attrs.recordedAtMs).toBeNull();
  });

  it("does nothing without a config", () => {
    const state = type(createState(undefined), 1, "typed");

    expect(state.doc.child(0).attrs.recordedAtMs).toBeNull();
  });

  it("keeps the original position when an anchored paragraph is edited later", () => {
    let clock = 60_000;
    let state = createState({ ...recording, getRecordedAtMs: () => clock });
    state = type(state, 1, "first");
    clock = 900_000;
    state = type(state, 6, " and more");

    expect(state.doc.child(0).attrs.recordedAtMs).toBe(60_000);
  });

  it("leaves a new empty paragraph unstamped until it gets text", () => {
    let state = type(createState(recording), 1, "first line");
    // Enter at the end of the line: the new paragraph is still empty.
    state = state.applyTransaction(
      state.tr.split(state.doc.child(0).nodeSize - 1),
    ).state;

    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).attrs.recordedAtMs).toBeNull();
  });

  it("ignores a transaction that rewrites the whole document", () => {
    const state = createState(recording);
    const replacement = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, [schema.text("Agenda")]),
      schema.node("paragraph", null, [schema.text("one")]),
      schema.node("paragraph", null, [schema.text("two")]),
      schema.node("paragraph", null, [schema.text("three")]),
      schema.node("paragraph", null, [schema.text("four")]),
    ]);
    const transaction: Transaction = state.tr.replaceWith(
      0,
      state.doc.content.size,
      replacement.content,
    );

    const next = state.applyTransaction(transaction).state;

    const anchors: unknown[] = [];
    next.doc.forEach((node) => anchors.push(node.attrs.recordedAtMs));

    expect(anchors).toHaveLength(5);
    expect(anchors.every((value) => value == null)).toBe(true);
  });

  it("never stamps a heading", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }),
    ]);
    const state = type(createState(recording, doc), 1, "Agenda");

    expect(state.doc.child(0).attrs.recordedAtMs).toBeUndefined();
  });

  it("keeps recordedAtMs when all text is deleted while recording runs", () => {
    let state = type(createState(recording), 1, "text to delete");
    const stampedValue = state.doc.child(0).attrs.recordedAtMs;
    const para = state.doc.child(0);

    // Delete all text in the paragraph
    const endPos = 1 + para.content.size;
    state = state.applyTransaction(state.tr.delete(1, endPos)).state;

    // Paragraph should keep its recordedAtMs even though it's now empty
    expect(state.doc.child(0).attrs.recordedAtMs).toBe(stampedValue);
  });

  it("keeps recordedAtMs when all text is deleted while no recording runs", () => {
    let recordingActive = true;
    const toggleableRecording: () => NoteTimestampConfig | undefined = () =>
      recordingActive ? recording : undefined;

    const state = EditorState.create({
      doc: schema.node("doc", null, [schema.node("paragraph")]),
      plugins: [noteTimestampPlugin(toggleableRecording)],
    });

    let currentState = type(state, 1, "text to delete");
    const stampedValue = currentState.doc.child(0).attrs.recordedAtMs;
    const para = currentState.doc.child(0);

    // Turn off recording
    recordingActive = false;

    // Delete all text while no recording
    const endPos = 1 + para.content.size;
    currentState = currentState.applyTransaction(
      currentState.tr.delete(1, endPos),
    ).state;

    // Paragraph should keep its recordedAtMs
    expect(currentState.doc.child(0).attrs.recordedAtMs).toBe(stampedValue);
  });
});
