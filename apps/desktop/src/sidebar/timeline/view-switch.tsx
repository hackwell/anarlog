import { useLingui } from "@lingui/react/macro";
import { Clock, FileText } from "@phosphor-icons/react";
import { motion } from "motion/react";

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
  const { t } = useLingui();

  return (
    <div
      data-sidebar-view-switch
      className="border-sidebar-border shrink-0 border-t p-2"
    >
      <div
        role="tablist"
        className="bg-sidebar-accent/70 dark:bg-sidebar-accent flex rounded-[9px] p-0.5"
      >
        <ViewTab
          active={view === "archive"}
          label={t`Recordings`}
          onSelect={() => onChange("archive")}
          value="archive"
        >
          <FileText className="size-4" />
        </ViewTab>
        <ViewTab
          active={view === "timeline"}
          label={t`Timeline`}
          onSelect={() => onChange("timeline")}
          value="timeline"
        >
          <Clock className="size-4" />
          {/* The count is what makes the unselected tab worth glancing at: it says
              there is something ahead without spending a row on saying it. */}
          {upcomingCount > 0 && (
            <span
              data-sidebar-view-switch-count
              className="bg-sidebar-selected text-sidebar-selected-foreground absolute -top-1.5 -right-2 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold"
            >
              {upcomingCount}
            </span>
          )}
        </ViewTab>
      </div>
    </div>
  );
}

function ViewTab({
  active,
  children,
  label,
  onSelect,
  value,
}: {
  active: boolean;
  children: React.ReactNode;
  label: string;
  onSelect: () => void;
  value: TimelineView;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      data-sidebar-view-tab={value}
      onClick={onSelect}
      className={cn([
        "relative flex h-7 flex-1 items-center justify-center rounded-[7px] transition-colors",
        "focus-visible:ring-sidebar-ring/40 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "text-sidebar-foreground"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
      ])}
    >
      {/* One pill shared by both tabs: motion slides it to whichever tab is
          active instead of fading two separate backgrounds. The icon comes
          after it in DOM order and is positioned, so it paints on top. */}
      {active && (
        <motion.span
          layoutId="sidebar-view-switch-pill"
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
          className="dark:bg-sidebar-foreground/12 absolute inset-0 rounded-[7px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:shadow-none"
        />
      )}
      <span className="relative flex items-center">{children}</span>
    </button>
  );
}
