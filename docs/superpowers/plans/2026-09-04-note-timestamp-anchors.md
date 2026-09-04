# Note Timestamp Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note paragraph typed during a recording remembers its position on the recording's timeline, shows that time on hover, jumps the audio there on click, and carries the time into the summary prompt.

**Architecture:** A `recordedAtMs` attribute on `paragraph` in the note schema only, stamped by an `appendTransaction` plugin while a recording runs, rendered by a widget decoration from the same plugin, fed by a desktop hook that owns the clock and the seek call. The summary path annotates the note markdown from the stored JSON.

**Tech Stack:** ProseMirror (`prosemirror-model`, `prosemirror-state`, `prosemirror-view`), React 19, Zustand (listener store), TanStack Query, vitest + `@testing-library/react`, lingui for German copy.

**Spec:** `docs/superpowers/specs/2026-09-04-note-timestamp-anchors-design.md`

## Global Constraints

- `recordedAtMs` is a position on the session audio timeline in milliseconds: `Date.now() - earliestTranscriptStartedAtMs`. Never a wall clock, never seconds.
- Only `packages/editor/src/note/schema.ts` gains the attribute. `packages/editor/src/markdown/schema.ts` must stay unchanged.
- An existing `recordedAtMs` is never overwritten and never cleared.
- Headings, task items, code blocks and every other node type stay without anchors.
- Comments explain "why", not "what" (`AGENTS.md`). Do not comment obvious code.
- `cn` from `@anlg/utils` for conditional classNames, arrays only. Not needed in this plan's files, but do not hand-roll a substitute.
- Formatting runs through `pnpm exec dprint fmt`; line length 120; 2-space indent for TS.
- German is for communication only. Code, comments and commit messages are English. Conventional Commits (`feat(...)`, `fix(...)`).
- User-visible strings in `apps/desktop` go through lingui (`t` / `<Trans>`), never raw literals.

---

### Task 1: `recordedAtMs` attribute on the note paragraph

**Files:**

- Modify: `packages/editor/src/note/schema.ts:50-57`
- Test: `packages/editor/src/note/schema.test.ts` (create)
- Fixture churn (update, do not rewrite): every test that compares a document built with the note schema against a literal. Known candidates: `packages/editor/src/markdown.test.ts`, `packages/editor/src/note/index.test.ts`, `packages/editor/src/note/keymap.test.ts`, `packages/editor/src/note/title-layout.test.ts`, `packages/editor/src/note/trailing-empty-line-click.test.ts`, `packages/editor/src/plugins/image-trailing-paragraph.test.ts`, `packages/editor/src/plugins/autolink.test.ts`, plus desktop tests that mount the real editor (`apps/desktop/src/session/components/note-input/raw.test.tsx`, `apps/desktop/src/editor-bridge/task-storage.test.ts`).

**Interfaces:**

