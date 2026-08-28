//! Microsoft 365 calendar, read directly from Microsoft Graph.
//!
//! There is no broker in this path: the app holds its own Azure App
//! Registration, signs the user in with PKCE, and calls
//! `graph.microsoft.com` itself.

pub mod config;
mod convert;
mod graph;
mod oauth;
pub mod time;
pub mod token;

use anlg_calendar_interface::{CalendarEvent, CalendarListItem, EventFilter};
use chrono::{DateTime, Utc};

use crate::Error;

pub use oauth::{
    access_token, complete_login, disconnect, is_callback_url, is_connected, start_login,
};
pub use token::TokenStore;

pub async fn list_calendars(tokens: &dyn TokenStore) -> Result<Vec<CalendarListItem>, Error> {
    let token = access_token(tokens).await?;
    Ok(convert::convert_calendars(
        graph::list_calendars(&token).await?,
    ))
}

pub async fn list_events(
    tokens: &dyn TokenStore,
    filter: EventFilter,
) -> Result<Vec<CalendarEvent>, Error> {
    let token = access_token(tokens).await?;
    let calendar_id = filter.calendar_tracking_id.clone();
    let (events, preference_applied) =
        graph::list_calendar_view(&token, &calendar_id, filter.from, filter.to).await?;

    if !time::utc_preference_applied(preference_applied.as_deref()) {
        // Not an error: each event carries the zone Graph actually used, and
        // that is what the conversion honours. Worth saying out loud because it
        // is the condition the raw dump exists to confirm.
        tracing::info!(
            preference_applied = preference_applied.as_deref().unwrap_or("<none>"),
            "microsoft_calendar_view_not_in_utc"
        );
    }

    Ok(convert::convert_events(events, &calendar_id))
}

/// One raw, unparsed `calendarView` response with its headers, so the tenant's
/// actual behaviour can be inspected instead of inferred.
pub async fn dump_calendar_view(
    tokens: &dyn TokenStore,
    calendar_id: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<String, Error> {
    let token = access_token(tokens).await?;
    let response = graph::raw_calendar_view(&token, calendar_id, from, to).await?;
    let preference_applied = response.preference_applied.clone();

    let dump = serde_json::json!({
        "request_url": response.url,
        "status": response.status,
        "prefer_header_sent": "outlook.timezone=\"UTC\"",
        "preference_applied": preference_applied,
        "utc_preference_honoured": time::utc_preference_applied(preference_applied.as_deref()),
        "body": serde_json::from_str::<serde_json::Value>(&response.body)
            .unwrap_or_else(|_| serde_json::Value::String(response.body.clone())),
    });

    serde_json::to_string_pretty(&dump)
        .map_err(|error| Error::MicrosoftGraph(format!("could not render the dump: {error}")))
}
