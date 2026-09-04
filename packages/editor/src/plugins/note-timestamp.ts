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

      // Collect empty paragraphs that need normalization before computing counts
      const emptyAnchored: Array<{ pos: number; value: number }> = [];
      for (const range of ranges) {
        newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (node.type !== newState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs === null && node.textContent.length > 0) {
            updates.push({ pos, recordedAtMs });
          }
          if (
            node.attrs.recordedAtMs !== null &&
            node.textContent.length === 0
          ) {
            emptyAnchored.push({ pos, value: node.attrs.recordedAtMs });
          }
          return false;
        });
      }

      // Count occurrences of each timestamp value in old and new documents
      const countInOld = new Map<number, number>();
      const countInNew = new Map<number, number>();

      oldState.doc.forEach((node) => {
        if (
          node.type === oldState.schema.nodes.paragraph &&
          typeof node.attrs.recordedAtMs === "number"
        ) {
          countInOld.set(
            node.attrs.recordedAtMs,
            (countInOld.get(node.attrs.recordedAtMs) ?? 0) + 1,
          );
        }
      });

      newState.doc.forEach((node) => {
        if (
          node.type === newState.schema.nodes.paragraph &&
          typeof node.attrs.recordedAtMs === "number"
        ) {
          countInNew.set(
            node.attrs.recordedAtMs,
            (countInNew.get(node.attrs.recordedAtMs) ?? 0) + 1,
          );
        }
      });

      // Clear empty paragraphs only if their count increased (split-created copies)
      for (const { pos, value } of emptyAnchored) {
        const oldCount = countInOld.get(value) ?? 0;
        const newCount = countInNew.get(value) ?? 0;
        if (newCount > oldCount) {
          updates.push({ pos, recordedAtMs: null });
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
