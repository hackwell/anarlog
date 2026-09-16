import { useLingui } from "@lingui/react";
import { useLingui as useLinguiMacro } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";

import {
  commands as trayCommands,
  type TrayScheduleEvent,
} from "@anlg/plugin-tray";
import { getCurrentWebviewWindowLabel } from "@anlg/plugin-windows";
import { addDays, safeParseDate, startOfDay, TZDate } from "@anlg/utils";

import { useIgnoredEvents } from "~/calendar/ignored-events";
import { useTimelineEventsTable } from "~/calendar/queries";
import type { ClockFormat } from "~/i18n/date-format";
import { resolveDisplayLocale } from "~/i18n/locales";
import { useConfigValue } from "~/shared/config";
import { useCurrentDay } from "~/shared/hooks/useCurrentDay";
import { useMountEffect } from "~/shared/hooks/useMountEffect";
import type { TimelineEventRow } from "~/sidebar/timeline/utils";

const PUBLISHED_SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export function buildTrayScheduleEvents(
  rows: Record<string, TimelineEventRow> | null | undefined,
  isIgnored: (
    trackingId: string | null | undefined,
    recurrenceSeriesId: string | null | undefined,
  ) => boolean,
  nowMs = Date.now(),
  timezone?: string,
  locale?: string,
): TrayScheduleEvent[] {
  const upperBoundMs = nowMs + PUBLISHED_SCHEDULE_HORIZON_MS;
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

  return Object.entries(rows ?? {})
    .flatMap(([eventId, row]): TrayScheduleEvent[] => {
      if (
        row.is_all_day ||
        isIgnored(row.tracking_id_event, row.recurrence_series_id)
      ) {
        return [];
      }

      const start = safeParseDate(row.started_at);
      if (!start) {
        return [];
      }

      const startsAtMs = start.getTime();
      if (startsAtMs > upperBoundMs) {
        return [];
      }

      const parsedEnd = safeParseDate(row.ended_at);
      const endsAtMs =
        parsedEnd && parsedEnd.getTime() > startsAtMs
          ? parsedEnd.getTime()
          : null;
      if (
        (endsAtMs !== null && endsAtMs <= nowMs) ||
        (endsAtMs === null && startsAtMs <= nowMs)
      ) {
        return [];
      }

      const dayStart = startOfDay(toTimezone(start, timezone));
      const previousDayStart = startOfDay(addDays(dayStart, -1));
      const timeLabel = endsAtMs
        ? `${timeFormatter.format(start)} – ${timeFormatter.format(endsAtMs)}`
        : timeFormatter.format(start);

      return [
        {
          id: eventId,
          title: row.title?.trim() || "Untitled event",
          meetingLink: row.meeting_link || null,
          startsAtMs,
          endsAtMs,
          dayStartMs: dayStart.getTime(),
          previousDayStartMs: previousDayStart.getTime(),
          timeLabel,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.startsAtMs - right.startsAtMs ||
        left.title.localeCompare(right.title),
    );
}

/**
 * Intl has no separate "12 or 24 hours" argument; the wish rides on the locale
 * as a Unicode extension. `auto` sends the plain locale so the language decides.
 */
function intlLocale(locale: string, clock: ClockFormat): string {
  const display = resolveDisplayLocale(locale);
  if (clock === "auto") {
    return display;
  }
  return `${display}-u-hc-${clock === "24h" ? "h23" : "h12"}`;
}

export function TrayScheduleSync() {
  const timelineEventsTable = useTimelineEventsTable();
  const { isIgnored } = useIgnoredEvents();
  const timezone = useConfigValue("timezone") || undefined;
  const currentDay = useCurrentDay(timezone);
  // Without these the menu bar clock followed macOS rather than the app: the
  // locale argument existed but was never passed, so Intl fell back to the
  // system. The clock preference rides along for the same reason.
  const { i18n } = useLingui();
  const clockFormat = useConfigValue("clock_format") as ClockFormat;
  const locale = intlLocale(i18n.locale, clockFormat);
  const events = useMemo(
    () =>
      buildTrayScheduleEvents(
        timelineEventsTable,
        isIgnored,
        Date.now(),
        timezone,
        locale,
      ),
    [currentDay, isIgnored, locale, timelineEventsTable, timezone],
  );

  return <TraySchedulePublisher key={JSON.stringify(events)} events={events} />;
}

function toTimezone(date: Date, timezone?: string): Date {
  return timezone ? new TZDate(date, timezone) : date;
}

function TraySchedulePublisher({ events }: { events: TrayScheduleEvent[] }) {
  useMountEffect(() => {
    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }

    void trayCommands
      .setTraySchedule(events)
      .then((result) => {
        if (result.status === "error") {
          console.error("[tray] failed to publish schedule", result.error);
        }
      })
      .catch((error) => {
        console.error("[tray] failed to publish schedule", error);
      });
  });

  return null;
}

/**
 * The tray runs in Rust, which knows no catalogue, so every word it shows has
 * to be handed over. It ticks the countdown itself, so the phrases carry a
 * {duration} placeholder rather than a finished string.
 */
export function TrayLabelsSync() {
  const { t } = useLinguiMacro();
  const { i18n } = useLingui();

  const labels = useMemo(
    () => ({
      remaining: t` • ${"{duration}"} left`,
      upcoming: t` • in ${"{duration}"}`,
      seconds: t`s`,
      minutes: t`m`,
      hours: t`h`,
      today: t`Today`,
      agendaRecord: t`Start Recording`,
      agendaJoinAndRecord: t`Join & Record`,
      agendaPrepareNote: t`Prepare Note`,
      agendaOpenLink: t`Open Meeting Link`,
      openApp: t`Open ${"{app}"}`,
      joinNow: t`Join ${"{title}"}`,
      startMeeting: t`Start a new meeting`,
      newNote: t`New Note`,
      settings: t`Settings`,
      checkUpdates: t`Check for Updates`,
      downloadingUpdate: t`Downloading...`,
      restartToApply: t`Restart to Apply Update`,
      updateAvailable: t`Update Available`,
      updateFailed: t`Update Failed`,
      updateCheckFailed: t`Update Check Failed`,
      quitCompletelyTitle: t`Quit ${"{app}"} Completely?`,
      updateReady: t`Update v${"{version}"} is available!`,
      installFailed: t`Failed to install update: ${"{error}"}`,
      downloadFailed: t`Failed to download update: ${"{error}"}`,
      checkFailed: t`Failed to check for updates: ${"{error}"}`,
      reportBug: t`Report Bug`,
      suggestFeature: t`Suggest Feature`,
      about: t`About ${"{app}"}`,
      quit: t`Quit`,
      quitCompletely: t`Quit ${"{app}"}`,
    }),
    // The catalogue swaps wholesale when the language does.
    [i18n.locale, t],
  );

  useEffect(() => {
    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }
    void trayCommands.setTrayLabels(labels).catch((error: unknown) => {
      console.error("[tray] failed to publish labels", error);
    });
  }, [labels]);

  return null;
}
