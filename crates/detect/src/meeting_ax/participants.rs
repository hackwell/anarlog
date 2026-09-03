use super::types::{MeetingApp, MeetingParticipant};

// Teams describes a video tile as comma-separated segments: an optional
// "my own video" prefix, the display name (which itself may be "Last, First"),
// an optional external marker glued to the name, then state phrases such as
// "Video ist ein" or "Stummschaltung aufgehoben". The name is whatever is
// left after the known prefix and every trailing state segment are removed.
const SELF_PREFIXES: &[&str] = &[
    "video von mir selbst",
    "video of myself",
    "mein video",
    "my video",
];
const EXTERNAL_MARKERS: &[&str] = &[
    "extern unbekannt",
    "external unknown",
    "(extern)",
    "(external)",
    "extern",
    "external",
    "gast",
    "guest",
];
// ponytail: German and English state vocabulary only; other UI languages
// leave state text in the name until their phrases are added here.
const STATE_KEYWORDS: &[&str] = &[
    "video",
    "stumm",
    "mute",
    "kontrolle",
    "control",
    "kontextmen",
    "context menu",
    "frame",
    "rahmen",
    "angeheftet",
    "pinned",
    "hervorgehoben",
    "spotlight",
    "spricht",
    "speaking",
    "hand",
    "erhoben",
    "raised",
    "präsentiert",
    "presenting",
    "teilt",
    "sharing",
];
pub(super) const TILE_ROLES: &[&str] = &["AXImage", "AXMenuItem"];
const MIN_NAME_LETTERS: usize = 3;
const MAX_NAME_SEGMENTS: usize = 3;

pub(super) fn extract_participants<'a>(
    tiles: impl IntoIterator<Item = (&'a str, &'a str)>,
    app: &MeetingApp,
) -> Vec<MeetingParticipant> {
    let mut participants: Vec<MeetingParticipant> = Vec::new();
    for (role, description) in tiles {
        if !TILE_ROLES.contains(&role) {
            continue;
        }
        let Some((name, is_self)) = parse_tile_description(description) else {
            continue;
        };
        if let Some(existing) = participants
            .iter_mut()
            .find(|participant| participant.name.eq_ignore_ascii_case(&name))
        {
            existing.is_self |= is_self;
            continue;
        }
        participants.push(MeetingParticipant {
            name,
            is_self,
            app: app.clone(),
        });
    }
    participants
}

pub(super) fn parse_tile_description(description: &str) -> Option<(String, bool)> {
    let mut segments: Vec<&str> = description
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if segments.is_empty() {
        return None;
    }

    let is_self = SELF_PREFIXES
        .iter()
        .any(|prefix| segments[0].to_lowercase() == *prefix);
    if is_self {
        segments.remove(0);
    }

    while segments
        .last()
        .is_some_and(|segment| is_state_segment(segment))
    {
        segments.pop();
    }
    if segments.is_empty() || segments.len() > MAX_NAME_SEGMENTS {
        return None;
    }
    // Without a self prefix the tile must still have carried state text,
    // otherwise it is some other image or menu item, not a participant.
    if !is_self && segments.len() == description.split(',').count() {
        return None;
    }

    let mut name = segments.join(", ");
    name = strip_external_marker(&name);
    if name.chars().filter(|c| c.is_alphabetic()).count() < MIN_NAME_LETTERS {
        return None;
    }
    Some((name, is_self))
}

fn is_state_segment(segment: &str) -> bool {
    let lower = segment.to_lowercase();
    STATE_KEYWORDS.iter().any(|keyword| lower.contains(keyword))
}

fn strip_external_marker(name: &str) -> String {
    let lower = name.to_lowercase();
    for marker in EXTERNAL_MARKERS {
        if let Some(rest) = lower.strip_suffix(marker) {
            let rest = rest.trim_end();
            return name[..rest.len()].trim_end().to_string();
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn teams() -> MeetingApp {
        MeetingApp {
            id: "com.microsoft.teams2".to_string(),
            name: "Microsoft Teams".to_string(),
        }
    }

    #[test]
    fn reads_the_own_tile_and_a_last_first_name_from_a_german_call() {
        let tiles = [
            (
                "AXImage",
                "Video von mir selbst, Jörg Weller, Hat die Kontrolle über Produktionstools, Stummschaltung aufgehoben, Video ist ein, Frame ausfüllen, Hat Kontextmenü",
            ),
            (
                "AXMenuItem",
                "Gebert, Mattan Extern unbekannt, Video ist ein, Hat die Kontrolle über Produktionstools, Kontextmenü ist verfügbar",
            ),
            ("AXButton", "Mikrofon stummschalten"),
            ("AXStaticText", "Gebert, Mattan"),
        ];
        let participants = extract_participants(tiles, &teams());
        let summary: Vec<(String, bool)> = participants
            .into_iter()
            .map(|p| (p.name, p.is_self))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("Jörg Weller".to_string(), true),
                ("Gebert, Mattan".to_string(), false)
            ]
        );
    }

    #[test]
    fn reads_english_tiles() {
        assert_eq!(
            parse_tile_description("Video of myself, Jane Doe, Unmuted, Video is on"),
            Some(("Jane Doe".to_string(), true))
        );
        assert_eq!(
            parse_tile_description("Smith, John External, Video is off, Has context menu"),
            Some(("Smith, John".to_string(), false))
        );
    }

    #[test]
    fn ignores_images_and_menu_items_without_participant_state() {
        assert_eq!(parse_tile_description("Kamera ausschalten"), None);
        assert_eq!(parse_tile_description("Weitere Optionen"), None);
        assert_eq!(parse_tile_description(""), None);
    }

    #[test]
    fn folds_duplicate_tiles() {
        let tiles = [
            ("AXMenuItem", "Anna Beispiel, Video ist ein"),
            ("AXImage", "Anna Beispiel, Video ist aus, Stummgeschaltet"),
        ];
        assert_eq!(extract_participants(tiles, &teams()).len(), 1);
    }
}
