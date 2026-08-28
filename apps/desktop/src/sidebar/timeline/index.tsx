import { Trans, useLingui } from "@lingui/react/macro";
import {
  memo,
  type RefCallback,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@anlg/utils";

import { useAnchor, useAutoScrollToAnchor } from "./anchor";
import { TimelineBuckets } from "./buckets";
import { TimelineNowChip, UpcomingMeetingChip } from "./chips";
import { getFallbackIndicatorIndex, useTimelineData } from "./data";
import {
  hasSidebarNoteSelectionContext,
  isDeleteSelectionShortcut,
  isSelectAllShortcut,
  isSessionItemKey,
  isTextEditingShortcutTarget,
  isTimelineItemVisible,
  scrollTimelineItemIntoView,
  shouldClearTimelineSelectionOnPointerDown,
} from "./interaction";
import { useCurrentTimeMs } from "./realtime";
import { filterTimelineBuckets, TimelineSearchField } from "./search";
import {
  useUpcomingMeetingStatus,
  useUpcomingMeetingLabelFormatter,
} from "./upcoming-meeting";

import { useIgnoredEvents } from "~/calendar/ignored-events";
import { useTimelineTables } from "~/calendar/queries";
import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useConfigValue } from "~/shared/config";
import { scrollElementByWheel } from "~/shared/dom/scroll-wheel";
import { useMountEffect } from "~/shared/hooks/useMountEffect";
import { useNativeContextMenu } from "~/shared/hooks/useNativeContextMenu";
import { DestructiveConfirmationDialog } from "~/shared/ui/destructive-confirmation-dialog";
import { useTabs } from "~/store/zustand/tabs";
import { useTimelineSelection } from "~/store/zustand/timeline-selection";
import { useListener } from "~/stt/contexts";