- Consumes: nothing.
- Produces: `schema.nodes.paragraph` with `attrs.recordedAtMs: number | null`, serialized as `data-recorded-at-ms` in the DOM.

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/note/schema.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/note/schema.test.ts`
Expected: FAIL — `paragraph.attrs.recordedAtMs` is `undefined`, the serialized `<p>` has no attribute.

- [ ] **Step 3: Add the attribute to the note schema**

In `packages/editor/src/note/schema.ts`, replace the `paragraph` spec:

```ts
paragraph: {
  content: "inline*",
  group: "block",
  attrs: { recordedAtMs: { default: null } },
  parseDOM: [
    {
      tag: "p",
      getAttrs(dom) {
        const raw = (dom as HTMLElement).getAttribute("data-recorded-at-ms");
        const recordedAtMs = raw === null ? Number.NaN : Number(raw);
        return {
          recordedAtMs:
            Number.isFinite(recordedAtMs) && recordedAtMs >= 0
              ? recordedAtMs
              : null,
        };
      },
    },
  ],
  toDOM(node) {
    const { recordedAtMs } = node.attrs;
    return typeof recordedAtMs === "number"
      ? ["p", { "data-recorded-at-ms": String(recordedAtMs) }, 0]
      : ["p", 0];
  },
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/note/schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Repair the fixtures the new attribute changed**

`Node.toJSON()` now emits `"attrs":{"recordedAtMs":null}` for every paragraph in the note schema. Run both suites and add the attribute to every literal that a diff shows failing. Do not switch assertions from `toEqual` to `toMatchObject` to dodge the diff — the fixtures must show what is stored.

Run: `pnpm -F @anlg/editor test`
Run: `pnpm -F desktop test`
Expected: both green after the fixtures are updated.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/note/schema.ts packages/editor/src/note/schema.test.ts
git add -u packages/editor/src apps/desktop/src
git commit -m "$(cat <<'MSG'
feat(editor): remember where in a recording a note paragraph was written

Claude-Session: https://claude.ai/code/session_017t4jWZR8yGdxeBFbPcztRp
MSG
)"
```

---

### Task 2: Stamp anchors while a recording runs

**Files:**

- Create: `packages/editor/src/plugins/note-timestamp.ts`
- Test: `packages/editor/src/plugins/note-timestamp.test.ts` (create)

**Interfaces:**

- Consumes: `schema.nodes.paragraph.attrs.recordedAtMs` (Task 1); `getChangedTextblockRanges(doc, transactions)` from `./changed-ranges`.
- Produces:
  - `export type NoteTimestampConfig = { getRecordedAtMs: () => number | null; formatLabel: (recordedAtMs: number) => string; onActivate?: (recordedAtMs: number) => void; activateLabel?: string }`
  - `export function noteTimestampPlugin(getConfig: () => NoteTimestampConfig | undefined): Plugin`
  - `export const noteTimestampPluginKey: PluginKey` — the plugin keeps no state of its own; decorations are derived from the document in Task 3, so the key is an identity only
  - `export const MAX_STAMPED_TEXTBLOCKS = 3`

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/plugins/note-timestamp.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/plugins/note-timestamp.test.ts`
Expected: FAIL — cannot resolve `./note-timestamp`.

- [ ] **Step 3: Write the plugin**

Create `packages/editor/src/plugins/note-timestamp.ts`:

```ts
import { Plugin, PluginKey } from "prosemirror-state";

import { getChangedTextblockRanges } from "./changed-ranges";

export type NoteTimestampConfig = {
  getRecordedAtMs: () => number | null;
  formatLabel: (recordedAtMs: number) => string;
  onActivate?: (recordedAtMs: number) => void;
  activateLabel?: string;
};

// Applying a template, inserting a pre-meeting brief or replacing the document
// rewrites many blocks in one transaction. None of that was typed now, so a
// broad transaction gets no anchors at all.
export const MAX_STAMPED_TEXTBLOCKS = 3;

export const noteTimestampPluginKey = new PluginKey("noteTimestamp");

export function noteTimestampPlugin(
  getConfig: () => NoteTimestampConfig | undefined,
) {
  return new Plugin({
    key: noteTimestampPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const recordedAtMs = getConfig()?.getRecordedAtMs() ?? null;
      if (recordedAtMs === null || !Number.isFinite(recordedAtMs)) {
        return null;
      }

      const ranges = getChangedTextblockRanges(newState.doc, transactions);
      if (ranges.length === 0 || ranges.length > MAX_STAMPED_TEXTBLOCKS) {
        return null;
      }

      const positions: number[] = [];
      for (const range of ranges) {
        newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (node.type !== newState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs === null && node.content.size > 0) {
            positions.push(pos);
          }
          return false;
        });
      }

      if (positions.length === 0) {
        return null;
      }

      let tr = newState.tr;
      for (const pos of positions) {
        const node = tr.doc.nodeAt(pos);
        if (!node) {
          continue;
        }
        tr = tr.setNodeMarkup(
          pos,
          undefined,
          { ...node.attrs, recordedAtMs },
          node.marks,
        );
      }

      return tr;
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/plugins/note-timestamp.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/plugins/note-timestamp.ts packages/editor/src/plugins/note-timestamp.test.ts
git commit -m "$(cat <<'MSG'
feat(editor): stamp note paragraphs with the recording position while listening

Claude-Session: https://claude.ai/code/session_017t4jWZR8yGdxeBFbPcztRp
MSG
)"
```

---

### Task 3: Show the anchor and jump to it

**Files:**

- Modify: `packages/editor/src/plugins/note-timestamp.ts`
- Modify: `packages/editor/src/plugins/note-timestamp.test.ts`
- Create: `packages/editor/src/styles/prosemirror/nodes/note-timestamp.css`
- Modify: `packages/editor/src/styles/prosemirror.css:8` (add the import next to `hashtag.css`)

**Interfaces:**

