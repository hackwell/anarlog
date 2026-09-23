import { commands as calendarCommands } from "@anlg/plugin-calendar";
import type { CalendarEvent } from "@anlg/plugin-calendar";

import type { Ctx } from "../ctx";
import type {
  EventParticipant,
  IncomingEvent,
  IncomingParticipants,
} from "./types";

export class CalendarFetchError extends Error {
  constructor(
    public readonly calendarTrackingId: string,
    public readonly cause: string,
  ) {
    super(
      `Failed to fetch events for calendar ${calendarTrackingId}: ${cause}`,
    );
    this.name = "CalendarFetchError";
  }
}

// One calendar that does not answer used to reject the whole fetch, so a single
// unreachable calendar — a laptop waking before the network is up — discarded
// the answers every other calendar had already given, and nothing synced.
// Failures are reported by store id because that is what the deletion scope is
// keyed by: the caller has to keep those calendars out of it, or the sync reads
// their absence as "this calendar is empty now" and deletes their events.
export async function fetchIncomingEvents(ctx: Ctx): Promise<{
  events: IncomingEvent[];
  participants: IncomingParticipants;
  failedCalendarIds: Set<string>;
  failures: CalendarFetchError[];
  allCalendarsFailed: boolean;
}> {
  const trackingIds = Array.from(ctx.calendarTrackingIdToId.keys());

  const settled = await Promise.all(
    trackingIds.map(async (trackingId) => {
      const result = await calendarCommands.listEvents(
        ctx.provider,
        ctx.connectionId,
        {
          calendar_tracking_id: trackingId,
          from: ctx.from.toISOString(),
          to: ctx.to.toISOString(),
        },
      );

      return result.status === "error"
        ? ({
            ok: false,
            trackingId,
            failure: new CalendarFetchError(trackingId, result.error),
          } as const)
        : ({ ok: true, data: result.data } as const);
    }),
  );

  const failedCalendarIds = new Set<string>();
  const failures: CalendarFetchError[] = [];
  const calendarEvents: CalendarEvent[] = [];

  for (const outcome of settled) {
    if (outcome.ok) {
      calendarEvents.push(...outcome.data);
      continue;
    }
    failures.push(outcome.failure);
    const calendarId = ctx.calendarTrackingIdToId.get(outcome.trackingId);
    if (calendarId) failedCalendarIds.add(calendarId);
  }

  const events: IncomingEvent[] = [];
  const participants: IncomingParticipants = new Map();

  for (const calendarEvent of calendarEvents) {
    if (
      calendarEvent.attendees.find(
        (attendee) =>
          attendee.is_current_user && attendee.status === "declined",
      )
    ) {
      continue;
    }
    const { event, eventParticipants } = normalizeCalendarEvent(calendarEvent);
    events.push(event);
    participants.set(event.tracking_id_event, eventParticipants);
  }

  return {
    events,
    participants,
    failedCalendarIds,
    failures,
    allCalendarsFailed:
      trackingIds.length > 0 && failures.length === trackingIds.length,
  };
}

// Meeting links are fully resolved on the Rust side during provider
// conversion, so no per-event parse IPC happens here.
function normalizeCalendarEvent(calendarEvent: CalendarEvent): {
  event: IncomingEvent;
  eventParticipants: EventParticipant[];
} {
  const eventParticipants: EventParticipant[] = [];

  if (calendarEvent.organizer) {
    eventParticipants.push({
      name: calendarEvent.organizer.name ?? undefined,
      email: calendarEvent.organizer.email ?? undefined,
      is_organizer: true,
      is_current_user: calendarEvent.organizer.is_current_user,
    });
  }

  const organizerEmail = calendarEvent.organizer?.email?.toLowerCase();

  for (const attendee of calendarEvent.attendees) {
    if (attendee.role === "nonparticipant") continue;
    if (organizerEmail && attendee.email?.toLowerCase() === organizerEmail)
      continue;
    eventParticipants.push({
      name: attendee.name ?? undefined,
      email: attendee.email ?? undefined,
      is_organizer: false,
      is_current_user: attendee.is_current_user,
    });
  }

  return {
    event: {
      tracking_id_event: calendarEvent.id,
      tracking_id_calendar: calendarEvent.calendar_id,
      title: calendarEvent.title,
      started_at: calendarEvent.started_at,
      ended_at: calendarEvent.ended_at,
      location: calendarEvent.location ?? undefined,
      meeting_link: calendarEvent.meeting_link ?? undefined,
      description: calendarEvent.description ?? undefined,
      recurrence_series_id: calendarEvent.recurring_event_id ?? undefined,
      has_recurrence_rules: calendarEvent.has_recurrence_rules,
      is_all_day: calendarEvent.is_all_day,
    },
    eventParticipants,
  };
}
