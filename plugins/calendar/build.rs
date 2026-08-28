const COMMANDS: &[&str] = &[
    "available_providers",
    "is_provider_enabled",
    "list_connection_ids",
    "list_calendars",
    "list_events",
    "open_calendar",
    "create_event",
    "microsoft_start_login",
    "microsoft_complete_login",
    "microsoft_disconnect",
    "microsoft_is_connected",
    "microsoft_dump_raw_events",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