- Consumes: `NoteTimestampConfig`, `noteTimestampPlugin` (Task 2).
- Produces: the plugin's `props.decorations`, rendering `button.note-timestamp` with `data-recorded-at-ms` for every anchored paragraph, and calling `config.onActivate(recordedAtMs)` on click.

- [ ] **Step 1: Write the failing test**

Append to `packages/editor/src/plugins/note-timestamp.test.ts`. Mount a real
`EditorView`, the way `plugins/placeholder.test.ts` does, so the assertions run
against the DOM the user sees:

```ts
import { EditorView } from "prosemirror-view";
import { afterEach } from "vitest";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views.length = 0;
  document.body.innerHTML = "";
});

function mount(config: NoteTimestampConfig) {
  const state = EditorState.create({
    doc: schema.node("doc", null, [
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/plugins/note-timestamp.test.ts`
Expected: FAIL — no `button.note-timestamp` is rendered.

- [ ] **Step 3: Add decorations to the plugin**

In `packages/editor/src/plugins/note-timestamp.ts`, extend the imports and add the `props` block to the returned `Plugin`:

```ts
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
```

```ts
    props: {
      decorations(state) {
        const config = getConfig();
        if (!config?.onActivate) {
          return null;
        }

        const { onActivate, formatLabel, activateLabel } = config;
        const decorations: Decoration[] = [];

        state.doc.forEach((node, offset) => {
          const recordedAtMs = node.attrs.recordedAtMs;
          if (
            node.type !== state.schema.nodes.paragraph ||
            typeof recordedAtMs !== "number"
          ) {
            return;
          }

          decorations.push(
            Decoration.widget(
              offset + 1,
              () => createLabel(recordedAtMs, formatLabel, onActivate, activateLabel),
              // The label sits in the margin, not in the text: it must never
              // take the caret or move it when the user walks the line.
              { side: -1, ignoreSelection: true, marks: [] },
            ),
          );
        });

        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : null;
      },
    },
```

Add the factory below `noteTimestampPlugin`:

```ts
function createLabel(
  recordedAtMs: number,
  formatLabel: (recordedAtMs: number) => string,
  onActivate: (recordedAtMs: number) => void,
  activateLabel: string | undefined,
) {
  const button = document.createElement("button");
  button.className = "note-timestamp";
  button.type = "button";
  button.contentEditable = "false";
  button.tabIndex = -1;
  button.dataset.recordedAtMs = String(recordedAtMs);
  button.textContent = formatLabel(recordedAtMs);
  if (activateLabel) {
    button.setAttribute("aria-label", activateLabel);
    button.title = activateLabel;
  }
  // mousedown, so the editor never moves the caret into the margin first.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate(recordedAtMs);
  });
  return button;
}
```

Note: `state.doc.forEach` only walks top-level blocks, so a paragraph inside a
list item or table cell gets no label in this task. That matches the stamping
guard being about typing, not nesting, and keeps the margin free of labels that
would collide with list markers.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/plugins/note-timestamp.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Style the label**

Create `packages/editor/src/styles/prosemirror/nodes/note-timestamp.css`:

```css
.prosemirror-editor {
  p:has(> .note-timestamp) {
    position: relative;
  }

  .note-timestamp {
    position: absolute;
    right: calc(100% + 0.75rem);
    top: 0.15em;
    padding: 0;
    border: none;
    background: none;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    color: var(--color-muted-foreground, #6b7280);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease-out;
    user-select: none;
  }

  p:hover > .note-timestamp,
  p:focus-within > .note-timestamp {
    opacity: 1;
  }

  .note-timestamp:hover {
    color: var(--color-sidebar-selected, #589eec);
    text-decoration: underline;
  }
}
```

Add the import to `packages/editor/src/styles/prosemirror.css` after the `hashtag.css` line:

```css
@import "./prosemirror/nodes/note-timestamp.css";
```

- [ ] **Step 6: Verify formatting and types**

Run: `pnpm exec dprint fmt`
Run: `pnpm -F @anlg/editor typecheck`
Expected: no diagnostics.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/plugins/note-timestamp.ts packages/editor/src/plugins/note-timestamp.test.ts packages/editor/src/styles
git commit -m "$(cat <<'MSG'
feat(editor): show a note paragraph's recording position and jump to it

