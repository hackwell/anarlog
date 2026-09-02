import { useMemo } from "react";

import { useSmartCurrentTime } from "./realtime";
import {
  buildTimelineBuckets,
  deriveTimelineWindowData,
  getItemTimestamp,
  type TimelineBucket,
  type TimelineEventsTable,
  type TimelineView,
  type TimelineSessionsTable,
} from "./utils";

export function getFallbackIndicatorIndex(
  buckets: TimelineBucket[],
  nowMs: number,
  ascending = false,
) {
  // The timeline runs forward from today, so "now" sits ahead of the first
  // bucket that has not started yet.
  if (ascending) {
    return buckets.findIndex((bucket) => {
      const firstItem = bucket.items[0];
      const itemDate = firstItem ? getItemTimestamp(firstItem) : null;
      return !!itemDate && itemDate.getTime() >= nowMs;
    });
  }

  let staleFutureBoundary: number | null = null;

  for (let index = 0; index < buckets.length; index++) {
    const bucket = buckets[index];
    const firstItem = bucket?.items[0];
    if (!bucket || !firstItem) {
      continue;
    }

    const itemDate = getItemTimestamp(firstItem);
    if (!itemDate || itemDate.getTime() >= nowMs) {
      continue;
    }

    if (isFutureBucketLabel(bucket.label)) {
      staleFutureBoundary = index + 1;
      continue;
    }

    return staleFutureBoundary ?? index;
  }

  return staleFutureBoundary ?? -1;
}

function isFutureBucketLabel(label: string) {
  return (
    label === "Tomorrow" ||
    label === "next week" ||
    label === "next month" ||
    label.startsWith("in ")
  );
}

export function useTimelineData({
  isEventIgnored,
  showIgnored,
  timelineEventsTable,
  timelineSessionsTable,
  timezone,
  view,
}: {
  isEventIgnored: (
    trackingId: string | null | undefined,
    recurrenceSeriesId: string | null | undefined,
  ) => boolean;
  showIgnored: boolean;
  timelineEventsTable: TimelineEventsTable;
  timelineSessionsTable: TimelineSessionsTable;
  timezone?: string;
  view: TimelineView;
}): {
  buckets: TimelineBucket[];
  hasMoreFutureItems: boolean;
} {
  const windowData = useMemo(
    () =>
      deriveTimelineWindowData({
        isEventIgnored,
        showIgnored,
        timelineEventsTable,
        timelineSessionsTable,
        timezone,
      }),
    [
      isEventIgnored,
      showIgnored,
      timelineEventsTable,
      timelineSessionsTable,
      timezone,
    ],
  );
  const currentTimeMs = useSmartCurrentTime(
    windowData.timelineEventsTable,
    windowData.timelineSessionsTable,
  );

  return useMemo(() => {
    const buckets = buildTimelineBuckets({
      timelineEventsTable: windowData.timelineEventsTable,
      timelineSessionsTable: windowData.timelineSessionsTable,
      timezone,
      view,
    });

    return {
      buckets,
      hasMoreFutureItems: windowData.hasMoreFutureItems,
    };
  }, [windowData, currentTimeMs, timezone, view]);
}
