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

      const updates: { pos: number; recordedAtMs: number | null }[] = [];
      for (const range of ranges) {
        newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (node.type !== newState.schema.nodes.paragraph) {
            return true;
          }
          if (node.attrs.recordedAtMs === null && node.textContent.length > 0) {
            updates.push({ pos, recordedAtMs });
          }
          // Split copies attributes onto both halves. Detect the newly created empty
          // half by checking if another paragraph shares this timestamp. Preserve
          // anchors on existing paragraphs that lost content (e.g., via deletion).
          if (
            node.attrs.recordedAtMs !== null &&
            node.textContent.length === 0
          ) {
            let countWithTimestamp = 0;
            newState.doc.forEach((n) => {
              if (
                n.type === newState.schema.nodes.paragraph &&
                n.attrs.recordedAtMs === node.attrs.recordedAtMs
              ) {
                countWithTimestamp++;
              }
            });

            if (countWithTimestamp > 1) {
              updates.push({ pos, recordedAtMs: null });
            }
          }
          return false;
        });
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