Claude-Session: https://claude.ai/code/session_017t4jWZR8yGdxeBFbPcztRp
MSG
)"
```

---

### Task 4: Expose the plugin through `NoteEditor`

**Files:**

- Modify: `packages/editor/src/plugins/index.ts` (add the export next to `hashtagPlugin`)
- Modify: `packages/editor/src/note/index.tsx:100-105` (the `export type` block)
- Modify: `packages/editor/src/note/index.tsx:162-185` (props), `:584` (destructure), `:682-683` (ref), `:725-770` (plugin list and deps)
- Test: `packages/editor/src/note/note-timestamp-integration.test.tsx` (create)

**Interfaces:**

- Consumes: `noteTimestampPlugin`, `NoteTimestampConfig` (Tasks 2 and 3).
- Produces: `NoteEditorProps.timestampConfig?: NoteTimestampConfig`, re-exported as a type from `@anlg/editor/note` (the package has no root entry point, only the subpaths listed in its `package.json` `exports`).

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/note/note-timestamp-integration.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NoteEditor } from "./index";

const anchoredContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { recordedAtMs: 724_000 },
      content: [{ type: "text", text: "clarify pricing" }],
    },
  ],
};

describe("NoteEditor timestampConfig", () => {
  it("renders no label without a config", () => {
    render(<NoteEditor initialContent={anchoredContent} />);

    expect(screen.queryByRole("button", { name: "Jump" })).toBeNull();
  });

  it("renders the label and jumps on click", async () => {
    const onActivate = vi.fn();
    render(
      <NoteEditor
        initialContent={anchoredContent}
        timestampConfig={{
          getRecordedAtMs: () => null,
          formatLabel: () => "12:04",
          onActivate,
          activateLabel: "Jump",
        }}
      />,
    );

    const label = await screen.findByRole("button", { name: "Jump" });
    expect(label.textContent).toBe("12:04");

    label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onActivate).toHaveBeenCalledWith(724_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/note/note-timestamp-integration.test.tsx`
Expected: FAIL — `timestampConfig` is not a known prop, no label is rendered.

- [ ] **Step 3: Wire the prop through**

`packages/editor/src/plugins/index.ts`, next to the hashtag export:

```ts
export {
  type NoteTimestampConfig,
  noteTimestampPlugin,
} from "./note-timestamp";
```

`packages/editor/src/note/index.tsx`:

```ts
// with the other plugin imports
  noteTimestampPlugin,
  type NoteTimestampConfig,
```

```ts
// in NoteEditorProps
  timestampConfig?: NoteTimestampConfig;
```

```ts
// in the destructured props, next to fileHandlerConfig
      timestampConfig,
```

```ts
// next to onUpdateRef
const timestampConfigRef = useRef(timestampConfig);
timestampConfigRef.current = timestampConfig;
// Only presence enters the plugin deps: rebuilding the plugin list would
// create a fresh history() and drop the undo stack.
const hasTimestampConfig = Boolean(timestampConfig);
```

```ts
// in the plugin list, after imageTrailingParagraphPlugin()
        ...(hasTimestampConfig
          ? [noteTimestampPlugin(() => timestampConfigRef.current)]
          : []),
```

```ts
// in the plugin useMemo deps, next to fileHandlerConfig
        hasTimestampConfig,
```

Add the type to the existing re-export block at `packages/editor/src/note/index.tsx:100`,
next to `FileHandlerConfig`, so the desktop app can import it from
`@anlg/editor/note`:

```ts
export type {
  MentionConfig,
  FileHandlerConfig,
  NoteTimestampConfig,
  PlaceholderFunction,
  PersistentPlaceholderFunction,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @anlg/editor exec vitest run --environment jsdom src/note/note-timestamp-integration.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the package suite and typecheck**

Run: `pnpm -F @anlg/editor test`
Run: `pnpm -F @anlg/editor typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src
git commit -m "$(cat <<'MSG'
feat(editor): accept a timestamp config on the note editor

