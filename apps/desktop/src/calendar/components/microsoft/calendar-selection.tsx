import { useCallback, useMemo } from "react";

import { useSync } from "../context";

import {
  type CalendarGroup,
  type CalendarItem,
  CalendarSelection,
} from "~/calendar/components/calendar-selection";
import { setCalendarEnabled, useCalendarRows } from "~/calendar/queries";
import { useMountEffect } from "~/shared/hooks/useMountEffect";

const DEFAULT_SOURCE_NAME = "Microsoft 365";

export function MicrosoftCalendarSelection({
  calendarClassName,
  leftAction,
}: { calendarClassName?: string; leftAction?: React.ReactNode } = {}) {
  const { groups, handleRefresh, handleToggle, isLoading, scheduleSync } =
    useMicrosoftCalendarSelection();

  useMountEffect(() => {
    if (groups.length === 0) {
      scheduleSync();
    }
  });

  return (
    <div className="flex flex-col gap-2">
      {leftAction && groups.length === 0 ? <div>{leftAction}</div> : null}

      <CalendarSelection
        groups={groups}
        onToggle={handleToggle}
        onRefresh={handleRefresh}
        isLoading={isLoading}
        className={calendarClassName}
      />
    </div>
  );
}

export function useMicrosoftCalendarSelection() {
  const { cancelDebouncedSync, status, scheduleDebouncedSync, scheduleSync } =
    useSync();

  const calendars = useCalendarRows("microsoft");

  const groups = useMemo((): CalendarGroup[] => {
    const grouped = new Map<string, CalendarItem[]>();
    for (const cal of calendars) {
      const source = cal.source || DEFAULT_SOURCE_NAME;
      if (!grouped.has(source)) grouped.set(source, []);
      grouped.get(source)!.push({
        id: cal.id,
        title: cal.name || "Untitled",
        color: cal.color ?? "#888",
        enabled: cal.enabled ?? false,
      });
    }

    return Array.from(grouped.entries())
      .map(([sourceName, calendars]) => ({ sourceName, calendars }))
      .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  }, [calendars]);

  const handleToggle = useCallback(
    (calendar: CalendarItem, enabled: boolean) =>
      setCalendarEnabled(calendar.id, enabled)
        .then(scheduleDebouncedSync)
        .catch((error: unknown) => {
          console.error("[calendar] failed to update calendar", error);
          throw error;
        }),
    [scheduleDebouncedSync],
  );

  const handleRefresh = useCallback(() => {
    cancelDebouncedSync();
    scheduleSync();
  }, [cancelDebouncedSync, scheduleSync]);

  return {
    groups,
    handleRefresh,
    handleToggle,
    isLoading: status === "syncing",
    scheduleSync,
  };
}
