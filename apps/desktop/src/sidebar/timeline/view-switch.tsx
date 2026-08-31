import { Trans } from "@lingui/react/macro";

import { cn } from "@anlg/utils";

import type { TimelineView } from "./utils";

/**
 * The next meeting stays visible in both views. Hiding it behind the timeline
 * tab would mean someone reading their notes misses the thing this app exists
 * to record, which is the one failure the split must not introduce.
 */
export function NextMeetingHint({
  label,
  onSelect,
  title,
}: {
  label: string;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      data-sidebar-next-meeting-hint
      onClick={onSelect}
      className={cn([
        "border-sidebar-border flex w-full items-center gap-2 border-t px-3 py-2 text-left",
        "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring/40 focus-visible:ring-2 focus-visible:outline-none",
      ])}
    >
      <span className="text-sidebar-selected shrink-0 text-xs font-semibold">
        {label}
      </span>
      <span className="truncate text-xs">{title}</span>
    </button>
  );
}

export function TimelineViewSwitch({
  onChange,
  upcomingCount,
  view,
}: {
  onChange: (next: TimelineView) => void;
  upcomingCount: number;
  view: TimelineView;
}) {
  return (
    <div
      data-sidebar-view-switch
      role="tablist"
      className="border-sidebar-border flex shrink-0 gap-0.5 border-t p-1.5"
    >
      <ViewTab
        active={view === "archive"}
        onSelect={() => onChange("archive")}
        value="archive"
      >
        <Trans>Recordings</Trans>
      </ViewTab>
      <ViewTab
        active={view === "timeline"}
        onSelect={() => onChange("timeline")}
        value="timeline"
      >
        <Trans>Timeline</Trans>
        {/* The count is what makes the unselected tab worth glancing at: it says
            there is something ahead without spending a row on saying it. */}
        {upcomingCount > 0 && (
          <span
            data-sidebar-view-switch-count
            className="bg-sidebar-selected text-sidebar-selected-foreground ml-1.5 inline-block min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold"
          >
            {upcomingCount}
          </span>
        )}
      </ViewTab>
    </div>
  );
}

function ViewTab({
  active,
  children,
  onSelect,
  value,
}: {
  active: boolean;
  children: React.ReactNode;
  onSelect: () => void;
  value: TimelineView;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-sidebar-view-tab={value}
      onClick={onSelect}
      className={cn([
        "flex-1 rounded-md px-1 py-1.5 text-xs",
        "focus-visible:ring-sidebar-ring/40 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-muted-foreground hover:text-sidebar-foreground",
      ])}
    >
      {children}
    </button>
  );
}
