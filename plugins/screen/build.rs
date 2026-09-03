const COMMANDS: &[&str] = &[
    "capture_frontmost_window_context",
    "capture_target_window_context",
    "recognize_image_text",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
