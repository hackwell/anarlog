const COMMANDS: &[&str] = &[
    "set_tray_icon_visible",
    "set_tray_schedule",
    "set_tray_recording_title",
    "set_tray_labels",
    "set_tray_show_events",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
