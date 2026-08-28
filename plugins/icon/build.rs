const COMMANDS: &[&str] = &[
    "get_icon",
    "set_recording_indicator",
    "set_notification_badge",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
