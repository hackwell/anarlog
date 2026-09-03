use crate::ScreenPluginExt;
use crate::ext::{WindowCaptureTarget, WindowContextCapture, WindowContextCaptureOptions};

#[tauri::command]
#[specta::specta]
pub(crate) async fn capture_frontmost_window_context<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    options: Option<WindowContextCaptureOptions>,
) -> Result<WindowContextCapture, String> {
    app.screen()
        .capture_frontmost_window_context(options.unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn capture_target_window_context<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    target: WindowCaptureTarget,
    options: Option<WindowContextCaptureOptions>,
) -> Result<WindowContextCapture, String> {
    app.screen()
        .capture_target_window_context(target, options.unwrap_or_default())
        .map_err(|e| e.to_string())
}

/// Text visible in a PNG, for slides captured from the meeting window. Runs
/// on-device (Vision on macOS); other platforms return an empty string.
#[tauri::command]
#[specta::specta]
pub(crate) async fn recognize_image_text(data_base64: String) -> Result<String, String> {
    use base64::Engine;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(
        tauri::async_runtime::spawn_blocking(move || anlg_screen_core::recognize_text(&bytes))
            .await
            .map_err(|e| e.to_string())?,
    )
}
