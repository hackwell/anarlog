use tauri::{
    AppHandle, Result,
    menu::{MenuId, MenuItemKind, Submenu},
};
use tauri_plugin_windows::{AppWindow, Navigate, WindowsPluginExt};

use super::{MenuIcon, icon_item};
use crate::ext::scheduled_event;

const ID_PREFIX: &str = "anlg_tray_agenda_";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgendaAction {
    Record,
    JoinAndRecord,
    PrepareNote,
    OpenLink,
}

impl AgendaAction {
    const ALL: [AgendaAction; 4] = [
        AgendaAction::Record,
        AgendaAction::JoinAndRecord,
        AgendaAction::PrepareNote,
        AgendaAction::OpenLink,
    ];

    fn key(self) -> &'static str {
        match self {
            AgendaAction::Record => "record",
            AgendaAction::JoinAndRecord => "join",
            AgendaAction::PrepareNote => "note",
            AgendaAction::OpenLink => "link",
        }
    }

    fn label(self, labels: &crate::schedule::TrayLabels) -> String {
        match self {
            AgendaAction::Record => labels.agenda_record.clone(),
            AgendaAction::JoinAndRecord => labels.agenda_join_and_record.clone(),
            AgendaAction::PrepareNote => labels.agenda_prepare_note.clone(),
            AgendaAction::OpenLink => labels.agenda_open_link.clone(),
        }
    }

    fn icon(self) -> MenuIcon {
        match self {
            AgendaAction::Record => MenuIcon::Record,
            AgendaAction::JoinAndRecord => MenuIcon::Join,
            AgendaAction::PrepareNote => MenuIcon::Note,
            AgendaAction::OpenLink => MenuIcon::Link,
        }
    }

    fn needs_link(self) -> bool {
        matches!(self, AgendaAction::JoinAndRecord | AgendaAction::OpenLink)
    }

    fn records(self) -> bool {
        matches!(self, AgendaAction::Record | AgendaAction::JoinAndRecord)
    }

    fn opens_app(self) -> bool {
        self != AgendaAction::OpenLink
    }
}

fn item_id(action: AgendaAction, event_id: &str) -> String {
    format!("{ID_PREFIX}{}_{event_id}", action.key())
}

fn parse_item_id(id: &str) -> Option<(AgendaAction, &str)> {
    let rest = id.strip_prefix(ID_PREFIX)?;
    AgendaAction::ALL.iter().find_map(|action| {
        rest.strip_prefix(action.key())
            .and_then(|tail| tail.strip_prefix('_'))
            .map(|event_id| (*action, event_id))
    })
}

pub fn build_agenda_item(
    app: &AppHandle<tauri::Wry>,
    event_id: &str,
    text: &str,
    has_meeting_link: bool,
) -> Result<MenuItemKind<tauri::Wry>> {
    let labels = crate::schedule::labels();
    let submenu = Submenu::new(app, text, true)?;
    for action in AgendaAction::ALL {
        if action.needs_link() && !has_meeting_link {
            continue;
        }
        submenu.append(&icon_item(
            app,
            item_id(action, event_id),
            action.label(&labels),
            true,
            action.icon(),
        )?)?;
    }
    Ok(MenuItemKind::Submenu(submenu))
}

pub fn handle_agenda_menu_event(app: &AppHandle<tauri::Wry>, id: &MenuId) -> bool {
    let Some((action, event_id)) = parse_item_id(&id.0) else {
        return false;
    };

    let Some(event) = scheduled_event(event_id) else {
        return true;
    };

    if action.opens_app() && app.windows().show(AppWindow::Main).is_ok() {
        let _ = app.windows().emit_navigate(
            AppWindow::Main,
            event_navigation(event.id, action.records()),
        );
    }

    if action.needs_link()
        && let Some(meeting_link) = event.meeting_link.filter(|link| !link.trim().is_empty())
        && let Err(error) = open::that(meeting_link)
    {
        tracing::warn!(%error, "failed to open meeting from tray agenda");
    }

    true
}

fn event_navigation(event_id: String, record: bool) -> Navigate {
    let mut search = serde_json::Map::new();
    search.insert(
        "calendarEventId".to_string(),
        serde_json::Value::String(event_id),
    );
    if record {
        search.insert(
            "record".to_string(),
            serde_json::Value::String("true".to_string()),
        );
    }

    Navigate {
        path: "/app/new".to_string(),
        search: Some(search),
    }
}

#[cfg(test)]
mod tests {
    use super::{AgendaAction, event_navigation, item_id, parse_item_id};

    #[test]
    fn opens_the_selected_calendar_event_with_recording_enabled() {
        let navigation = event_navigation("event-123".to_string(), true);
        let search = navigation.search.unwrap();

        assert_eq!(navigation.path, "/app/new");
        assert_eq!(search["calendarEventId"], "event-123");
        assert_eq!(search["record"], "true");
    }

    #[test]
    fn prepares_a_note_without_recording() {
        let navigation = event_navigation("event-123".to_string(), false);
        let search = navigation.search.unwrap();

        assert_eq!(search["calendarEventId"], "event-123");
        assert!(search.get("record").is_none());
    }

    #[test]
    fn round_trips_action_ids_with_underscores_in_the_event_id() {
        for action in AgendaAction::ALL {
            let id = item_id(action, "ev_1_2");
            assert_eq!(parse_item_id(&id), Some((action, "ev_1_2")));
        }
        assert_eq!(parse_item_id("anlg_tray_open"), None);
        assert_eq!(parse_item_id("anlg_tray_agenda_bogus_ev"), None);
    }
}
