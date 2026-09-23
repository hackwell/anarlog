import { beforeEach, describe, expect, test, vi } from "vitest";

const calendarCommands = vi.hoisted(() => ({
  listEvents: vi.fn(),
}));

vi.mock("@anlg/plugin-calendar", () => ({
  commands: calendarCommands,
}));

import type { Ctx } from "../ctx";
import { fetchIncomingEvents } from "./incoming";

const ctx: Ctx = {
  provider: "apple",
  connectionId: "conn-1",
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-02T00:00:00.000Z"),
  calendarIds: new Set(["cal-1"]),
  calendarTrackingIdToId: new Map([["primary", "cal-1"]]),
};

describe("fetchIncomingEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("records an empty participant list so stale auto mappings are removed", async () => {
    calendarCommands.listEvents.mockResolvedValue({
      status: "success",
      data: [
        {
          id: "event-1",
          calendar_id: "primary",
          title: "No attendees",
          started_at: "2026-06-01T10:00:00.000Z",
          ended_at: "2026-06-01T11:00:00.000Z",
          attendees: [],
          organizer: null,
          has_recurrence_rules: false,
          is_all_day: false,
        },
      ],
    });

    const result = await fetchIncomingEvents(ctx);

    expect(result.events).toHaveLength(1);
    expect(result.participants.has("event-1")).toBe(true);
    expect(result.participants.get("event-1")).toEqual([]);
  });

  test("passes through the meeting link resolved during provider conversion", async () => {
    const meetingLink = "https://meet.google.com/abc-defg-hij";
    calendarCommands.listEvents.mockResolvedValue({
      status: "success",
      data: [
        {
          id: "event-1",
          calendar_id: "primary",
          title: "Customer call",
          description: "https://cal.com/customer-call/reschedule",
          location: "Conference room 4",
          meeting_link: meetingLink,
          started_at: "2026-06-01T10:00:00.000Z",
          ended_at: "2026-06-01T11:00:00.000Z",
          attendees: [],
          organizer: null,
          has_recurrence_rules: false,
          is_all_day: false,
        },
      ],
    });

    const result = await fetchIncomingEvents(ctx);

    expect(result.events[0]?.meeting_link).toBe(meetingLink);
  });

  test("keeps the calendars that answered when one of them fails", async () => {
    const twoCalendars: Ctx = {
      ...ctx,
      calendarIds: new Set(["cal-1", "cal-2"]),
      calendarTrackingIdToId: new Map([
        ["primary", "cal-1"],
        ["shared", "cal-2"],
      ]),
    };

    calendarCommands.listEvents.mockImplementation(
      (
        _provider: string,
        _connectionId: string,
        args: { calendar_tracking_id: string },
      ) =>
        args.calendar_tracking_id === "shared"
          ? Promise.resolve({
              status: "error",
              error: "network is unreachable",
            })
          : Promise.resolve({
              status: "success",
              data: [
                {
                  id: "event-1",
                  calendar_id: "primary",
                  title: "Standup",
                  started_at: "2026-06-01T10:00:00.000Z",
                  ended_at: "2026-06-01T11:00:00.000Z",
                  attendees: [],
                  organizer: null,
                  has_recurrence_rules: false,
                  is_all_day: false,
                },
              ],
            }),
    );

    const result = await fetchIncomingEvents(twoCalendars);

    expect(result.events.map((event) => event.tracking_id_event)).toEqual([
      "event-1",
    ]);
    // The store id, because that is what the deletion scope is keyed by.
    expect(Array.from(result.failedCalendarIds)).toEqual(["cal-2"]);
  });

  test("reports every calendar as failed when none answer", async () => {
    calendarCommands.listEvents.mockResolvedValue({
      status: "error",
      error: "network is unreachable",
    });

    const result = await fetchIncomingEvents(ctx);

    expect(result.events).toEqual([]);
    expect(Array.from(result.failedCalendarIds)).toEqual(["cal-1"]);
  });
});
