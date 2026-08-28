use chrono::{DateTime, Utc};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum CalendarProviderType {
    Apple,
    /// Microsoft 365 / Outlook.com, read directly from Microsoft Graph.
    Microsoft,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EventFilter {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    pub calendar_tracking_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct CalendarListItem {
    pub provider: CalendarProviderType,
    pub id: String,
    pub title: String,
    pub source: Option<String>,
    pub color: Option<String>,
    pub is_primary: Option<bool>,
    pub can_edit: Option<bool>,
    pub raw: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct CreateEventInput {
    pub calendar_tracking_id: String,
    pub title: String,
    pub started_at: String,
    pub ended_at: String,
    pub is_all_day: Option<bool>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct CalendarEvent {
    pub provider: CalendarProviderType,

    /// Unique between events. Synthesized from eventIdentifier:YYYY-MM-DD for recurring events.
    pub id: String,
    /// Calendar id.
    pub calendar_id: String,

    /// iCal identifier used for deduplication (calendarItemExternalIdentifier).
    pub external_id: String,

    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub url: Option<String>,
    /// Parsed from the event notes.
    pub meeting_link: Option<String>,

    /// ISO 8601.
    pub started_at: String,
    /// ISO 8601.
    pub ended_at: String,
    pub timezone: Option<String>,
    pub is_all_day: bool,

    /// Apple: None | Confirmed | Tentative | Canceled -> map None to Confirmed.
    pub status: EventStatus,
    // Possibly availability/transparency in the future?
    // Apple: Busy | Free | Tentative | Unavailable.
    pub organizer: Option<EventPerson>,
    pub attendees: Vec<EventAttendee>,

    // Hopefully we don't have to handle recurrence info directly in the forseeable future.
    // Apple: recurrenceRules (parsed and structured)
    pub has_recurrence_rules: bool,
    /// The recurrence's series_identifier, the same across all occurrences of a recurring event.
    pub recurring_event_id: Option<String>,

    /// Raw data, as JSON.
    pub raw: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum EventStatus {
    Confirmed,
    Tentative,
    Cancelled,
}

/// Apple: {name, email, isCurrentUser, ...}.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EventPerson {
    pub name: Option<String>,
    /// Apple calendar events only provide a contact entry, which can possibly not have an email.
    pub email: Option<String>,
    /// Apple: participant.isCurrentUser.
    pub is_current_user: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct EventAttendee {
    pub name: Option<String>,
    /// Apple calendar events only provide a contact entry, which can possibly not have an email.
    pub email: Option<String>,
    /// Apple: participant.isCurrentUser.
    pub is_current_user: bool,
    /// Apple: EKParticipantStatus (Unknown | Pending | Accepted | Declined | Tentative | Delegated | Completed | InProgress).
    /// Normalize: unknown -> Pending, delegated/completed/inProgress -> Accepted.
    pub status: AttendeeStatus,
    /// Apple: EKParticipantRole (Unknown | Required | Optional | Chair | NonParticipant).
    /// Normalize unknown as required (see RFC 5545 3.2.16).
    pub role: AttendeeRole,
    // No type field (room/resource/group). For future reference: Apple EKParticipantType.
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum AttendeeStatus {
    #[default]
    Pending,
    Accepted,
    Tentative,
    Declined,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum AttendeeRole {
    Chair,
    #[default]
    Required,
    Optional,
    NonParticipant,
}
