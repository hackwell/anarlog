#[derive(serde::Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct CalendarChangedEvent;

/// Emitted when a Microsoft sign-in finishes, since the OAuth callback arrives
/// over the OS deep link rather than as the reply to a command.
#[derive(serde::Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct MicrosoftConnectionChangedEvent {
    pub connected: bool,
    pub error: Option<String>,
}
