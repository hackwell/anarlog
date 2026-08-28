//! Microsoft Graph resources to the shared calendar shapes.

use anlg_calendar_interface::{
    AttendeeRole, AttendeeStatus, CalendarEvent, CalendarListItem, CalendarProviderType,
    EventAttendee, EventPerson, EventStatus,
};
use anlg_outlook_calendar::{
    Attendee, AttendeeType, Calendar, DateTimeTimeZone, Event, EventShowAs, ResponseType,
};

use crate::Error;
use crate::convert::resolve_provider_meeting_link;
use crate::microsoft::time;

pub fn convert_calendars(calendars: Vec<Calendar>) -> Vec<CalendarListItem> {
    calendars
        .into_iter()
        .map(|calendar| {
            let source = calendar
                .owner
                .as_ref()
                .and_then(|owner| owner.name.clone().or(owner.address.clone()));
            let raw = serde_json::to_string(&calendar).unwrap_or_default();

            CalendarListItem {
                provider: CalendarProviderType::Microsoft,
                id: calendar.id,
                title: calendar.name.unwrap_or_else(|| "Untitled".to_string()),
                source,
                color: calendar.hex_color,
                is_primary: calendar.is_default_calendar,
                can_edit: calendar.can_edit,
                raw,
            }
        })
        .collect()
}

/// Convert a page of Graph events, dropping (and logging) any whose times
/// cannot be resolved rather than failing the whole sync for one bad event.
pub fn convert_events(events: Vec<Event>, calendar_id: &str) -> Vec<CalendarEvent> {
    events
        .into_iter()
        .filter_map(|event| {
            let id = event.id.clone();
            match convert_event(event, calendar_id) {
                Ok(converted) => Some(converted),
                Err(error) => {
                    tracing::warn!(%error, event_id = %id, "microsoft_event_skipped");
                    None
                }
            }
        })
        .collect()
}

fn convert_event(event: Event, calendar_id: &str) -> Result<CalendarEvent, Error> {
    let raw = serde_json::to_string(&event).unwrap_or_default();
    let is_all_day = event.is_all_day.unwrap_or(false);

    let start = event
        .start
        .as_ref()
        .ok_or_else(|| Error::MicrosoftGraph("event has no start".to_string()))?;
    let end = event
        .end
        .as_ref()
        .ok_or_else(|| Error::MicrosoftGraph("event has no end".to_string()))?;

    let started_at = instant(start, is_all_day)?;
    let ended_at = instant(end, is_all_day)?;
    let timezone = start.time_zone.as_deref().map(time::iana_name);

    let organizer = event.organizer.as_ref().map(|organizer| EventPerson {
        name: organizer
            .email_address
            .as_ref()
            .and_then(|email| email.name.clone()),
        email: organizer
            .email_address
            .as_ref()
            .and_then(|email| email.address.clone()),
        is_current_user: event.is_organizer.unwrap_or(false),
    });

    let attendees = event
        .attendees
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(convert_attendee)
        .collect();

    let description = event.body.and_then(|body| body.content);
    let location = event.location.and_then(|location| location.display_name);
    let meeting_link = resolve_provider_meeting_link(
        event.online_meeting_url.clone().or_else(|| {
            event
                .online_meeting
                .as_ref()
                .and_then(|meeting| meeting.join_url.clone())
        }),
        location.as_deref(),
        description.as_deref(),
    );

    Ok(CalendarEvent {
        id: event.id,
        calendar_id: calendar_id.to_string(),
        provider: CalendarProviderType::Microsoft,
        external_id: event.ical_uid.unwrap_or_default(),
        title: event.subject.unwrap_or_default(),
        description,
        location,
        url: event.web_link,
        meeting_link,
        started_at,
        ended_at,
        timezone,
        is_all_day,
        status: convert_status(event.is_cancelled, event.show_as),
        organizer,
        attendees,
        has_recurrence_rules: event.recurrence.is_some() || event.series_master_id.is_some(),
        recurring_event_id: event.series_master_id,
        raw,
    })
}

/// The one decision this whole module exists for: an all-day boundary is a
/// date, a timed boundary is an instant in the zone Graph actually answered in.
fn instant(value: &DateTimeTimeZone, is_all_day: bool) -> Result<String, Error> {
    let resolved = if is_all_day {
        time::all_day_instant(&value.date_time)?
    } else {
        time::timed_instant(&value.date_time, value.time_zone.as_deref())?
    };

    Ok(resolved.to_rfc3339())
}

fn convert_status(is_cancelled: Option<bool>, show_as: Option<EventShowAs>) -> EventStatus {
    if is_cancelled.unwrap_or(false) {
        EventStatus::Cancelled
    } else if matches!(show_as, Some(EventShowAs::Tentative)) {
        EventStatus::Tentative
    } else {
        EventStatus::Confirmed
    }
}

fn convert_attendee(attendee: &Attendee) -> EventAttendee {
    EventAttendee {
        name: attendee
            .email_address
            .as_ref()
            .and_then(|email| email.name.clone()),
        email: attendee
            .email_address
            .as_ref()
            .and_then(|email| email.address.clone()),
        is_current_user: false,
        status: convert_attendee_status(attendee),
        role: convert_attendee_role(attendee.type_.as_ref()),
    }
}

