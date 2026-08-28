//! Turning Microsoft Graph's `dateTime` + `timeZone` pairs into real instants.
//!
//! Graph does not return offsets on event start/end. It returns a naive
//! wall-clock string plus a separate zone label, and the label is the only
//! thing that says what that wall clock means. Two things make this easy to get
//! wrong, and both have bitten this integration before:
//!
//! 1. `Prefer: outlook.timezone="UTC"` is a request, not a guarantee. Graph
//!    reports what it actually applied in the `Preference-Applied` response
//!    header, and on fallback it answers in the mailbox's own zone. Stamping a
//!    `Z` on the string because UTC was *asked for* shifts every event by that
//!    mailbox's offset. So the per-event `timeZone` is honoured here, and the
//!    header is only a diagnostic.
//! 2. All-day events are dates, not instants. Graph encodes them as midnight in
//!    whichever zone it answered in; converting that midnight to UTC from a
//!    zone east of Greenwich moves the event to the previous day. Their date
//!    component is identical in either zone, so it is taken directly.
//!
//! Graph labels zones with Windows identifiers ("W. Europe Standard Time"), not
//! IANA names, so anything other than UTC needs the mapping below.

use chrono::{DateTime, Duration, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;

use crate::Error;

/// CLDR `windowsZones` golden-territory ("001") mappings, which is the form
/// Graph emits. Every value is asserted to be a real IANA zone by the tests.
const WINDOWS_TO_IANA: &[(&str, &str)] = &[
    ("Afghanistan Standard Time", "Asia/Kabul"),
    ("Alaskan Standard Time", "America/Anchorage"),
    ("Aleutian Standard Time", "America/Adak"),
    ("Altai Standard Time", "Asia/Barnaul"),
    ("Arab Standard Time", "Asia/Riyadh"),
    ("Arabian Standard Time", "Asia/Dubai"),
    ("Arabic Standard Time", "Asia/Baghdad"),
    ("Argentina Standard Time", "America/Argentina/Buenos_Aires"),
    ("Astrakhan Standard Time", "Europe/Astrakhan"),
    ("Atlantic Standard Time", "America/Halifax"),
    ("AUS Central Standard Time", "Australia/Darwin"),
    ("Aus Central W. Standard Time", "Australia/Eucla"),
    ("AUS Eastern Standard Time", "Australia/Sydney"),
    ("Azerbaijan Standard Time", "Asia/Baku"),
    ("Azores Standard Time", "Atlantic/Azores"),
    ("Bahia Standard Time", "America/Bahia"),
    ("Bangladesh Standard Time", "Asia/Dhaka"),
    ("Belarus Standard Time", "Europe/Minsk"),
    ("Bougainville Standard Time", "Pacific/Bougainville"),
    ("Canada Central Standard Time", "America/Regina"),
    ("Cape Verde Standard Time", "Atlantic/Cape_Verde"),
    ("Caucasus Standard Time", "Asia/Yerevan"),
    ("Cen. Australia Standard Time", "Australia/Adelaide"),
    ("Central America Standard Time", "America/Guatemala"),
    ("Central Asia Standard Time", "Asia/Almaty"),
    ("Central Brazilian Standard Time", "America/Cuiaba"),
    ("Central Europe Standard Time", "Europe/Budapest"),
    ("Central European Standard Time", "Europe/Warsaw"),
    ("Central Pacific Standard Time", "Pacific/Guadalcanal"),
    ("Central Standard Time", "America/Chicago"),
    ("Central Standard Time (Mexico)", "America/Mexico_City"),
    ("Chatham Islands Standard Time", "Pacific/Chatham"),
    ("China Standard Time", "Asia/Shanghai"),
    ("Cuba Standard Time", "America/Havana"),
    ("Dateline Standard Time", "Etc/GMT+12"),
    ("E. Africa Standard Time", "Africa/Nairobi"),
    ("E. Australia Standard Time", "Australia/Brisbane"),
    ("E. Europe Standard Time", "Europe/Chisinau"),
    ("E. South America Standard Time", "America/Sao_Paulo"),
    ("Easter Island Standard Time", "Pacific/Easter"),
    ("Eastern Standard Time", "America/New_York"),
    ("Eastern Standard Time (Mexico)", "America/Cancun"),
    ("Egypt Standard Time", "Africa/Cairo"),
    ("Ekaterinburg Standard Time", "Asia/Yekaterinburg"),
    ("Fiji Standard Time", "Pacific/Fiji"),
    ("FLE Standard Time", "Europe/Kyiv"),
    ("Georgian Standard Time", "Asia/Tbilisi"),
    ("GMT Standard Time", "Europe/London"),
    ("Greenland Standard Time", "America/Nuuk"),
    ("Greenwich Standard Time", "Atlantic/Reykjavik"),
    ("GTB Standard Time", "Europe/Bucharest"),
    ("Haiti Standard Time", "America/Port-au-Prince"),
    ("Hawaiian Standard Time", "Pacific/Honolulu"),
    ("India Standard Time", "Asia/Kolkata"),
    ("Iran Standard Time", "Asia/Tehran"),
    ("Israel Standard Time", "Asia/Jerusalem"),
    ("Jordan Standard Time", "Asia/Amman"),
    ("Kaliningrad Standard Time", "Europe/Kaliningrad"),
    ("Korea Standard Time", "Asia/Seoul"),
    ("Libya Standard Time", "Africa/Tripoli"),
    ("Line Islands Standard Time", "Pacific/Kiritimati"),
    ("Lord Howe Standard Time", "Australia/Lord_Howe"),
    ("Magadan Standard Time", "Asia/Magadan"),
    ("Magallanes Standard Time", "America/Punta_Arenas"),
    ("Marquesas Standard Time", "Pacific/Marquesas"),
    ("Mauritius Standard Time", "Indian/Mauritius"),
    ("Middle East Standard Time", "Asia/Beirut"),
    ("Montevideo Standard Time", "America/Montevideo"),
    ("Morocco Standard Time", "Africa/Casablanca"),
    ("Mountain Standard Time", "America/Denver"),
    ("Mountain Standard Time (Mexico)", "America/Mazatlan"),
    ("Myanmar Standard Time", "Asia/Yangon"),
    ("N. Central Asia Standard Time", "Asia/Novosibirsk"),
    ("Namibia Standard Time", "Africa/Windhoek"),
    ("Nepal Standard Time", "Asia/Kathmandu"),
    ("New Zealand Standard Time", "Pacific/Auckland"),
    ("Newfoundland Standard Time", "America/St_Johns"),
    ("Norfolk Standard Time", "Pacific/Norfolk"),
    ("North Asia East Standard Time", "Asia/Irkutsk"),
    ("North Asia Standard Time", "Asia/Krasnoyarsk"),
    ("North Korea Standard Time", "Asia/Pyongyang"),
    ("Omsk Standard Time", "Asia/Omsk"),
    ("Pacific SA Standard Time", "America/Santiago"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("Pacific Standard Time (Mexico)", "America/Tijuana"),
    ("Pakistan Standard Time", "Asia/Karachi"),
    ("Paraguay Standard Time", "America/Asuncion"),
    ("Qyzylorda Standard Time", "Asia/Qyzylorda"),
    ("Romance Standard Time", "Europe/Paris"),
    ("Russia Time Zone 10", "Asia/Srednekolymsk"),
    ("Russia Time Zone 11", "Asia/Kamchatka"),
    ("Russia Time Zone 3", "Europe/Samara"),
    ("Russian Standard Time", "Europe/Moscow"),
    ("SA Eastern Standard Time", "America/Cayenne"),
    ("SA Pacific Standard Time", "America/Bogota"),
    ("SA Western Standard Time", "America/La_Paz"),
    ("Saint Pierre Standard Time", "America/Miquelon"),
    ("Sakhalin Standard Time", "Asia/Sakhalin"),
    ("Samoa Standard Time", "Pacific/Apia"),
    ("Sao Tome Standard Time", "Africa/Sao_Tome"),
    ("Saratov Standard Time", "Europe/Saratov"),
    ("SE Asia Standard Time", "Asia/Bangkok"),
    ("Singapore Standard Time", "Asia/Singapore"),
    ("South Africa Standard Time", "Africa/Johannesburg"),
    ("Sri Lanka Standard Time", "Asia/Colombo"),
    ("Sudan Standard Time", "Africa/Khartoum"),
    ("Syria Standard Time", "Asia/Damascus"),
    ("Taipei Standard Time", "Asia/Taipei"),
    ("Tasmania Standard Time", "Australia/Hobart"),
    ("Tocantins Standard Time", "America/Araguaina"),
    ("Tokyo Standard Time", "Asia/Tokyo"),
    ("Tomsk Standard Time", "Asia/Tomsk"),
    ("Tonga Standard Time", "Pacific/Tongatapu"),
    ("Transbaikal Standard Time", "Asia/Chita"),
    ("Turkey Standard Time", "Europe/Istanbul"),
    ("Turks And Caicos Standard Time", "America/Grand_Turk"),
    ("Ulaanbaatar Standard Time", "Asia/Ulaanbaatar"),
    ("US Eastern Standard Time", "America/Indiana/Indianapolis"),
    ("US Mountain Standard Time", "America/Phoenix"),
    ("UTC", "Etc/UTC"),
    ("UTC+12", "Etc/GMT-12"),
    ("UTC+13", "Etc/GMT-13"),
    ("UTC-02", "Etc/GMT+2"),
    ("UTC-08", "Etc/GMT+8"),
    ("UTC-09", "Etc/GMT+9"),
    ("UTC-11", "Etc/GMT+11"),
    ("Venezuela Standard Time", "America/Caracas"),
    ("Vladivostok Standard Time", "Asia/Vladivostok"),
    ("Volgograd Standard Time", "Europe/Volgograd"),
    ("W. Australia Standard Time", "Australia/Perth"),
    ("W. Central Africa Standard Time", "Africa/Lagos"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("W. Mongolia Standard Time", "Asia/Hovd"),
    ("West Asia Standard Time", "Asia/Tashkent"),
    ("West Bank Standard Time", "Asia/Hebron"),
    ("West Pacific Standard Time", "Pacific/Port_Moresby"),
    ("Yakutsk Standard Time", "Asia/Yakutsk"),
    ("Yukon Standard Time", "America/Whitehorse"),
];

/// True when Graph confirms it answered in UTC. Absent or different means the
/// mailbox's own zone came back instead, which is a supported answer here — the
/// header only tells the reader which of the two happened.
pub fn utc_preference_applied(header: Option<&str>) -> bool {
    let Some(header) = header else {
        return false;
    };

    header.split(',').any(|preference| {
        let Some((name, value)) = preference.split_once('=') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case("outlook.timezone")
            && value.trim().trim_matches('"').eq_ignore_ascii_case("UTC")
    })
}

/// Resolve a Graph zone label to a real zone. Accepts the UTC sentinel, Windows
/// identifiers and IANA names; refuses anything else rather than defaulting.
pub fn resolve_time_zone(label: &str) -> Result<Tz, Error> {
    let label = label.trim();

    if label.eq_ignore_ascii_case("UTC") || label.eq_ignore_ascii_case("tzone://Microsoft/Utc") {
        return Ok(Tz::UTC);
    }

    if let Some((_, iana)) = WINDOWS_TO_IANA
        .iter()
        .find(|(windows, _)| windows.eq_ignore_ascii_case(label))
    {
        return iana.parse::<Tz>().map_err(|error| {
            Error::MicrosoftGraph(format!("unusable IANA mapping '{iana}': {error}"))
        });
    }

    // Graph occasionally answers with an IANA name directly, e.g. when the
    // mailbox was configured through a non-Windows client.
    label.parse::<Tz>().map_err(|_| {
        Error::MicrosoftGraph(format!(
            "unrecognised Microsoft time zone '{label}'; refusing to guess an offset"
        ))
    })
}

/// Convert a Graph `dateTime` + `timeZone` pair into a UTC instant.
///
/// Only for timed events. All-day events must go through [`all_day_instant`].
pub fn timed_instant(date_time: &str, time_zone: Option<&str>) -> Result<DateTime<Utc>, Error> {
    // Graph normally omits the offset, but a few surfaces return a fully
    // qualified instant; when it does, that is authoritative.
    if let Ok(parsed) = DateTime::parse_from_rfc3339(date_time) {
        return Ok(parsed.with_timezone(&Utc));
    }

    let naive = parse_naive(date_time)?;
    let label = time_zone.map(str::trim).filter(|label| !label.is_empty());
    let Some(label) = label else {
        return Err(Error::MicrosoftGraph(format!(
            "Graph returned '{date_time}' with no timeZone; refusing to assume UTC"
        )));
    };
    let zone = resolve_time_zone(label)?;

    match zone.from_local_datetime(&naive) {
        chrono::LocalResult::Single(instant) => Ok(instant.with_timezone(&Utc)),
        // Autumn fall-back: the wall clock happens twice. Outlook shows the
        // first occurrence, which is the one still on summer time.
        chrono::LocalResult::Ambiguous(earlier, _) => Ok(earlier.with_timezone(&Utc)),
        // Spring-forward gap: the wall clock never happens. Shift by the hour
        // that was skipped rather than failing an otherwise valid event.
        chrono::LocalResult::None => zone
            .from_local_datetime(&(naive + Duration::hours(1)))
            .earliest()
            .map(|instant| instant.with_timezone(&Utc))
            .ok_or_else(|| {
                Error::MicrosoftGraph(format!(
                    "'{date_time}' does not exist in {label} and could not be adjusted"
                ))
            }),
    }
}

/// The start of an all-day event, as midnight UTC on its calendar date.
///
/// The date component is what an all-day event actually means, and it reads the
/// same whether Graph answered in UTC or in the mailbox's zone — which is
/// exactly why converting the midnight instead would move the event a day.
pub fn all_day_instant(date_time: &str) -> Result<DateTime<Utc>, Error> {
    let naive = parse_naive(date_time).or_else(|error| {
        DateTime::parse_from_rfc3339(date_time)
            .map(|parsed| parsed.naive_utc())
            .map_err(|_| error)
    })?;

    Ok(naive
        .date()
        .and_hms_opt(0, 0, 0)
        .expect("midnight")
        .and_utc())
}

fn parse_naive(value: &str) -> Result<NaiveDateTime, Error> {
    // Graph pads to seven fractional digits ("2026-06-15T10:00:00.0000000") but
    // sometimes sends none at all.
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S"))
        .map_err(|error| {
            Error::MicrosoftGraph(format!("unparseable Graph dateTime '{value}': {error}"))
        })
}

/// The IANA name a Graph zone label resolves to, for `CalendarEvent.timezone`.
/// Falls back to the raw label so an unmapped zone is still visible downstream.
pub fn iana_name(label: &str) -> String {
    resolve_time_zone(label)
        .map(|zone| zone.name().to_string())
        .unwrap_or_else(|_| label.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    // --- the Windows -> IANA table itself ---

    #[test]
    fn every_windows_mapping_names_a_real_zone() {
        for (windows, iana) in WINDOWS_TO_IANA {
            assert!(
                iana.parse::<Tz>().is_ok(),
                "{windows} maps to {iana}, which is not an IANA zone"
            );
        }
    }

    #[test]
    fn the_table_has_no_duplicate_windows_names() {
        let mut seen = std::collections::HashSet::new();
        for (windows, _) in WINDOWS_TO_IANA {
            assert!(seen.insert(*windows), "{windows} appears twice");
        }
    }

    #[test]
    fn resolves_the_labels_graph_actually_sends() {
        assert_eq!(resolve_time_zone("UTC").unwrap(), Tz::UTC);
        assert_eq!(resolve_time_zone("tzone://Microsoft/Utc").unwrap(), Tz::UTC);
        assert_eq!(
            resolve_time_zone("W. Europe Standard Time").unwrap(),
            Tz::Europe__Berlin
        );
        assert_eq!(
            resolve_time_zone("Pacific Standard Time").unwrap(),
            Tz::America__Los_Angeles
        );
        // Mailboxes configured outside Windows can come back as IANA already.
        assert_eq!(
            resolve_time_zone("Europe/Berlin").unwrap(),
            Tz::Europe__Berlin
        );
    }

    #[test]
    fn refuses_to_guess_at_an_unknown_zone() {
        // Silently defaulting an unrecognised label to UTC is exactly how a
        // whole mailbox ends up shifted, so this must stay an error.
        let error = resolve_time_zone("tzone://Microsoft/Custom").unwrap_err();
        assert!(error.to_string().contains("refusing to guess"));
        assert!(resolve_time_zone("Nowhere Standard Time").is_err());
    }

    // --- Preference-Applied ---

    #[test]
    fn reads_preference_applied_the_way_graph_writes_it() {
        assert!(utc_preference_applied(Some("outlook.timezone=\"UTC\"")));
        assert!(utc_preference_applied(Some(
            "odata.include-annotations, outlook.timezone=\"UTC\""
        )));
        assert!(utc_preference_applied(Some("outlook.timezone=UTC")));
        assert!(utc_preference_applied(Some("Outlook.Timezone=\"utc\"")));
    }

    #[test]
    fn a_fallback_to_the_mailbox_zone_is_not_a_utc_preference() {
        // The header Graph sends when it did NOT honour the request.
        assert!(!utc_preference_applied(Some(
            "outlook.timezone=\"W. Europe Standard Time\""
        )));
        assert!(!utc_preference_applied(Some("odata.maxpagesize=100")));
        assert!(!utc_preference_applied(None));
    }

    // --- timed events ---

    #[test]
    fn honours_utc_when_graph_applied_the_preference() {
        assert_eq!(
            timed_instant("2026-06-15T10:00:00.0000000", Some("UTC")).unwrap(),
            utc("2026-06-15T10:00:00Z")
        );
    }

    #[test]
    fn honours_the_mailbox_zone_when_graph_fell_back() {
        // The reported bug: the predecessor stamped a Z on this string and put
        // the meeting at 10:00Z, two hours late. W. Europe is on CEST in June.
        assert_eq!(
            timed_instant(
                "2026-06-15T10:00:00.0000000",
                Some("W. Europe Standard Time")
            )
            .unwrap(),
            utc("2026-06-15T08:00:00Z")
        );
    }

    #[test]
    fn the_same_wall_clock_moves_across_a_dst_boundary() {
        // Europe/Berlin leaves summer time on 2026-10-25. A fixed offset — for
        // this zone or any other — gets exactly one of these two wrong.
        let before = timed_instant(
            "2026-10-24T10:00:00.0000000",
            Some("W. Europe Standard Time"),
        )
        .unwrap();
        let after = timed_instant(
            "2026-10-26T10:00:00.0000000",
            Some("W. Europe Standard Time"),
        )
        .unwrap();

        assert_eq!(before, utc("2026-10-24T08:00:00Z"));
        assert_eq!(after, utc("2026-10-26T09:00:00Z"));
        assert_ne!(
            before.signed_duration_since(after).num_hours() % 24,
            0,
            "the two wall clocks must not map to the same offset"
        );
    }

    #[test]
    fn an_ambiguous_wall_clock_takes_the_first_occurrence() {
        // 02:30 happens twice on the night the clocks go back; Outlook shows
        // the summer-time one.
        assert_eq!(
            timed_instant(
                "2026-10-25T02:30:00.0000000",
                Some("W. Europe Standard Time")
            )
            .unwrap(),
            utc("2026-10-25T00:30:00Z")
        );
    }

    #[test]
    fn a_wall_clock_inside_the_spring_gap_is_nudged_past_it() {
        // 02:30 never happens on 2026-03-29; failing the event would be worse
        // than moving it to the first instant that does exist.
        assert_eq!(
            timed_instant(
                "2026-03-29T02:30:00.0000000",
                Some("W. Europe Standard Time")
            )
            .unwrap(),
            utc("2026-03-29T01:30:00Z")
        );
    }

    #[test]
    fn accepts_a_fully_qualified_instant_when_graph_sends_one() {
        assert_eq!(
            timed_instant("2026-06-15T10:00:00Z", Some("UTC")).unwrap(),
            utc("2026-06-15T10:00:00Z")
        );
        assert_eq!(
            timed_instant("2026-06-15T12:00:00+02:00", None).unwrap(),
            utc("2026-06-15T10:00:00Z")
        );
    }

    #[test]
    fn refuses_a_naive_datetime_with_no_zone() {
        let error = timed_instant("2026-06-15T10:00:00.0000000", None).unwrap_err();
        assert!(error.to_string().contains("refusing to assume UTC"));
        assert!(timed_instant("2026-06-15T10:00:00.0000000", Some("  ")).is_err());
    }

    #[test]
    fn parses_graph_datetimes_with_and_without_fractional_seconds() {
        assert_eq!(
            timed_instant("2026-06-15T10:00:00", Some("UTC")).unwrap(),
            utc("2026-06-15T10:00:00Z")
        );
        assert!(timed_instant("15 June 2026", Some("UTC")).is_err());
    }

    // --- all-day events ---

    #[test]
    fn an_all_day_event_keeps_its_date_in_utc() {
        assert_eq!(
            all_day_instant("2026-06-15T00:00:00.0000000").unwrap(),
            utc("2026-06-15T00:00:00Z")
        );
    }

    #[test]
    fn an_all_day_event_keeps_its_date_after_a_fallback_too() {
        // The same midnight, whichever zone Graph answered in. Reading it as a
        // W. Europe instant would land on 2026-06-14T22:00Z and show the event
        // on the wrong day.
        let honoured = all_day_instant("2026-06-15T00:00:00.0000000").unwrap();
        let fell_back = all_day_instant("2026-06-15T00:00:00.0000000").unwrap();
        let as_an_instant = timed_instant(
            "2026-06-15T00:00:00.0000000",
            Some("W. Europe Standard Time"),
        )
        .unwrap();

        assert_eq!(honoured, fell_back);
        assert_eq!(honoured, utc("2026-06-15T00:00:00Z"));
        assert_eq!(as_an_instant, utc("2026-06-14T22:00:00Z"));
        assert_ne!(
            honoured.date_naive(),
            as_an_instant.date_naive(),
            "this is the day the all-day path exists to avoid losing"
        );
    }

    #[test]
    fn iana_names_are_what_downstream_sees() {
        assert_eq!(iana_name("W. Europe Standard Time"), "Europe/Berlin");
        assert_eq!(iana_name("UTC"), "UTC");
        // Unmapped labels survive rather than vanishing.
        assert_eq!(iana_name("Nowhere Standard Time"), "Nowhere Standard Time");
    }
}
