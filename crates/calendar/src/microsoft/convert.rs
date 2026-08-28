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