Claude-Session: https://claude.ai/code/session_017t4jWZR8yGdxeBFbPcztRp
MSG
)"
```

---

### Task 5: Supply the clock, the label and the seek from the desktop app

**Files:**

- Create: `apps/desktop/src/session/components/note-input/use-note-timestamp-config.ts`
- Create: `apps/desktop/src/session/components/note-input/use-note-timestamp-config.test.ts`
- Modify: `apps/desktop/src/session/components/note-input/raw.tsx` (call the hook next to `useNoteFileHandlerConfig(sessionId)` at `:117`, pass `timestampConfig` to the rendered `NoteEditor`)

**Interfaces:**

- Consumes: `type NoteTimestampConfig` from `@anlg/editor/note` and `NoteEditorProps.timestampConfig` (Task 4); `useSessionTranscriptMetadata` from `~/stt/queries`; `useListener` from `~/stt/contexts`; `useAudioPlayer` from `~/audio-player`.
- Produces:
  - `export function formatRecordingPosition(recordedAtMs: number): string`
  - `export function earliestTranscriptStartedAtMs(transcripts: { startedAt: number }[]): number | null`
  - `export function useNoteTimestampConfig(sessionId: string): NoteTimestampConfig`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/session/components/note-input/use-note-timestamp-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  earliestTranscriptStartedAtMs,
  formatRecordingPosition,
} from "./use-note-timestamp-config";

describe("formatRecordingPosition", () => {
  it("formats minutes and seconds", () => {
    expect(formatRecordingPosition(0)).toBe("0:00");
    expect(formatRecordingPosition(9_000)).toBe("0:09");
    expect(formatRecordingPosition(724_000)).toBe("12:04");
  });

  it("adds hours only past the hour", () => {
    expect(formatRecordingPosition(3_599_000)).toBe("59:59");
    expect(formatRecordingPosition(3_600_000)).toBe("1:00:00");
    expect(formatRecordingPosition(3_725_000)).toBe("1:02:05");
  });
});

describe("earliestTranscriptStartedAtMs", () => {
  it("returns the earliest usable start", () => {
    expect(
      earliestTranscriptStartedAtMs([{ startedAt: 500 }, { startedAt: 100 }]),
    ).toBe(100);
  });

  it("ignores unusable starts", () => {
    expect(earliestTranscriptStartedAtMs([{ startedAt: 0 }])).toBeNull();
    expect(earliestTranscriptStartedAtMs([])).toBeNull();
    expect(
      earliestTranscriptStartedAtMs([
        { startedAt: Number.NaN },
        { startedAt: 400 },
      ]),
    ).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/session/components/note-input/use-note-timestamp-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

Create `apps/desktop/src/session/components/note-input/use-note-timestamp-config.ts`:

```ts
import { t } from "@lingui/core/macro";
import { useCallback, useMemo } from "react";

import type { NoteTimestampConfig } from "@anlg/editor/note";

import { useAudioPlayer } from "~/audio-player";
import { useListener } from "~/stt/contexts";
import { useSessionTranscriptMetadata } from "~/stt/queries";

