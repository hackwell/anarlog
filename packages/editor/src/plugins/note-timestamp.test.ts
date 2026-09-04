import { EditorState, type Transaction } from "prosemirror-state";
import { type DecorationSet, EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { schema } from "../note/schema";
import {
  type NoteTimestampConfig,
  noteTimestampPlugin,
} from "./note-timestamp";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
  document.body.innerHTML = "";
});

function mount(
  config: NoteTimestampConfig,
  doc?: ReturnType<typeof schema.node>,
) {
  const state = EditorState.create({
    doc:
      doc ??
      schema.node("doc", null, [
        schema.node("paragraph", { recordedAtMs: 724_000 }, [
          schema.text("clarify pricing"),
        ]),
        schema.node("paragraph", null, [schema.text("no anchor")]),
      ]),
    plugins: [noteTimestampPlugin(() => config)],
  });
  const view = new EditorView(
    document.body.appendChild(document.createElement("div")),
    {
      state,
    },
  );
  views.push(view);
  return view;
}

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

  it("counter-example: keeps anchor when deleting from first of two pre-anchored paragraphs", () => {
    // Two paragraphs both pre-anchored to the same value
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("world"),
      ]),
    ]);
    const state = createState(recording, doc);

    // Delete all text from first paragraph while recording
    const para = state.doc.child(0);
    const endPos = 1 + para.content.size;
    const nextState = state.applyTransaction(state.tr.delete(1, endPos)).state;

    // The first paragraph only lost its text, so it is still the paragraph
    // that earned the anchor and keeps it.
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBe(60_000);
    // Second paragraph unchanged
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBe(60_000);
  });

  it("pre-anchored split clears the new empty half", () => {
    // One paragraph pre-anchored
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
    ]);
    const state = createState(recording, doc);

    // Split at the end while recording
    const para = state.doc.child(0);
    const nextState = state.applyTransaction(
      state.tr.split(para.nodeSize - 1),
    ).state;

    expect(nextState.doc.childCount).toBe(2);
    // First paragraph keeps its anchor
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBe(60_000);
    // The new empty half holds none of the original's content, so it never
    // earned the anchor it inherited.
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBeNull();
  });

  it("splits nested paragraph inside blockquote at the end, clearing new empty half", () => {
    // Paragraph nested inside blockquote, pre-anchored to 60_000
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [
        schema.node("paragraph", { recordedAtMs: 60_000 }, [
          schema.text("quoted text"),
        ]),
      ]),
    ]);
    const state = createState(recording, doc);

    // Find the paragraph inside the blockquote and split at its end
    const blockquote = state.doc.child(0);
    const para = blockquote.child(0);
    // Position: blockquote starts at 1, content at 2, para is 1 + para.content.size
    const splitPos = 2 + para.content.size;
    const nextState = state.applyTransaction(state.tr.split(splitPos)).state;

    const newBlockquote = nextState.doc.child(0);
    expect(newBlockquote.childCount).toBe(2);
    // First paragraph keeps its anchor
    expect(newBlockquote.child(0).attrs.recordedAtMs).toBe(60_000);
    // Second (new empty) paragraph gets cleared
    expect(newBlockquote.child(1).attrs.recordedAtMs).toBeNull();
  });

  it("splits at the start of an anchored paragraph's content, clearing the new empty first half", () => {
    // Enter with the caret before the first character: the empty half comes
    // out first and the content half second, the mirror image of an end-split.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
    ]);
    const state = createState(recording, doc);

    const nextState = state.applyTransaction(state.tr.split(1)).state;

    expect(nextState.doc.childCount).toBe(2);
    // First (new empty) paragraph never earned its anchor.
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBeNull();
    // Second paragraph still holds "hello" and keeps its anchor.
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBe(60_000);
  });

  it("splits at the start of an anchored paragraph preceded by a sibling", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("intro")]),
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
    ]);
    const state = createState(recording, doc);

    // The second paragraph starts right after the first one closes.
    const secondStart = state.doc.child(0).nodeSize;
    const nextState = state.applyTransaction(
      state.tr.split(secondStart + 1),
    ).state;

    expect(nextState.doc.childCount).toBe(3);
    // The new empty half never earned its anchor.
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBeNull();
    // The half still holding "hello" keeps its anchor.
    expect(nextState.doc.child(2).attrs.recordedAtMs).toBe(60_000);
  });

  it("splits at the start of an anchored paragraph nested in a blockquote", () => {
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [
        schema.node("paragraph", { recordedAtMs: 60_000 }, [
          schema.text("quoted text"),
        ]),
      ]),
    ]);
    const state = createState(recording, doc);

    // Blockquote starts at 0, content at 1, paragraph content starts at 2.
    const nextState = state.applyTransaction(state.tr.split(2)).state;

    const newBlockquote = nextState.doc.child(0);
    expect(newBlockquote.childCount).toBe(2);
    // The new empty half never earned its anchor.
    expect(newBlockquote.child(0).attrs.recordedAtMs).toBeNull();
    // The half still holding "quoted text" keeps its anchor.
    expect(newBlockquote.child(1).attrs.recordedAtMs).toBe(60_000);
  });

  it("keeps an emptied paragraph's anchor when the same transaction splits an unrelated paragraph sharing its value", () => {
    // Paragraph A (top-level) and paragraph C (nested in a blockquote) both
    // pre-anchored to the same value, as the plugin's own stamping routinely
    // produces. One transaction empties A and splits C at the end, both in
    // a single dispatch, so no per-node fact can be read off an aggregate.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
      schema.node("blockquote", null, [
        schema.node("paragraph", { recordedAtMs: 60_000 }, [
          schema.text("world"),
        ]),
      ]),
    ]);
    const state = createState(recording, doc);

    const nextState = state.applyTransaction(
      state.tr.delete(1, 6).split(9),
    ).state;

    // Paragraph A only lost its text; it earned its anchor and keeps it.
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBe(60_000);

    // Paragraph C's new empty half from the split never earned its anchor.
    const blockquote = nextState.doc.child(1);
    expect(blockquote.childCount).toBe(2);
    expect(blockquote.child(0).attrs.recordedAtMs).toBe(60_000);
    expect(blockquote.child(1).attrs.recordedAtMs).toBeNull();
  });

  it("stamps nested paragraph inside bullet list when text is typed", () => {
    // Paragraph nested inside listItem of a bulletList
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [schema.node("paragraph")]),
      ]),
    ]);
    let state = createState(recording, doc);

    // Type text in the nested paragraph (position 3 is inside the paragraph)
    state = state.applyTransaction(state.tr.insertText("list item", 3)).state;

    // The nested paragraph should be stamped
    const bulletList = state.doc.child(0);
    const listItem = bulletList.child(0);
    const para = listItem.child(0);
    expect(para.attrs.recordedAtMs).toBe(724_000);
  });

  it("clears the new empty half of an end-split with no recording running", () => {
    // Enter at the end of an anchored line a week after the meeting: the new
    // half is text the user has not written yet, so it must carry no time.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
    ]);
    const state = createState(
      { ...recording, getRecordedAtMs: () => null },
      doc,
    );

    const para = state.doc.child(0);
    const nextState = state.applyTransaction(
      state.tr.split(para.nodeSize - 1),
    ).state;

    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBe(60_000);
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBeNull();
  });

  it("clears the new empty half of a start-split with no recording running", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
    ]);
    const state = createState(
      { ...recording, getRecordedAtMs: () => null },
      doc,
    );

    const nextState = state.applyTransaction(state.tr.split(1)).state;

    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBeNull();
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBe(60_000);
  });

  it("normalizes nothing when a bulk rewrite splits with no recording running", () => {
    // The MAX_STAMPED_TEXTBLOCKS bail still covers the clearing pass: a
    // template application is not the user pressing Enter.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.text("hello"),
      ]),
    ]);
    const state = createState(
      { ...recording, getRecordedAtMs: () => null },
      doc,
    );

    const replacement = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, []),
      schema.node("paragraph", { recordedAtMs: 60_000 }, []),
      schema.node("paragraph", { recordedAtMs: 60_000 }, []),
      schema.node("paragraph", { recordedAtMs: 60_000 }, []),
    ]);
    const nextState = state.applyTransaction(
      state.tr.replaceWith(0, state.doc.content.size, replacement.content),
    ).state;

    const anchors: unknown[] = [];
    nextState.doc.forEach((node) => anchors.push(node.attrs.recordedAtMs));

    expect(anchors).toEqual([60_000, 60_000, 60_000, 60_000]);
  });

  it("splits right before a mention, keeping the anchor on the half that holds it", () => {
    // node.textContent ignores inline atoms, so a paragraph holding only a
    // mention used to read as empty and get misclassified by the split logic.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 60_000 }, [
        schema.node("mention-@", { id: "u1", type: "user", label: "alice" }),
      ]),
    ]);
    const state = createState(recording, doc);

    const nextState = state.applyTransaction(state.tr.split(1)).state;

    expect(nextState.doc.childCount).toBe(2);
    // The new empty half never earned its anchor.
    expect(nextState.doc.child(0).attrs.recordedAtMs).toBeNull();
    // The half still holding the mention keeps its anchor.
    expect(nextState.doc.child(1).attrs.recordedAtMs).toBe(60_000);
  });
});