export const TimelineView = memo(function TimelineView({
  showIgnoredEvents,
  onShowIgnoredEventsChange,
  topChipsOverlapHeader = false,
  topChromeInset = false,
}: {
  showIgnoredEvents?: boolean;
  onShowIgnoredEventsChange?: (showIgnored: boolean) => void;
  topChipsOverlapHeader?: boolean;
  topChromeInset?: boolean;
} = {}) {
  const { t } = useLingui();
  const timezone = useConfigValue("timezone") || undefined;
  const { timelineEventsTable, timelineSessionsTable } = useTimelineTables();
  const [uncontrolledShowIgnored, setUncontrolledShowIgnored] = useState(false);
  const showIgnored = showIgnoredEvents ?? uncontrolledShowIgnored;
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);

  const { isIgnored } = useIgnoredEvents();
  const { buckets, hasMoreFutureItems } = useTimelineData({
    isEventIgnored: isIgnored,
    showIgnored,
    timelineEventsTable,
    timelineSessionsTable,
    timezone,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const isSearching = searchQuery.trim().length > 0;
  const visibleBuckets = useMemo(
    () => filterTimelineBuckets(buckets, searchQuery),
    [buckets, searchQuery],
  );

  const hasToday = useMemo(
    () => visibleBuckets.some((bucket) => bucket.label === "Today"),
    [visibleBuckets],
  );
  const indicatorTimeMs = useCurrentTimeMs();
  const formatUpcomingMeetingLabel = useUpcomingMeetingLabelFormatter();
  const upcomingMeetingStatus = useUpcomingMeetingStatus(
    buckets,
    formatUpcomingMeetingLabel,
    t`Now`,
  );
  const [isUpcomingMeetingVisible, setIsUpcomingMeetingVisible] =
    useState(false);
  const upcomingMeetingNodeRef = useRef<HTMLDivElement | null>(null);
  const setUpcomingMeetingNodeRef = useCallback<RefCallback<HTMLDivElement>>(
    (node) => {
      upcomingMeetingNodeRef.current = node;
    },
    [],
  );
  const activeSessionId = useListener((state) =>
    state.live.status === "active" || state.live.status === "finalizing"
      ? state.live.sessionId
      : null,
  );
  const hasActiveVisibleSession = useMemo(
    () =>
      !!activeSessionId &&
      visibleBuckets.some((bucket) =>
        bucket.items.some(
          (item) => item.type === "session" && item.id === activeSessionId,
        ),
      ),
    [activeSessionId, visibleBuckets],
  );

  const currentTab = useTabs((state) => state.currentTab);

  const selectedSessionId = useMemo(() => {
    return currentTab?.type === "sessions" ? currentTab.id : undefined;
  }, [currentTab]);

  const selectedIds = useTimelineSelection((s) => s.selectedIds);
  const anchorId = useTimelineSelection((s) => s.anchorId);
  const selectAll = useTimelineSelection((s) => s.selectAll);
  const clearSelection = useTimelineSelection((s) => s.clear);
  const deleteSession = useDeleteSession();
  const [pendingDeleteSessionIds, setPendingDeleteSessionIds] = useState<
    string[]
  >([]);

  const handleRequestDeleteSelected = useCallback(() => {
    const sessionIds = selectedIds
      .filter(isSessionItemKey)
      .map((key) => key.replace("session-", ""));

    if (sessionIds.length > 0) {
      setPendingDeleteSessionIds(sessionIds);
    }
  }, [selectedIds]);

  const handleConfirmDeleteSelected = useCallback(() => {
    const sessionIds = pendingDeleteSessionIds;
    const batchId = sessionIds.length > 1 ? crypto.randomUUID() : undefined;

    setPendingDeleteSessionIds([]);
    for (const sessionId of sessionIds) {
      deleteSession(sessionId, {
        batchId,
        title: timelineSessionsTable?.[sessionId]?.title ?? undefined,
      });
    }

    clearSelection();
  }, [
    pendingDeleteSessionIds,
    deleteSession,
    clearSelection,
    timelineSessionsTable,
  ]);

  const sessionCount = useMemo(
    () => selectedIds.filter(isSessionItemKey).length,
    [selectedIds],
  );

  const flatItemKeys = useMemo(() => {
    const keys: string[] = [];
    for (const bucket of visibleBuckets) {
      for (const item of bucket.items) {
        keys.push(`${item.type}-${item.id}`);
      }
    }
    return keys;
  }, [visibleBuckets]);
  const flatItemKeysRef = useRef(flatItemKeys);
  flatItemKeysRef.current = flatItemKeys;
  const getFlatItemKeys = useCallback(() => flatItemKeysRef.current, []);
  const flatSessionItemKeys = useMemo(
    () => flatItemKeys.filter(isSessionItemKey),
    [flatItemKeys],
  );
  const shortcutStateRef = useRef({
    anchorId,
    clearSelection,
    flatSessionItemKeys,
    handleRequestDeleteSelected,
    selectedIds,
    selectedSessionId,
    selectAll,
  });
  shortcutStateRef.current = {
    anchorId,
    clearSelection,
    flatSessionItemKeys,
    handleRequestDeleteSelected,
    selectedIds,
    selectedSessionId,
    selectAll,
  };

  const {
    containerRef,
    isAnchorVisible: isTodayVisible,
    isScrolledPastAnchor: isScrolledPastToday,
    scrollToAnchor: scrollToToday,
    registerAnchor: setCurrentTimeIndicatorRef,
    anchorNode: todayAnchorNode,
  } = useAnchor();
  const showUpcomingMeetingChip =
    Boolean(upcomingMeetingStatus) && !isUpcomingMeetingVisible;
  const showTopNowChip =
    !showUpcomingMeetingChip && !isTodayVisible && isScrolledPastToday;
  const topSpacerClassName = topChromeInset
    ? "h-12"
    : topChipsOverlapHeader
      ? "h-9"
      : "h-8";
  const bucketHeaderTopClassName = topChromeInset ? "top-12" : "top-0";
  const topChipStackTopClassName = topChromeInset
    ? "top-4"
    : topChipsOverlapHeader
      ? "top-1"
      : "top-2";
  const selectedSessionScrollFrameRef = useRef<number | null>(null);
  const scrollSelectedSessionIntoView = useCallback<
    RefCallback<HTMLDivElement>
  >(
    (node) => {
      if (selectedSessionScrollFrameRef.current !== null) {
        cancelAnimationFrame(selectedSessionScrollFrameRef.current);
        selectedSessionScrollFrameRef.current = null;
      }

      if (!node || currentTab?.type !== "sessions") {
        return;
      }

      selectedSessionScrollFrameRef.current = requestAnimationFrame(() => {
        selectedSessionScrollFrameRef.current = null;
        scrollTimelineItemIntoView(containerRef.current, node);
      });
    },
    [containerRef, currentTab],
  );
  const scrollToUpcomingMeeting = useCallback(() => {
    const node = upcomingMeetingNodeRef.current;
    if (!node) {
      return;
    }

    scrollTimelineItemIntoView(containerRef.current, node);
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateScrollPosition = () => {
      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      const nextScrollTop = container.scrollTop;

      setIsScrolledToBottom(maxScrollTop - nextScrollTop <= 12);
      setIsUpcomingMeetingVisible(
        isTimelineItemVisible(container, upcomingMeetingNodeRef.current),
      );
    };

    updateScrollPosition();
    container.addEventListener("scroll", updateScrollPosition, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", updateScrollPosition);
    };
  }, [
    containerRef,
    visibleBuckets.length,
    flatItemKeys.length,
    upcomingMeetingStatus?.itemKey,
  ]);

  const todayBucketLength = useMemo(() => {
    const b = visibleBuckets.find((bucket) => bucket.label === "Today");
    return b?.items.length ?? 0;
  }, [visibleBuckets]);
  const autoScrollAnchorNode = hasToday ? todayAnchorNode : null;

  useAutoScrollToAnchor({
    scrollFn: scrollToToday,
    isVisible: isTodayVisible,
    anchorNode: autoScrollAnchorNode,
    deps: [todayBucketLength],
  });

  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;

      if (
        !container ||
        container.closest("[inert], [aria-hidden='true']") ||
        event.defaultPrevented ||
        isTextEditingShortcutTarget(event.target) ||
        isTextEditingShortcutTarget(document.activeElement)
      ) {
        return;
      }

      const {
        anchorId,
        flatSessionItemKeys,
        handleRequestDeleteSelected,
        selectedIds,
        selectedSessionId,
        selectAll,
      } = shortcutStateRef.current;

      if (isDeleteSelectionShortcut(event)) {
        if (!selectedIds.some(isSessionItemKey)) {
          return;
        }

        event.preventDefault();
        handleRequestDeleteSelected();
        return;
      }

      if (isSelectAllShortcut(event)) {
        if (
          !selectedSessionId ||
          flatSessionItemKeys.length === 0 ||
          !hasSidebarNoteSelectionContext({
            anchorId,
            selectedIds,
            selectedSessionId,
          })
        ) {
          return;
        }

        event.preventDefault();
        selectAll(flatSessionItemKeys);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const { clearSelection, selectedIds } = shortcutStateRef.current;

      if (
        selectedIds.length === 0 ||
        !shouldClearTimelineSelectionOnPointerDown(event.target)
      ) {
        return;
      }

      clearSelection();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
    };
  });

  const indicatorIndex = useMemo(() => {
    if (hasToday) {
      return -1;
    }
    return getFallbackIndicatorIndex(visibleBuckets, Date.now());
  }, [visibleBuckets, hasToday, indicatorTimeMs]);

  const toggleShowIgnored = useCallback(() => {
    const nextShowIgnored = !showIgnored;

    if (onShowIgnoredEventsChange) {
      onShowIgnoredEventsChange(nextShowIgnored);
      return;
    }

    setUncontrolledShowIgnored(nextShowIgnored);
  }, [onShowIgnoredEventsChange, showIgnored]);

  const contextMenuItems = useMemo(
    () =>
      selectedIds.length > 0
        ? [
            {
              id: "delete-selected",
              text: t`Delete Selected (${sessionCount})`,
              action: handleRequestDeleteSelected,
              accelerator: "Backspace",
              disabled: sessionCount === 0,
            },
          ]
        : [
            {
              id: "toggle-ignored",
              text: showIgnored
                ? t`Hide Deleted Events`
                : t`Show Deleted Events`,
              action: toggleShowIgnored,
            },
          ],
    [
      selectedIds,
      sessionCount,
      handleRequestDeleteSelected,
      showIgnored,
      toggleShowIgnored,
      t,
    ],
  );

  const showContextMenu = useNativeContextMenu(contextMenuItems);
  const handleWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const target = event.target;

      if (
        !container ||
        event.defaultPrevented ||
        (target instanceof Node && container.contains(target))
      ) {
        return;
      }

      scrollElementByWheel(container, event);
    },
    [containerRef],
  );

  const pendingDeleteCount = pendingDeleteSessionIds.length;

  return (
    <>
      <DestructiveConfirmationDialog
        open={pendingDeleteCount > 0}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteSessionIds([]);
        }}
        title={
          pendingDeleteCount === 1
            ? t`Delete 1 selected note?`
            : t`Delete ${pendingDeleteCount} selected notes?`
        }
        description={t`You can undo this action for a short time.`}
        confirmLabel={t`Delete`}
        onConfirm={handleConfirmDeleteSelected}
      />
      <div
        data-sidebar-timeline-root
        className="flex h-full flex-col"
        onWheelCapture={handleWheelCapture}
      >
        <div className={cn(["shrink-0 pb-1", topChromeInset && "pt-11"])}>
          <TimelineSearchField onChange={setSearchQuery} value={searchQuery} />
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            ref={containerRef}
            data-sidebar-timeline-scroll
            onContextMenu={showContextMenu}
            className={cn([
              "scrollbar-hide flex h-full flex-col overflow-y-auto",
              "rounded-xl",
            ])}
          >
            {(topChromeInset || hasMoreFutureItems) && (
              <div
                aria-hidden
                data-sidebar-timeline-top-spacer
                className={cn([topSpacerClassName, "shrink-0"])}
              />
            )}
            <TimelineBuckets
              bucketHeaderTopClassName={bucketHeaderTopClassName}
              buckets={visibleBuckets}
              emptyTodayLabel={<Trans>No items today</Trans>}
              getFlatItemKeys={getFlatItemKeys}
              hasActiveVisibleSession={hasActiveVisibleSession}
              hasToday={hasToday}
              indicatorIndex={indicatorIndex}
              registerIndicator={setCurrentTimeIndicatorRef}
              selectedIds={selectedIds}
              selectedNodeRef={scrollSelectedSessionIntoView}
              selectedSessionId={selectedSessionId}
              timezone={timezone}
              upcomingMeetingStatus={upcomingMeetingStatus}
              upcomingNodeRef={setUpcomingMeetingNodeRef}
            />
            {isSearching && visibleBuckets.length === 0 ? (
              <div
                data-sidebar-timeline-search-empty
                className="text-muted-foreground px-3 py-8 text-center text-sm"
              >
                <Trans>No matching notes or meetings</Trans>
              </div>
            ) : null}
          </div>

          {!isScrolledToBottom && (
            <div
              aria-hidden
              data-sidebar-timeline-bottom-fade
              className="from-background/0 to-background pointer-events-none absolute inset-x-0 bottom-0 z-30 h-7 bg-linear-to-b"
            />
          )}

          {topChromeInset && (
            <div
              aria-hidden
              data-sidebar-timeline-top-occluder
              className="bg-background pointer-events-none absolute inset-x-0 top-0 z-10 h-12"
            />
          )}

          {(showUpcomingMeetingChip || showTopNowChip) && (
            <div
              data-sidebar-timeline-top-chip-stack
              className={cn([
                "absolute left-1/2 z-20 flex -translate-x-1/2 transform flex-col items-center gap-2",
                topChipStackTopClassName,
              ])}
            >
              {upcomingMeetingStatus && showUpcomingMeetingChip && (
                <UpcomingMeetingChip
                  ariaLabel={`${
                    upcomingMeetingStatus.title || t`Meeting`
                  } ${upcomingMeetingStatus.label.toLowerCase()}`}
                  label={upcomingMeetingStatus.label}
                  onClick={scrollToUpcomingMeeting}
                />
              )}
              {showTopNowChip && (
                <TimelineNowChip
                  ariaLabel={t`Go back to now`}
                  direction="up"
                  onClick={scrollToToday}
                >
                  <Trans>Now</Trans>
                </TimelineNowChip>
              )}
            </div>
          )}

          {!showUpcomingMeetingChip &&
            !isTodayVisible &&
            !isScrolledPastToday && (
              <TimelineNowChip
                ariaLabel={t`Go back to now`}
                onClick={scrollToToday}
                direction="down"
                className={cn([
                  "absolute bottom-2 left-1/2 -translate-x-1/2 transform",
                  "z-40",
                ])}
              >
                <Trans>Now</Trans>
              </TimelineNowChip>
            )}
        </div>
      </div>
    </>
  );
});
