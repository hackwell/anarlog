import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

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

// Threads a position through each transaction's own mapping in sequence,
// carrying the deleted flag along so callers can tell "moved" from "gone".
function mapPositionForward(transactions: readonly Transaction[], pos: number) {
  let mapped = pos;
  let deleted = false;
  for (const transaction of transactions) {
    const result = transaction.mapping.mapResult(mapped, 1);
    deleted = deleted || result.deleted;
    mapped = result.pos;
  }
  return { pos: mapped, deleted };
}

export function noteTimestampPlugin(
  getConfig: () => NoteTimestampConfig | undefined,
) {
  return new Plugin({
    key: noteTimestampPluginKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const ranges = getChangedTextblockRanges(newState.doc, transactions);
      if (ranges.length === 0 || ranges.length > MAX_STAMPED_TEXTBLOCKS) {
        return null;
      }

      // Stamping needs a running clock, but clearing a split's inherited anchor
      // does not — and a split after the recording ends leaks a time onto a half
      // the user never typed into, which the label and the summary would then
      // assert. So only the stamping half of the pass is gated on a recording.
      const running = getConfig()?.getRecordedAtMs() ?? null;
      const recordedAtMs =
        running !== null && Number.isFinite(running) ? running : null;

      const updates: { pos: number; recordedAtMs: number | null }[] = [];
      const emptyAnchored: number[] = [];
      for (const range of ranges) {
        newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (node.type !== newState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs === null && node.content.size > 0) {
            if (recordedAtMs !== null) {
              updates.push({ pos, recordedAtMs });
            }
          } else if (
            node.attrs.recordedAtMs !== null &&
            node.content.size === 0
          ) {
            emptyAnchored.push(pos);
          }
          return false;
        });
      }

      // A node's boundary position can't tell a split's two halves apart: after any
      // split, one half keeps the old paragraph's start position no matter which side
      // ends up holding the typed content, so the boundary alone can point at either
      // half. Follow the content instead. For each old anchored paragraph: if it had
      // content, probe a position inside it — the node that still holds that content
      // afterward is the original, and its (possibly new) start is legitimate. If the
      // probe reports the content deleted, the paragraph itself went empty but is
      // still the original, so its own mapped start is legitimate. An already-empty
      // paragraph has no content to probe, so its mapped start is legitimate outright.
      // A candidate matching none of this was created by the transaction — a split's
      // copy — and only that one gets cleared.
      if (emptyAnchored.length > 0) {
        const legitimateAnchored = new Set<number>();

        oldState.doc.descendants((node, pos) => {
          if (node.type !== oldState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs === null) {
            return false;
          }

          if (node.content.size === 0) {
            const start = mapPositionForward(transactions, pos);
            if (!start.deleted) {
              legitimateAnchored.add(start.pos);
            }
            return false;
          }

          const probe = mapPositionForward(transactions, pos + 1);
          if (probe.deleted) {
            const start = mapPositionForward(transactions, pos);
            if (!start.deleted) {
              legitimateAnchored.add(start.pos);
            }
          } else {
            const resolved = newState.doc.resolve(probe.pos);
            legitimateAnchored.add(resolved.before(resolved.depth));
          }
          return false;
        });

        for (const pos of emptyAnchored) {
          if (!legitimateAnchored.has(pos)) {
            updates.push({ pos, recordedAtMs: null });
          }
        }
      }

      if (updates.length === 0) {
        return null;
      }

      let tr = newState.tr;
      for (const { pos, recordedAtMs: atMs } of updates) {
        const node = tr.doc.nodeAt(pos);
        if (!node) {
          continue;
        }
        tr = tr.setNodeMarkup(
          pos,
          undefined,
          { ...node.attrs, recordedAtMs: atMs },
          node.marks,
        );
      }

      return tr;
    },
    props: {
      decorations(state) {
        const config = getConfig();
        if (!config?.onActivate) {
          return null;
        }

        const { onActivate, formatLabel, activateLabel } = config;
        const decorations: Decoration[] = [];

        // Shallow on purpose, unlike the stamping side above: a paragraph
        // nested in a list item or blockquote still gets stamped, but its
        // label would collide with the list marker, so it stays unlabeled.
        state.doc.forEach((node, offset) => {
          const recordedAtMs = node.attrs.recordedAtMs;
          if (
            node.type !== state.schema.nodes.paragraph ||
            typeof recordedAtMs !== "number" ||
            node.content.size === 0
          ) {
            return;
          }

          decorations.push(
            Decoration.widget(
              offset + 1,
              () =>
                createLabel(
                  recordedAtMs,
                  formatLabel,
                  onActivate,
                  activateLabel,
                ),
              {
                // The label sits in the margin, not in the text: it must never
                // take the caret or move it when the user walks the line.
                side: -1,
                ignoreSelection: true,
                marks: [],
                // WidgetType.eq falls back to comparing toDOM identity, and
                // toDOM is a fresh closure on every decoration pass, so without
                // a key every label in the document is torn down and rebuilt on
                // each keystroke — restarting its reveal transition and costing
                // an order of magnitude in a long note.
                key: `note-timestamp-${recordedAtMs}`,
              },
            ),
          );
        });

        return decorations.length > 0
          ? DecorationSet.create(state.doc, decorations)
          : null;
      },
    },
  });
}

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
