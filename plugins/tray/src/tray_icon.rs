use tauri::{Result, image::Image};

pub enum TrayIconState {
    Default,
    Degraded,
    UpdateAvailable,
}

// The wordmark's sound waves pulse outward and back (none, one, both, one),
// so the icon keeps its width and the menu bar title never shifts.
pub const RECORDING_FRAMES: &[&[u8]] = &[
    include_bytes!("../icons/tray_recording_0.png"),
    include_bytes!("../icons/tray_recording_1.png"),
    include_bytes!("../icons/tray_recording_2.png"),
    include_bytes!("../icons/tray_recording_3.png"),
];

impl TrayIconState {
    pub fn to_image(&self) -> Result<Image<'static>> {
        match self {
            TrayIconState::Default => {
                Image::from_bytes(include_bytes!("../icons/tray_default.png"))
            }
            TrayIconState::Degraded => {
                Image::from_bytes(include_bytes!("../icons/tray_degraded.png"))
            }
            TrayIconState::UpdateAvailable => {
                Image::from_bytes(include_bytes!("../icons/tray_update.png"))
            }
        }
    }
}
