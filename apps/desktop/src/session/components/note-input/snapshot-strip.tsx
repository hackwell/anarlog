import { useLingui } from "@lingui/react/macro";
import { convertFileSrc } from "@tauri-apps/api/core";

import { getCanonicalSessionEditor } from "~/session/editor-activity";
import { useMeetingSnapshotRecords } from "~/stt/meeting-snapshot-records";

/**
 * Slides captured from the meeting window. They stay out of the note until
 * the user picks one, so a forty-slide deck does not bury the notes.
 */
export function SnapshotStrip({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const records = useMeetingSnapshotRecords(sessionId);

  if (records.length === 0) {
    return null;
  }

  const insert = (record: (typeof records)[number]) => {
    const view = getCanonicalSessionEditor(sessionId);
    if (!view) return;
    const node = view.state.schema.nodes.image.create({
      src: convertFileSrc(record.path),
      attachmentId: record.attachmentId,
    });
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, node));
  };

  return (
    <div
      data-session-snapshots
      className="scrollbar-hide flex shrink-0 gap-2 overflow-x-auto px-3 pt-2 pb-1"
    >
      {records.map((record) => {
        const time = formatTime(record.capturedAtMs);
        return (
          <button
            key={record.id}
            type="button"
            aria-label={t`Insert slide from ${time}`}
            title={t`Insert slide from ${time}`}
            onClick={() => insert(record)}
            className="border-border hover:border-foreground/40 flex shrink-0 flex-col gap-1 rounded-md border p-1 text-left"
          >
            <img
              src={convertFileSrc(record.path)}
              alt=""
              width={112}
              height={63}
              className="h-[63px] w-28 rounded-sm object-cover"
            />
            <span className="text-muted-foreground px-0.5 text-[10px] tabular-nums">
              {time}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatTime(atMs: number) {
  const date = new Date(atMs);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}`;
}