export function formatRecordingPosition(recordedAtMs: number): string {
  const total = Math.max(0, Math.round(recordedAtMs / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function earliestTranscriptStartedAtMs(
  transcripts: { startedAt: number }[],
): number | null {
  const starts = transcripts
    .map((transcript) => transcript.startedAt)
    .filter((startedAt) => Number.isFinite(startedAt) && startedAt > 0);

  return starts.length > 0 ? Math.min(...starts) : null;
}

export function useNoteTimestampConfig(sessionId: string): NoteTimestampConfig {
  const transcripts = useSessionTranscriptMetadata(sessionId);
  const sessionMode = useListener((state) => state.getSessionMode(sessionId));
  const { seek, start, audioExists } = useAudioPlayer();
  // The recording's zero point is the earliest transcript start, the same base
  // the transcript uses when a word click seeks the audio.
  const baseMs = useMemo(
    () => earliestTranscriptStartedAtMs(transcripts),
    [transcripts],
  );
  const isRecording = sessionMode === "running_active";

  const getRecordedAtMs = useCallback(
    () => (isRecording && baseMs !== null ? Date.now() - baseMs : null),
    [isRecording, baseMs],
  );

  const onActivate = useCallback(
    (recordedAtMs: number) => {
      seek(recordedAtMs / 1000);
      start();
    },
    [seek, start],
  );

  return useMemo(
    () => ({
      getRecordedAtMs,
      formatLabel: formatRecordingPosition,
      ...(audioExists
        ? {
            onActivate,
            activateLabel: t`Jump to this point in the recording`,
          }
        : {}),
    }),
    [getRecordedAtMs, onActivate, audioExists],
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/session/components/note-input/use-note-timestamp-config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Pass the config to the editor**

In `apps/desktop/src/session/components/note-input/raw.tsx`, next to the file
handler config:

```ts
const timestampConfig = useNoteTimestampConfig(sessionId);
```

and on the rendered `NoteEditor`:

```tsx
timestampConfig = { timestampConfig };
```

Add the import with the other local hook imports.

- [ ] **Step 6: Keep `raw.test.tsx` honest about the new wiring**

`apps/desktop/src/session/components/note-input/raw.test.tsx` mocks
`~/stt/contexts` but not `~/stt/queries`, so the new live query would run
unmocked. Add the mock next to the existing one:

```ts
vi.mock("~/stt/queries", () => ({
  useSessionTranscriptMetadata: () => [],
}));
```

Then assert the config reaches the editor, using the props the existing
`NoteEditor` mock already collects in `hoisted.noteEditorProps`:

```ts
it("hands the note editor a timestamp config", () => {
  renderRawEditor();

  const config = hoisted.noteEditorProps.at(-1)?.timestampConfig as
    | { getRecordedAtMs: () => number | null }
    | undefined;

  expect(typeof config?.getRecordedAtMs).toBe("function");
  // No recording and no audio in this test: nothing to anchor, nothing to jump to.
  expect(config?.getRecordedAtMs()).toBeNull();
});
```

Use the file's own render helper instead of `renderRawEditor()` if it is named
differently.

Run: `pnpm -F desktop exec vitest run src/session/components/note-input/raw.test.tsx`
Expected: PASS.

- [ ] **Step 7: German copy**

Run: `pnpm -F desktop exec lingui extract --clean --workers 1`
Fill the German `msgstr` for `Jump to this point in the recording` in
`apps/desktop/src/i18n/locales/de/messages.po`:

```
msgstr "Zu dieser Stelle in der Aufnahme springen"
```

Run: `pnpm -F desktop exec lingui compile --strict --workers 1`
Run: `pnpm -F desktop exec lingui extract --clean --workers 1`
Expected: the second extract produces no further diff. Commit the generated
`apps/desktop/src/i18n/locales` changes as they are.

- [ ] **Step 8: Run the desktop checks**

Run: `pnpm -F desktop typecheck`
Run: `pnpm -F desktop test`
Run: `pnpm exec oxlint --quiet --format=github apps/desktop/src/`
Run: `pnpm -F desktop i18n:check`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src
git commit -m "$(cat <<'MSG'
feat(session): jump from a note line to that point in the recording

Claude-Session: https://claude.ai/code/session_017t4jWZR8yGdxeBFbPcztRp
MSG
)"
```

---

### Task 6: Carry the positions into the summary prompt

**Files:**

- Create: `apps/desktop/src/store/zustand/ai-task/task-configs/note-timestamp-markdown.ts`
- Create: `apps/desktop/src/store/zustand/ai-task/task-configs/note-timestamp-markdown.test.ts`
- Modify: `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-transform.ts:342-365` (`getSessionContext`)

**Interfaces:**

- Consumes: `parseJsonContent`, `json2md`, `type JSONContent` from `@anlg/editor/markdown`; the `recordedAtMs` attribute (Task 1); `formatRecordingPosition` from `~/session/components/note-input/use-note-timestamp-config` (Task 5).
- Produces: `export function annotateNoteMarkdown(snapshot: { rawContent: string; rawContentFormat: string; rawMarkdown: string }): string`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/store/zustand/ai-task/task-configs/note-timestamp-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { annotateNoteMarkdown } from "./note-timestamp-markdown";

function jsonSnapshot(content: unknown[]) {
  return {
    rawContent: JSON.stringify({ type: "doc", content }),
    rawContentFormat: "json",
    rawMarkdown: "ignored",
  };
}

describe("annotateNoteMarkdown", () => {
  it("prefixes an anchored paragraph with its position", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
      ]),
    );

    expect(markdown.trim()).toBe("[12:04] clarify pricing");
  });

  it("leaves paragraphs without an anchor alone", () => {
    const markdown = annotateNoteMarkdown(
      jsonSnapshot([
        {
          type: "paragraph",
          attrs: { recordedAtMs: 724_000 },
          content: [{ type: "text", text: "clarify pricing" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "prepared" }] },
      ]),
    );

    expect(markdown.trim()).toBe("[12:04] clarify pricing\n\nprepared");
  });

  it("returns the stored markdown for a markdown note", () => {
    expect(
      annotateNoteMarkdown({
        rawContent: "- typed",
        rawContentFormat: "markdown",
        rawMarkdown: "- typed",
      }),
    ).toBe("- typed");
  });

  it("returns the stored markdown when the note has no anchors at all", () => {
    const snapshot = jsonSnapshot([
      { type: "paragraph", content: [{ type: "text", text: "prepared" }] },
    ]);

    expect(annotateNoteMarkdown(snapshot)).toBe(snapshot.rawMarkdown);
  });

  it("falls back to the stored markdown when the content will not parse", () => {
    expect(
      annotateNoteMarkdown({
        rawContent: "{ not json",
        rawContentFormat: "json",
        rawMarkdown: "stored",
      }),
    ).toBe("stored");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F desktop exec vitest run src/store/zustand/ai-task/task-configs/note-timestamp-markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the annotator**

Create `apps/desktop/src/store/zustand/ai-task/task-configs/note-timestamp-markdown.ts`:

```ts
import {
  json2md,
  parseJsonContent,
  type JSONContent,
} from "@anlg/editor/markdown";

import { formatRecordingPosition } from "~/session/components/note-input/use-note-timestamp-config";

// The markdown schema has no anchor attribute, so json2md drops the positions.
// The label is prefixed to each already-serialized block rather than injected
// into a text node, because the markdown serializer escapes square brackets.
export function annotateNoteMarkdown(snapshot: {
  rawContent: string;
  rawContentFormat: string;
  rawMarkdown: string;
}): string {
  if (snapshot.rawContentFormat !== "json") {
    return snapshot.rawMarkdown;
  }

  const document = parseJsonContent(snapshot.rawContent);
  const content = document.content;
  if (!content || !content.some(hasAnchor)) {
    return snapshot.rawMarkdown;
  }

  try {
    return json2md({
      ...document,
      content: content.map((node) =>
        hasAnchor(node) ? withPositionPrefix(node) : node,
      ),
    });
  } catch (error) {
    console.warn("[enhance] failed to annotate note positions", error);
    return snapshot.rawMarkdown;
  }
}

function hasAnchor(node: JSONContent): boolean {
  return (
    node.type === "paragraph" &&
    typeof node.attrs?.recordedAtMs === "number" &&
    Boolean(node.content?.length)
  );
}

function withPositionPrefix(node: JSONContent): JSONContent {
  const label = `[${formatRecordingPosition(node.attrs?.recordedAtMs as number)}] `;
  const [first, ...rest] = node.content ?? [];

  return {
    ...node,
    attrs: undefined,
    content:
      first?.type === "text"
        ? [{ ...first, text: `${label}${first.text ?? ""}` }, ...rest]
        : [{ type: "text", text: label }, ...(node.content ?? [])],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F desktop exec vitest run src/store/zustand/ai-task/task-configs/note-timestamp-markdown.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Use it in the enhance transform**

In `apps/desktop/src/store/zustand/ai-task/task-configs/enhance-transform.ts`,
inside `getSessionContext`, replace both uses of `snapshot.rawMarkdown` with the
annotated note:

```ts
  const memoMarkdown = annotateNoteMarkdown(snapshot);

  return {
    preMeetingMemo: transcriptsMeta[0]?.memoMd ?? "",
    postMeetingMemo: meetingChatContext
      ? [memoMarkdown, meetingChatContext]
          .filter((value) => value.trim())
          .join("\n\n")
      : memoMarkdown,
```

Add the import next to the other local imports.

- [ ] **Step 6: Run the affected tests and the desktop checks**

Run: `pnpm -F desktop exec vitest run src/store/zustand/ai-task/task-configs/`
Run: `pnpm -F desktop typecheck`
Run: `pnpm -F desktop test`
Run: `pnpm exec dprint fmt && pnpm fmt:check`
Expected: green. On macOS `pnpm fmt:check` must pass fully.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "$(cat <<'MSG'
feat(enhance): give the summary the point in the recording each note line was written

Claude-Session: https://claude.ai/code/session_017t4jWZR8yGdxeBFbPcztRp
MSG
)"
```

---

## Manual verification (after Task 6)

The pointer and caret behaviour of a widget decoration cannot be covered in
jsdom, so check by hand in `turbo dev:desktop`:

1. Start a recording, type three lines with pauses between them. Each line shows
   its own position on hover, increasing down the note.
2. Walk the caret with the arrow keys across an anchored line's start. The caret
   never lands inside the label, and Backspace at the line start still joins the
   lines.
3. Stop the recording, wait for the audio, click a label. Playback starts at that
   point.
4. Apply a template and generate a pre-meeting brief during a recording. Neither
   gets positions.
5. Open a note recorded before this change. No labels, no errors.
