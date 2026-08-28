//! Direct Microsoft Graph transport.
//!
//! Deliberately not routed through `anlg_http::HttpClient` (which the dormant
//! `outlook-calendar` client uses): that trait hands back a body and nothing
//! else, and the whole point here is to see the `Preference-Applied` response
//! header. The request shapes stay Graph's own, and the response types are
//! reused from `anlg-outlook-calendar`.

use anlg_outlook_calendar::{Calendar, Event, ListCalendarsResponse, ListEventsResponse};
use chrono::{DateTime, Utc};

use crate::Error;
use crate::microsoft::config::GRAPH_BASE_URL;

/// Graph caps `$top` at 1000; a smaller page keeps single responses readable
/// and the dump file manageable.
const PAGE_SIZE: u32 = 100;
/// Guard against a `@odata.nextLink` loop.
const MAX_PAGES: usize = 50;

/// `isAllDay` is in this list on purpose: without it an all-day event is
/// indistinguishable from a midnight meeting, and the conversion for the two is
/// not the same.
const EVENT_SELECT: &str = "id,iCalUId,subject,body,bodyPreview,start,end,location,attendees,\
organizer,isAllDay,isCancelled,isOrganizer,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,showAs,\
type,webLink,recurrence,seriesMasterId";

pub struct GraphResponse {
    pub url: String,
    pub status: u16,
    pub preference_applied: Option<String>,
    pub body: String,
}

async fn get(access_token: &str, url: &str, prefer_utc: bool) -> Result<GraphResponse, Error> {
    let mut request = reqwest::Client::new().get(url).bearer_auth(access_token);
    if prefer_utc {
        // A request, not a guarantee — see microsoft::time.
        request = request.header("Prefer", "outlook.timezone=\"UTC\"");
    }

    let response = request
        .send()
        .await
        .map_err(|error| Error::MicrosoftGraph(format!("request to Graph failed: {error}")))?;

    let status = response.status();
    let preference_applied = response
        .headers()
        .get("Preference-Applied")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .map_err(|error| Error::MicrosoftGraph(format!("Graph response unreadable: {error}")))?;

    if !status.is_success() {
        return Err(Error::MicrosoftGraph(format!(
            "Graph returned {status}: {body}"
        )));
    }

    Ok(GraphResponse {
        url: url.to_string(),
        status: status.as_u16(),
        preference_applied,
        body,
    })
}

pub async fn list_calendars(access_token: &str) -> Result<Vec<Calendar>, Error> {
    let mut url = Some(format!("{GRAPH_BASE_URL}/me/calendars?$top={PAGE_SIZE}"));
    let mut calendars = Vec::new();

    for _ in 0..MAX_PAGES {
        let Some(next) = url.take() else { break };
        let response = get(access_token, &next, false).await?;
        let page: ListCalendarsResponse =
            serde_json::from_str(&response.body).map_err(|error| {
                Error::MicrosoftGraph(format!("unparseable calendar list: {error}"))
            })?;
        calendars.extend(page.value);
        url = page.odata_next_link;
    }

    Ok(calendars)
}

fn calendar_view_url(calendar_id: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> String {
    let base = if calendar_id.trim().is_empty() {
        format!("{GRAPH_BASE_URL}/me/calendar/calendarView")
    } else {
        format!(
            "{GRAPH_BASE_URL}/me/calendars/{}/calendarView",
            urlencoding::encode(calendar_id)
        )
    };

    format!(
        "{base}?startDateTime={}&endDateTime={}&$select={}&$orderby=start/dateTime&$top={PAGE_SIZE}",
        urlencoding::encode(&from.to_rfc3339()),
        urlencoding::encode(&to.to_rfc3339()),
        urlencoding::encode(EVENT_SELECT),
    )
}

/// One unparsed `calendarView` page, headers included, for the diagnostic dump.
pub async fn raw_calendar_view(
    access_token: &str,
    calendar_id: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<GraphResponse, Error> {
    get(
        access_token,
        &calendar_view_url(calendar_id, from, to),
        true,
    )
    .await
}

/// Every event in the window, plus whichever `Preference-Applied` the first
/// page carried.
pub async fn list_calendar_view(
    access_token: &str,
    calendar_id: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<(Vec<Event>, Option<String>), Error> {
    let mut url = Some(calendar_view_url(calendar_id, from, to));
    let mut events = Vec::new();
    let mut preference_applied = None;

    for page_number in 0..MAX_PAGES {
        let Some(next) = url.take() else { break };
        let response = get(access_token, &next, true).await?;
        if page_number == 0 {
            preference_applied = response.preference_applied.clone();
        }
        let page: ListEventsResponse = serde_json::from_str(&response.body)
            .map_err(|error| Error::MicrosoftGraph(format!("unparseable event list: {error}")))?;
        events.extend(page.value);
        url = page.odata_next_link;
    }

    Ok((events, preference_applied))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window() -> (DateTime<Utc>, DateTime<Utc>) {
        (
            "2026-06-15T00:00:00Z".parse().unwrap(),
            "2026-06-16T00:00:00Z".parse().unwrap(),
        )
    }

    #[test]
    fn selects_is_all_day_so_all_day_events_can_be_told_apart() {
        assert!(EVENT_SELECT.split(',').any(|field| field == "isAllDay"));
    }

    #[test]
    fn asks_for_a_specific_calendar_when_one_is_given() {
        let (from, to) = window();
        let url = calendar_view_url("AAMkAD==", from, to);

        assert!(url.contains("/me/calendars/AAMkAD%3D%3D/calendarView"));
        assert!(url.contains("startDateTime=2026-06-15T00%3A00%3A00%2B00%3A00"));
    }

    #[test]
    fn falls_back_to_the_default_calendar() {
        let (from, to) = window();
        assert!(calendar_view_url("", from, to).contains("/me/calendar/calendarView"));
    }
}