fn convert_attendee_status(attendee: &Attendee) -> AttendeeStatus {
    match attendee
        .status
        .as_ref()
        .and_then(|status| status.response.as_ref())
    {
        Some(ResponseType::Accepted) | Some(ResponseType::Organizer) => AttendeeStatus::Accepted,
        Some(ResponseType::TentativelyAccepted) => AttendeeStatus::Tentative,
        Some(ResponseType::Declined) => AttendeeStatus::Declined,
        _ => AttendeeStatus::Pending,
    }
}

fn convert_attendee_role(role: Option<&AttendeeType>) -> AttendeeRole {
    match role {
        Some(AttendeeType::Optional) => AttendeeRole::Optional,
        Some(AttendeeType::Resource) => AttendeeRole::NonParticipant,
        _ => AttendeeRole::Required,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A `calendarView` item as Graph actually returns it, with the `$select`
    /// this integration asks for.
    fn graph_event(start: serde_json::Value, end: serde_json::Value, all_day: bool) -> Event {
        serde_json::from_value(json!({
            "id": "AAMkADAwATM0MDAAMS0yNzY1LWJmNjEtMDACLTAwCgBGAAAD",
            "iCalUId": "040000008200E00074C5B7101A82E0080000000",
            "subject": "Weekly sync",
            "bodyPreview": "Join here",
            "body": {
                "contentType": "html",
                "content": "<p>Join Zoom Meeting<br/>https://anarlog.zoom.us/j/86746313244</p>"
            },
            "start": start,
            "end": end,
            "location": { "displayName": "Conference room 4" },
            "attendees": [
                {
                    "type": "required",
                    "status": { "response": "accepted", "time": "2026-06-01T09:00:00Z" },
                    "emailAddress": { "name": "Ada", "address": "ada@example.com" }
                },
                {
                    "type": "optional",
                    "status": { "response": "none", "time": "0001-01-01T00:00:00Z" },
                    "emailAddress": { "name": "Grace", "address": "grace@example.com" }
                }
            ],
            "organizer": { "emailAddress": { "name": "Ada", "address": "ada@example.com" } },
            "isAllDay": all_day,
            "isCancelled": false,
            "isOrganizer": true,
            "isOnlineMeeting": false,
            "onlineMeeting": null,
            "onlineMeetingUrl": null,
            "showAs": "busy",
            "type": "singleInstance",
            "webLink": "https://outlook.office365.com/owa/?itemid=AAMk&exvsurl=1",
            "recurrence": null,
            "seriesMasterId": null
        }))
        .unwrap()
    }

    fn convert_one(event: Event) -> CalendarEvent {
        let mut converted = convert_events(vec![event], "cal-1");
        assert_eq!(converted.len(), 1, "the event should not have been dropped");
        converted.remove(0)
    }

    #[test]
    fn utc_honoured_lands_on_the_time_graph_reported() {
        let converted = convert_one(graph_event(
            json!({ "dateTime": "2026-06-15T10:00:00.0000000", "timeZone": "UTC" }),
            json!({ "dateTime": "2026-06-15T11:00:00.0000000", "timeZone": "UTC" }),
            false,
        ));

        assert_eq!(converted.started_at, "2026-06-15T10:00:00+00:00");
        assert_eq!(converted.ended_at, "2026-06-15T11:00:00+00:00");
        assert_eq!(converted.timezone.as_deref(), Some("UTC"));
        assert!(!converted.is_all_day);
    }

    #[test]
    fn a_mailbox_zone_fallback_does_not_shift_the_meeting() {
        // Same event, but Graph ignored Prefer: outlook.timezone="UTC" and
        // answered in the mailbox's zone. Reading the string as UTC would put
        // this meeting two hours late — the reported symptom.
        let converted = convert_one(graph_event(
            json!({
                "dateTime": "2026-06-15T12:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            json!({
                "dateTime": "2026-06-15T13:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            false,
        ));

        assert_eq!(converted.started_at, "2026-06-15T10:00:00+00:00");
        assert_eq!(converted.ended_at, "2026-06-15T11:00:00+00:00");
        assert_eq!(converted.timezone.as_deref(), Some("Europe/Berlin"));
    }

    #[test]
    fn the_two_answers_describe_the_same_meeting() {
        let honoured = convert_one(graph_event(
            json!({ "dateTime": "2026-06-15T10:00:00.0000000", "timeZone": "UTC" }),
            json!({ "dateTime": "2026-06-15T11:00:00.0000000", "timeZone": "UTC" }),
            false,
        ));
        let fell_back = convert_one(graph_event(
            json!({
                "dateTime": "2026-06-15T12:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            json!({
                "dateTime": "2026-06-15T13:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            false,
        ));

        assert_eq!(honoured.started_at, fell_back.started_at);
        assert_eq!(honoured.ended_at, fell_back.ended_at);
    }

    #[test]
    fn an_all_day_event_stays_on_its_day() {
        // Graph encodes all-day boundaries as midnight in whichever zone it
        // answered in, and its end is the exclusive next midnight.
        let converted = convert_one(graph_event(
            json!({
                "dateTime": "2026-06-15T00:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            json!({
                "dateTime": "2026-06-16T00:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            true,
        ));

        assert!(converted.is_all_day);
        assert_eq!(converted.started_at, "2026-06-15T00:00:00+00:00");
        assert_eq!(converted.ended_at, "2026-06-16T00:00:00+00:00");
    }

    #[test]
    fn an_event_crossing_the_dst_boundary_keeps_its_wall_clock_length() {
        // 23:30 CEST on the night the clocks go back, running two wall-clock
        // hours into 01:30 CET — three real hours.
        let converted = convert_one(graph_event(
            json!({
                "dateTime": "2026-10-24T23:30:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            json!({
                "dateTime": "2026-10-25T02:30:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            false,
        ));

        assert_eq!(converted.started_at, "2026-10-24T21:30:00+00:00");
        assert_eq!(converted.ended_at, "2026-10-25T00:30:00+00:00");
    }

    #[test]
    fn an_event_after_the_dst_boundary_uses_the_winter_offset() {
        let converted = convert_one(graph_event(
            json!({
                "dateTime": "2026-10-26T10:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            json!({
                "dateTime": "2026-10-26T11:00:00.0000000",
                "timeZone": "W. Europe Standard Time"
            }),
            false,
        ));

        assert_eq!(converted.started_at, "2026-10-26T09:00:00+00:00");
        assert_eq!(converted.ended_at, "2026-10-26T10:00:00+00:00");
    }

    #[test]
    fn an_unresolvable_event_is_dropped_not_mistimed() {
        let event = graph_event(
            json!({ "dateTime": "2026-06-15T10:00:00.0000000", "timeZone": "tzone://Microsoft/Custom" }),
            json!({ "dateTime": "2026-06-15T11:00:00.0000000", "timeZone": "tzone://Microsoft/Custom" }),
            false,
        );

        assert!(convert_events(vec![event], "cal-1").is_empty());
    }

    #[test]
    fn carries_the_rest_of_the_event_across() {
        let converted = convert_one(graph_event(
            json!({ "dateTime": "2026-06-15T10:00:00.0000000", "timeZone": "UTC" }),
            json!({ "dateTime": "2026-06-15T11:00:00.0000000", "timeZone": "UTC" }),
            false,
        ));

        assert_eq!(converted.provider, CalendarProviderType::Microsoft);
        assert_eq!(converted.calendar_id, "cal-1");
        assert_eq!(converted.title, "Weekly sync");
        assert_eq!(converted.status, EventStatus::Confirmed);
        assert_eq!(converted.location.as_deref(), Some("Conference room 4"));
        assert_eq!(
            converted.meeting_link.as_deref(),
            Some("https://anarlog.zoom.us/j/86746313244")
        );
        assert_eq!(
            converted.organizer.unwrap().email.unwrap(),
            "ada@example.com"
        );
        assert_eq!(converted.attendees.len(), 2);
        assert_eq!(converted.attendees[0].status, AttendeeStatus::Accepted);
        assert_eq!(converted.attendees[0].role, AttendeeRole::Required);
        assert_eq!(converted.attendees[1].status, AttendeeStatus::Pending);
        assert_eq!(converted.attendees[1].role, AttendeeRole::Optional);
        assert!(!converted.has_recurrence_rules);
    }

    #[test]
    fn a_teams_join_url_wins_over_a_link_in_the_body() {
        let mut event = graph_event(
            json!({ "dateTime": "2026-06-15T10:00:00.0000000", "timeZone": "UTC" }),
            json!({ "dateTime": "2026-06-15T11:00:00.0000000", "timeZone": "UTC" }),
            false,
        );
        event.is_online_meeting = Some(true);
        event.online_meeting = Some(
            serde_json::from_value(json!({
                "joinUrl": "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc"
            }))
            .unwrap(),
        );

        assert_eq!(
            convert_one(event).meeting_link.as_deref(),
            Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc")
        );
    }

    #[test]
    fn converts_a_calendar_list_the_way_graph_returns_it() {
        let calendars: Vec<Calendar> = serde_json::from_value(json!([{
            "id": "AAMkADAwATM0MDAAMS0yNzY1LWJmNjEA",
            "name": "Calendar",
            "color": "auto",
            "hexColor": "#0078d4",
            "isDefaultCalendar": true,
            "canEdit": true,
            "owner": { "name": "Ada Lovelace", "address": "ada@example.com" }
        }]))
        .unwrap();

        let converted = convert_calendars(calendars);

        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].provider, CalendarProviderType::Microsoft);
        assert_eq!(converted[0].title, "Calendar");
        assert_eq!(converted[0].source.as_deref(), Some("Ada Lovelace"));
        assert_eq!(converted[0].is_primary, Some(true));
        assert_eq!(converted[0].can_edit, Some(true));
    }
}
