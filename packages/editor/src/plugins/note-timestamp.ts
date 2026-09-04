import { Plugin, PluginKey, type Transaction } from "prosemirror-state";

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

      const recordedAtMs = getConfig()?.getRecordedAtMs() ?? null;
      if (recordedAtMs === null || !Number.isFinite(recordedAtMs)) {
        return null;
      }

      const ranges = getChangedTextblockRanges(newState.doc, transactions);
      if (ranges.length === 0 || ranges.length > MAX_STAMPED_TEXTBLOCKS) {
        return null;
      }

      const updates: { pos: number; recordedAtMs: number | null }[] = [];
      const emptyAnchored: number[] = [];
      for (const range of ranges) {
        newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (node.type !== newState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs === null && node.textContent.length > 0) {
            updates.push({ pos, recordedAtMs });
          } else if (
            node.attrs.recordedAtMs !== null &&
            node.textContent.length === 0
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

          if (node.textContent.length === 0) {
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
  });
}