describe("noteTimestampPlugin decorations", () => {
  it("renders one label for the anchored paragraph only", () => {
    const view = mount({
      getRecordedAtMs: () => null,
      formatLabel: (ms) => `label-${ms}`,
      onActivate: () => {},
    });

    const labels = view.dom.querySelectorAll("button.note-timestamp");

    expect(labels).toHaveLength(1);
    expect(labels[0]?.textContent).toBe("label-724000");
    expect(labels[0]?.getAttribute("data-recorded-at-ms")).toBe("724000");
    expect(view.dom.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders nothing when jumping is unavailable", () => {
    const view = mount({
      getRecordedAtMs: () => null,
      formatLabel: () => "12:04",
    });

    expect(view.dom.querySelectorAll("button.note-timestamp")).toHaveLength(0);
  });

  it("jumps to the stored position when the label is clicked", () => {
    const activated: number[] = [];
    const view = mount({
      getRecordedAtMs: () => null,
      formatLabel: () => "12:04",
      onActivate: (ms) => activated.push(ms),
      activateLabel: "Jump to this point",
    });

    const label = view.dom.querySelector("button.note-timestamp");
    label?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(activated).toEqual([724_000]);
    expect(label?.getAttribute("aria-label")).toBe("Jump to this point");
  });

  it("keeps the same widget across recomputations of an unchanged state", () => {
    // ProseMirror keeps a widget's DOM only when the old and new decoration
    // compare equal; without a stable spec key every label in the document is
    // rebuilt on every keystroke.
    const plugin = noteTimestampPlugin(() => ({
      getRecordedAtMs: () => null,
      formatLabel: (ms) => `label-${ms}`,
      onActivate: () => {},
    }));
    const state = EditorState.create({
      doc: schema.node("doc", null, [
        schema.node("paragraph", { recordedAtMs: 724_000 }, [
          schema.text("clarify pricing"),
        ]),
      ]),
      plugins: [plugin],
    });

    const decorate = () =>
      (
        plugin.props.decorations?.call(plugin, state) as DecorationSet | null
      )?.find() ?? [];
    const first = decorate();
    const second = decorate();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.type.eq(second[0]!.type)).toBe(true);
  });

  it("renders no label for an anchored paragraph that is empty", () => {
    // Normalization only reaches paragraphs a transaction touched, so a note
    // loaded from storage — or one whose bulk rewrite bailed on
    // MAX_STAMPED_TEXTBLOCKS — can still hold an anchored empty paragraph.
    // A label beside an empty line is wrong.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { recordedAtMs: 724_000 }, []),
    ]);
    const view = mount(
      {
        getRecordedAtMs: () => null,
        formatLabel: (ms) => `label-${ms}`,
        onActivate: () => {},
      },
      doc,
    );

    expect(view.dom.querySelectorAll("button.note-timestamp")).toHaveLength(0);
  });
});
