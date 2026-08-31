import { useLingui } from "@lingui/react/macro";
import { Lock, LockOpen, Square } from "@phosphor-icons/react";
import { platform } from "@tauri-apps/plugin-os";
import {
  memo,
  type DragEvent,
  type RefCallback,
  useCallback,
  useMemo,
  useState,
} from "react";

import { commands as fsSyncCommands } from "@anlg/plugin-fs-sync";
import { commands as openerCommands } from "@anlg/plugin-opener2";
import { DancingSticks } from "@anlg/ui/components/ui/dancing-sticks";
import { Spinner } from "@anlg/ui/components/ui/spinner";
import { cn, getYear, safeParseDate, TZDate } from "@anlg/utils";

import { TimelineCardChip } from "./chips";
import {
  type EventTimelineItem,
  getItemDurationMinutes,
  isMeetingEvent,
  isTimelineItemInFuture,
  type SessionTimelineItem,
  type TimelineItem,
  TimelinePrecision,
} from "./utils";

import { useIgnoredEvents } from "~/calendar/ignored-events";
import { writeSessionContextDragData } from "~/chat/context/session-drag";
import { type DateFormatter, useDateFormatter } from "~/i18n/date-format";
import { DEVICE_AUTH_REASON } from "~/lock/auth";
import { isLockedFlag } from "~/lock/flag";
import { revealLockedNote, setSessionLocked } from "~/lock/notes";
import { useAppLock } from "~/lock/store";
import { useDeleteSession } from "~/session/hooks/useDeleteSession";
import { useIsSessionEnhancing } from "~/session/hooks/useEnhancedNotes";
import {
  getOrCreateSessionForEventId,
  preloadSession,
} from "~/session/queries";
import { getSessionEvent } from "~/session/utils";
import { openStandaloneNoteWindow } from "~/session/window";
import type { MenuItemDef } from "~/shared/hooks/useNativeContextMenu";
import { InteractiveButton } from "~/shared/ui/interactive-button";
import { useSessionTitle } from "~/store/zustand/live-title";
import { useTabs } from "~/store/zustand/tabs";
import { useTimelineSelection } from "~/store/zustand/timeline-selection";
import { useListener } from "~/stt/contexts";

const EMPTY_TIMELINE_ITEM_KEYS: string[] = [];

type ItemBaseProps = {
  title: string;
  displayTime: string;
  durationMinutes?: number | null;
  isLive?: boolean;
  amplitude?: number;
  showSpinner?: boolean;
  isLocked?: boolean;
  isLockRevealed?: boolean;
  selected: boolean;
  ignored?: boolean;
  muted?: boolean;
  /** Carries a transcript and notes: something to come back to, not just a slot. */
  hasContent?: boolean;
  /** A calendar entry with no one else in it - a reminder, not a meeting. */
  subdued?: boolean;
  multiSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onCmdClick: () => void;
  onShiftClick: () => void;
  onStop?: () => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  contextMenu: MenuItemDef[];
  draggable?: boolean;
  selectedNodeRef?: RefCallback<HTMLDivElement>;
  itemNodeRef?: RefCallback<HTMLDivElement>;
  timelineSessionId?: string;
  isUpcoming?: boolean;
  upcomingProgress?: number;
  onPreload?: () => void;
};

export const TimelineItemComponent = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    flatItemKeys,
    getFlatItemKeys,
    selectedNodeRef,
    itemNodeRef,
    isUpcoming,
    upcomingProgress,
  }: {
    item: TimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    flatItemKeys?: string[];
    getFlatItemKeys?: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
    itemNodeRef?: RefCallback<HTMLDivElement>;
    isUpcoming?: boolean;
    upcomingLabel?: string;
    upcomingProgress?: number;
  }) => {
    const readFlatItemKeys =
      getFlatItemKeys ?? (() => flatItemKeys ?? EMPTY_TIMELINE_ITEM_KEYS);

    if (item.type === "event") {
      return (
        <EventItem
          item={item}
          precision={precision}
          selected={selected}
          timezone={timezone}
          multiSelected={multiSelected}
          getFlatItemKeys={readFlatItemKeys}
          selectedNodeRef={selectedNodeRef}
          itemNodeRef={itemNodeRef}
          isUpcoming={isUpcoming}
          upcomingProgress={upcomingProgress}
        />
      );
    }
    return (
      <SessionItem
        item={item}
        precision={precision}
        selected={selected}
        timezone={timezone}
        multiSelected={multiSelected}
        getFlatItemKeys={readFlatItemKeys}
        selectedNodeRef={selectedNodeRef}
        itemNodeRef={itemNodeRef}
        isUpcoming={isUpcoming}
        upcomingProgress={upcomingProgress}
      />
    );
  },
);

