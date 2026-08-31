import { useCallback, useState } from "react";

import type { TimelineView } from "./utils";

const STORAGE_KEY = "sidebar-timeline-view";

// Which half of the rail someone was last reading is a per-machine convenience,
// not shared state, so it lives beside the theme choice rather than in the
// database. A browser that refuses storage simply starts on the archive.
function readStoredView(): TimelineView {
  try {
    return localStorage.getItem(STORAGE_KEY) === "timeline"
      ? "timeline"
      : "archive";
  } catch {
    return "archive";
  }
}

export function useTimelineView(): [
  TimelineView,
  (next: TimelineView) => void,
] {
  const [view, setView] = useState<TimelineView>(readStoredView);

  const select = useCallback((next: TimelineView) => {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience; losing it costs one click.
    }
  }, []);

  return [view, select];
}
