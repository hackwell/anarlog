import { Plugin, PluginKey } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";

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

      // ProseMirror's split copies a node's attributes onto both halves, so an empty
      // paragraph carrying an anchor may be one the user never typed into. Map every
      // anchored paragraph from the old document forward through this transaction's
      // combined mapping: an empty candidate whose position is not the image of one
      // of those survivors is a node this transaction created, so only it is cleared.
      if (emptyAnchored.length > 0) {
        const mapping = new Mapping();
        for (const transaction of transactions) {
          mapping.appendMapping(transaction.mapping);
        }

        const survivingAnchored = new Set<number>();
        oldState.doc.descendants((node, pos) => {
          if (node.type !== oldState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs !== null) {
            const result = mapping.mapResult(pos, 1);
            if (!result.deleted) {
              survivingAnchored.add(result.pos);
            }
          }
          return false;
        });

        for (const pos of emptyAnchored) {
          if (!survivingAnchored.has(pos)) {
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