const ItemBase = memo(function ItemBase({
  title,
  displayTime,
  durationMinutes,
  isLive,
  amplitude,
  hasContent,
  subdued,
  showSpinner,
  isLocked,
  isLockRevealed,
  selected,
  ignored,
  muted,
  multiSelected,
  onClick,
  onDoubleClick,
  onCmdClick,
  onShiftClick,
  onStop,
  onDragStart,
  contextMenu,
  draggable,
  selectedNodeRef,
  itemNodeRef,
  timelineSessionId,
  isUpcoming,
  upcomingProgress,
  onPreload,
}: ItemBaseProps) {
  const { t } = useLingui();
  const hasSelection = useTimelineSelection((s) => s.selectedIds.length > 0);
  const durationLabel = useDurationLabel(durationMinutes);
  const hasMetadata = Boolean(isLive || durationLabel);
  const showLiveStop = isLive && onStop;
  const showSelectedMarker = !isLive && (selected || multiSelected);
  // The selected fill is the one saturated surface in the rail, so anything
  // sitting on it has to leave the muted ramp or it drops to ~1.5:1. An
  // upcoming row no longer carries a fill of its own, so selection wins
  // outright when a row is both.
  const isSelectedFill = showSelectedMarker;
  const secondaryToneClassName = isLive
    ? "text-recording-foreground"
    : isSelectedFill
      ? "text-sidebar-selected-foreground"
      : "text-muted-foreground";
  const showUpcomingGauge =
    typeof upcomingProgress === "number" &&
    Boolean(isUpcoming) &&
    !isLive &&
    !showSpinner;
  const upcomingGaugePercent =
    typeof upcomingProgress === "number"
      ? Math.round(Math.max(0, Math.min(upcomingProgress, 1)) * 100)
      : 0;
  const showTrailingStatus = showLiveStop || showSpinner;
  const setItemRef = useCallback(
    (node: HTMLDivElement | null) => {
      selectedNodeRef?.(node);
      itemNodeRef?.(node);
    },
    [selectedNodeRef, itemNodeRef],
  );

  return (
    <div
      ref={setItemRef}
      data-sidebar-timeline-session-id={timelineSessionId}
      onFocus={onPreload}
      onPointerDown={onPreload}
      className="group/sidebar-live-item relative [contain-intrinsic-size:auto_56px] [content-visibility:auto]"
    >
      <InteractiveButton
        onClick={ignored ? undefined : onClick}
        onDoubleClick={ignored ? undefined : onDoubleClick}
        onCmdClick={ignored ? undefined : onCmdClick}
        onShiftClick={ignored ? undefined : onShiftClick}
        onDragStart={onDragStart}
        contextMenu={hasSelection ? undefined : contextMenu}
        className={cn([
          "w-full rounded-lg border border-transparent px-3 py-2 text-left",
          showUpcomingGauge && "pl-4",
          showTrailingStatus && "pr-10",
          ignored ? "cursor-default" : "cursor-pointer",
          (multiSelected || selected) &&
            "bg-sidebar-selected text-sidebar-selected-foreground",
          !multiSelected && !selected && "hover:bg-sidebar-accent",
          // One device per state: the gauge already marks the row and carries
          // time-to-start, so the fill would only be a second, less
          // informative copy of the same signal.
          isUpcoming && !isLive && "focus-visible:ring-sidebar-ring/40",
          isLive && [
            "bg-recording-surface text-recording-foreground hover:bg-recording-surface/90",
            "focus-visible:ring-recording/50 focus-visible:ring-2 focus-visible:outline-hidden",
          ],
          ignored && "opacity-40",
          !ignored && muted && !isLive && !isUpcoming && "opacity-65",
        ])}
        draggable={draggable}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-2">
            {/* Three kinds of row read differently at a glance: a recording
                carries a mark because it holds something, a personal calendar
                entry steps back because it will never be recorded, and a
                meeting sits between them at full weight. */}
            {hasContent && !isLive && (
              <span
                aria-hidden
                data-sidebar-timeline-content-marker
                className={cn([
                  "size-1.5 shrink-0 self-center rounded-full",
                  isSelectedFill
                    ? "bg-sidebar-selected-foreground"
                    : "bg-sidebar-selected",
                ])}
              />
            )}
            <div
              className={cn([
                "pointer-events-none min-w-0 flex-1 truncate text-sm",
                hasContent ? "font-medium" : "font-normal",
                subdued &&
                  !isSelectedFill &&
                  !isLive &&
                  "text-muted-foreground",
                ignored && "line-through",
              ])}
            >
              {title || t`Untitled`}
            </div>
            {displayTime ? (
              <div
                data-sidebar-timeline-card-time
                className={cn([
                  "shrink-0 font-mono text-[11px] tabular-nums",
                  secondaryToneClassName,
                ])}
              >
                {displayTime}
              </div>
            ) : null}
            {isLocked ? (
              isLockRevealed ? (
                <LockOpen
                  aria-label={t`Unlock Note`}
                  className={cn([
                    "size-3.5 shrink-0 self-center",
                    secondaryToneClassName,
                  ])}
                  weight="fill"
                />
              ) : (
                <Lock
                  aria-label={t`Locked note`}
                  className={cn([
                    "size-3.5 shrink-0 self-center",
                    secondaryToneClassName,
                  ])}
                  weight="fill"
                />
              )
            ) : null}
          </div>
          {hasMetadata ? (
            <div
              data-sidebar-timeline-card-meta
              className="flex min-w-0 items-center gap-1.5"
            >
              {isLive ? (
                <TimelineCardChip
                  tone="recording"
                  icon={
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
                    />
                  }
                >
                  {t`Recording`}
                </TimelineCardChip>
              ) : null}
              {durationLabel ? (
                <span
                  data-sidebar-timeline-card-duration
                  className={cn([
                    "min-w-0 truncate text-[11px]",
                    secondaryToneClassName,
                  ])}
                >
                  {durationLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </InteractiveButton>
      {showSelectedMarker ? (
        <span
          aria-hidden
          data-sidebar-timeline-selected-marker
          className="bg-sidebar-selected-marker pointer-events-none absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full"
        />
      ) : null}
      {showUpcomingGauge ? (
        <div
          aria-hidden
          data-sidebar-timeline-upcoming-gauge
          className="bg-sidebar-ring/25 pointer-events-none absolute top-2 bottom-2 left-1.5 w-0.5 overflow-hidden rounded-full"
        >
          <div
            data-sidebar-timeline-upcoming-gauge-fill
            className="bg-sidebar-ring absolute bottom-0 left-0 w-full rounded-full transition-[height] duration-300 ease-linear"
            style={{ height: `${upcomingGaugePercent}%` }}
          />
        </div>
      ) : null}
      {showSpinner ? (
        <div
          aria-hidden
          className={cn([
            "pointer-events-none absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center",
            secondaryToneClassName,
          ])}
        >
          <Spinner size={14} />
        </div>
      ) : null}
      {showLiveStop ? (
        <button
          type="button"
          aria-label={t`Stop listening`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStop();
          }}
          className={cn([
            "absolute top-1/2 right-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm",
            "text-white/80 transition-colors hover:bg-white/15 hover:text-white",
            "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-hidden",
          ])}
        >
          <span
            aria-hidden
            className="flex items-center justify-center group-hover/sidebar-live-item:hidden"
          >
            <DancingSticks
              amplitude={amplitude ?? 0.25}
              color="currentColor"
              height={14}
              width={13}
              stickWidth={2}
              gap={2}
            />
          </span>
          <span
            aria-hidden
            className="hidden items-center justify-center group-hover/sidebar-live-item:flex"
          >
            <Square size={10} weight="fill" />
          </span>
        </button>
      ) : null}
    </div>
  );
}, itemBasePropsAreEqual);

function itemBasePropsAreEqual(prev: ItemBaseProps, next: ItemBaseProps) {
  return (
    prev.title === next.title &&
    prev.displayTime === next.displayTime &&
    prev.durationMinutes === next.durationMinutes &&
    prev.isLive === next.isLive &&
    prev.amplitude === next.amplitude &&
    prev.showSpinner === next.showSpinner &&
    prev.isLocked === next.isLocked &&
    prev.isLockRevealed === next.isLockRevealed &&
    prev.selected === next.selected &&
    prev.ignored === next.ignored &&
    prev.muted === next.muted &&
    prev.hasContent === next.hasContent &&
    prev.subdued === next.subdued &&
    prev.multiSelected === next.multiSelected &&
    prev.onClick === next.onClick &&
    prev.onDoubleClick === next.onDoubleClick &&
    prev.onCmdClick === next.onCmdClick &&
    prev.onShiftClick === next.onShiftClick &&
    prev.onStop === next.onStop &&
    prev.onDragStart === next.onDragStart &&
    prev.contextMenu === next.contextMenu &&
    prev.draggable === next.draggable &&
    prev.selectedNodeRef === next.selectedNodeRef &&
    prev.itemNodeRef === next.itemNodeRef &&
    prev.timelineSessionId === next.timelineSessionId &&
    prev.isUpcoming === next.isUpcoming &&
    prev.upcomingProgress === next.upcomingProgress &&
    prev.onPreload === next.onPreload
  );
}

const EventItem = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    getFlatItemKeys,
    selectedNodeRef,
    itemNodeRef,
    isUpcoming,
    upcomingProgress,
  }: {
    item: EventTimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    getFlatItemKeys: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
    itemNodeRef?: RefCallback<HTMLDivElement>;
    isUpcoming?: boolean;
    upcomingProgress?: number;
  }) => {
    const { t } = useLingui();
    const openCurrent = useTabs((state) => state.openCurrent);

    const eventId = item.id;
    const trackingIdEvent = item.data.tracking_id_event;
    const title = item.data.title || t`Untitled`;
    const recurrenceSeriesId = item.data.recurrence_series_id;

    const {
      isIgnored,
      ignoreEvent,
      unignoreEvent,
      ignoreSeries,
      unignoreSeries,
    } = useIgnoredEvents();

    const ignored = isIgnored(trackingIdEvent, recurrenceSeriesId);

    const dateFormatter = useDateFormatter();
    const displayTime = useMemo(
      () =>
        formatDisplayTime(
          item.data.started_at,
          precision,
          dateFormatter,
          timezone,
        ),
      [item.data.started_at, precision, dateFormatter, timezone],
    );

    const durationMinutes = useMemo(() => getItemDurationMinutes(item), [item]);

    const [isOpening, setIsOpening] = useState(false);
    const openEvent = useCallback(() => {
      if (!eventId || isOpening) return;
      setIsOpening(true);
      void getOrCreateSessionForEventId(eventId, title)
        .then((sessionId) => {
          openCurrent({ id: sessionId, type: "sessions" });
        })
        .catch((error) => {
          console.error("[timeline] failed to open event note", error);
        })
        .finally(() => {
          setIsOpening(false);
        });
    }, [eventId, title, openCurrent, isOpening]);

    const itemKey = `event-${item.id}`;
    const muted = isTimelineItemInFuture(item);

    const handleClick = useCallback(() => {
      useTimelineSelection.getState().setAnchor(itemKey);
      openEvent();
    }, [openEvent, itemKey]);

    const handleCmdClick = useCallback(() => {
      useTimelineSelection.getState().toggleSelect(itemKey);
    }, [itemKey]);

    const handleShiftClick = useCallback(() => {
      useTimelineSelection.getState().selectRange(getFlatItemKeys(), itemKey);
    }, [getFlatItemKeys, itemKey]);

    const handleIgnore = useCallback(() => {
      if (!trackingIdEvent) return;
      ignoreEvent(trackingIdEvent);
    }, [trackingIdEvent, ignoreEvent]);

    const handleUnignore = useCallback(() => {
      if (!trackingIdEvent) return;
      unignoreEvent(trackingIdEvent);
    }, [trackingIdEvent, unignoreEvent]);

    const handleUnignoreSeries = useCallback(() => {
      if (!recurrenceSeriesId) return;
      unignoreSeries(recurrenceSeriesId);
    }, [recurrenceSeriesId, unignoreSeries]);

    const handleIgnoreSeries = useCallback(() => {
      if (!recurrenceSeriesId) return;
      ignoreSeries(recurrenceSeriesId);
    }, [recurrenceSeriesId, ignoreSeries]);

    const contextMenu = useMemo(() => {
      if (ignored) {
        if (recurrenceSeriesId) {
          return [
            {
              id: "unignore",
              text: t`Show This Event`,
              action: handleUnignore,
            },
            {
              id: "unignore-series",
              text: t`Show All Recurring Events`,
              action: handleUnignoreSeries,
            },
          ];
        }
        return [
          { id: "unignore", text: t`Show Event`, action: handleUnignore },
        ];
      }
      const menu: MenuItemDef[] = [
        {
          id: "ignore",
          text: recurrenceSeriesId ? t`Delete This Event` : t`Delete Event`,
          action: handleIgnore,
        },
      ];
      if (recurrenceSeriesId) {
        menu.push({
          id: "ignore-series",
          text: t`Delete All Recurring Events`,
          action: handleIgnoreSeries,
        });
      }
      return menu;
    }, [
      ignored,
      handleIgnore,
      handleUnignore,
      handleUnignoreSeries,
      handleIgnoreSeries,
      recurrenceSeriesId,
      t,
    ]);

    return (
      <ItemBase
        subdued={!isMeetingEvent(item)}
        title={title}
        displayTime={displayTime}
        durationMinutes={durationMinutes}
        showSpinner={isOpening}
        selected={selected}
        ignored={ignored}
        muted={muted}
        multiSelected={multiSelected}
        onClick={handleClick}
        onCmdClick={handleCmdClick}
        onShiftClick={handleShiftClick}
        contextMenu={contextMenu}
        selectedNodeRef={selected ? selectedNodeRef : undefined}
        itemNodeRef={itemNodeRef}
        isUpcoming={isUpcoming}
        upcomingProgress={upcomingProgress}
      />
    );
  },
);

const SessionItem = memo(
  ({
    item,
    precision,
    selected,
    timezone,
    multiSelected,
    getFlatItemKeys,
    selectedNodeRef,
    itemNodeRef,
    isUpcoming,
    upcomingProgress,
  }: {
    item: SessionTimelineItem;
    precision: TimelinePrecision;
    selected: boolean;
    timezone?: string;
    multiSelected: boolean;
    getFlatItemKeys: () => string[];
    selectedNodeRef?: RefCallback<HTMLDivElement>;
    itemNodeRef?: RefCallback<HTMLDivElement>;
    isUpcoming?: boolean;
    upcomingProgress?: number;
  }) => {
    const { t } = useLingui();
    const openCurrent = useTabs((state) => state.openCurrent);
    const deleteSession = useDeleteSession();

    const sessionId = item.id;
    const title = useSessionTitle(sessionId, item.data.title ?? undefined);
    const noteLocked = isLockedFlag(item.data.locked);
    const noteRevealed = useAppLock((state) =>
      Boolean(state.revealedNoteIds[sessionId]),
    );
    const authAvailable = useAppLock((state) => state.available) === true;

    const { sessionMode, stop, amplitude } = useListener((state) => {
      const sessionMode = state.getSessionMode(sessionId);
      return {
        sessionMode,
        stop: state.stop,
        amplitude: sessionMode === "active" ? state.live.amplitude : null,
      };
    });
    const isEnhancing = useIsSessionEnhancing(sessionId);
    const isLive = sessionMode === "active";
    const isFinalizing = sessionMode === "finalizing";
    const isBatching = sessionMode === "running_batch";
    const [isOpening, setIsOpening] = useState(false);
    const showSpinner =
      !selected &&
      !isLive &&
      (isFinalizing || isEnhancing || isBatching || isOpening);

    const sessionEvent = getSessionEvent(item.data);

    const dateFormatter = useDateFormatter();
    const displayTime = useMemo(
      () =>
        formatDisplayTime(
          sessionEvent?.started_at ?? item.data.created_at,
          precision,
          dateFormatter,
          timezone,
        ),
      [
        sessionEvent?.started_at,
        item.data.created_at,
        precision,
        dateFormatter,
        timezone,
      ],
    );
    const durationMinutes = useMemo(() => getItemDurationMinutes(item), [item]);
    const muted = isTimelineItemInFuture(item);

    const itemKey = `session-${item.id}`;

    const handlePreload = useCallback(() => {
      if (!noteLocked) void preloadSession(sessionId).catch(() => {});
    }, [noteLocked, sessionId]);

    const openSession = useCallback(async () => {
      setIsOpening(true);
      try {
        await preloadSession(sessionId);
      } catch (error) {
        console.error("[timeline] failed to preload session", error);
      } finally {
        openCurrent({ id: sessionId, type: "sessions" });
        setIsOpening(false);
      }
    }, [openCurrent, sessionId]);

    const handleClick = useCallback(() => {
      useTimelineSelection.getState().setAnchor(itemKey);
      if (noteLocked) {
        void revealLockedNote(sessionId).then((ok) => {
          if (ok) void openSession();
        });
        return;
      }
      void openSession();
    }, [noteLocked, sessionId, openSession, itemKey]);

    const handleCmdClick = useCallback(() => {
      useTimelineSelection.getState().toggleSelect(itemKey);
    }, [itemKey]);

    const handleShiftClick = useCallback(() => {
      useTimelineSelection.getState().selectRange(getFlatItemKeys(), itemKey);
    }, [getFlatItemKeys, itemKey]);

    const handleOpenStandaloneWindow = useCallback(() => {
      void openStandaloneNoteWindow(sessionId);
    }, [sessionId]);

    const handleDragStart = useCallback(
      (event: DragEvent<HTMLElement>) => {
        writeSessionContextDragData(
          event.dataTransfer,
          sessionId,
          title || t`Untitled`,
        );
      },
      [sessionId, title, t],
    );

    const handleDelete = useCallback(() => {
      deleteSession(sessionId, {
        trackingId: sessionEvent?.tracking_id,
        title,
      });
    }, [deleteSession, sessionId, sessionEvent?.tracking_id, title]);

    const handleToggleLock = useCallback(() => {
      void setSessionLocked(sessionId, !noteLocked);
    }, [noteLocked, sessionId]);

    const handleShowInFolder = useCallback(async () => {
      if (noteLocked) {
        const ok = await useAppLock
          .getState()
          .authenticate(DEVICE_AUTH_REASON.openApp);
        if (!ok) return;
      }
      const result = await fsSyncCommands.sessionDir(sessionId);
      if (result.status === "ok") {
        await openerCommands.openPath(result.data, null);
      }
    }, [noteLocked, sessionId]);

    const contextMenu = useMemo(() => {
      const menu: MenuItemDef[] = [
        {
          id: "open-new-window",
          text: t`Open in New Window`,
          action: handleOpenStandaloneWindow,
        },
        {
          id: "show",
          text: platform() === "macos" ? t`Show in Finder` : t`Show in folder`,
          action: handleShowInFolder,
        },
      ];
      if (authAvailable) {
        menu.push({
          id: noteLocked ? "unlock" : "lock",
          text: noteLocked ? t`Unlock Note` : t`Lock Note`,
          action: handleToggleLock,
        });
      }
      menu.push(
        { separator: true as const },
        {
          id: "delete",
          text: t`Delete Note`,
          action: handleDelete,
        },
      );
      return menu;
    }, [
      authAvailable,
      handleDelete,
      handleOpenStandaloneWindow,
      handleShowInFolder,
      handleToggleLock,
      noteLocked,
      t,
    ]);

    return (
      <ItemBase
        hasContent
        title={title}
        displayTime={displayTime}
        durationMinutes={durationMinutes}
        isLive={isLive}
        amplitude={Math.max(
          0.25,
          Math.min(Math.hypot(amplitude?.mic ?? 0, amplitude?.speaker ?? 0), 1),
        )}
        showSpinner={showSpinner}
        isLocked={noteLocked}
        isLockRevealed={noteRevealed}
        selected={selected}
        muted={muted}
        multiSelected={multiSelected}
        onClick={handleClick}
        onDoubleClick={handleOpenStandaloneWindow}
        onCmdClick={handleCmdClick}
        onShiftClick={handleShiftClick}
        onStop={stop}
        onDragStart={handleDragStart}
        contextMenu={contextMenu}
        selectedNodeRef={selected ? selectedNodeRef : undefined}
        itemNodeRef={itemNodeRef}
        timelineSessionId={sessionId}
        isUpcoming={isUpcoming}
        upcomingProgress={upcomingProgress}
        onPreload={handlePreload}
        draggable
      />
    );
  },
);

function useDurationLabel(minutes: number | null | undefined) {
  const { t } = useLingui();

  return useMemo(() => {
    if (!minutes || minutes <= 0) {
      return null;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours === 0) {
      return t`${minutes} min`;
    }

    if (remainingMinutes === 0) {
      return t`${hours} h`;
    }

    return t`${hours} h ${remainingMinutes} min`;
  }, [minutes, t]);
}

function formatDisplayTime(
  timestamp: string | null | undefined,
  precision: TimelinePrecision,
  dateFormatter: DateFormatter,
  timezone?: string,
): string {
  const parsed = safeParseDate(timestamp);
  if (!parsed) {
    return "";
  }

  const date = timezone ? new TZDate(parsed, timezone) : parsed;
  const time = dateFormatter.time(date);

  if (precision === "time") {
    return time;
  }

  const now = timezone ? new TZDate(new Date(), timezone) : new Date();
  const sameYear = getYear(date) === getYear(now);
  const dateStr = sameYear
    ? dateFormatter.dayMonth(date)
    : dateFormatter.date(date);

  return `${dateStr}, ${time}`;
}
