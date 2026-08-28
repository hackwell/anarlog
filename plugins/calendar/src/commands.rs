use anlg_calendar_interface::{
    CalendarEvent, CalendarListItem, CalendarProviderType, CreateEventInput, EventFilter,
};
use tauri_plugin_permissions::PermissionsPluginExt;

use crate::error::Error;

#[tauri::command]
#[specta::specta]
pub fn available_providers() -> Vec<CalendarProviderType> {
    anlg_calendar::available_providers()
}

#[tauri::command]
#[specta::specta]
pub async fn is_provider_enabled<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
) -> Result<bool, Error> {
    let apple = is_apple_authorized(&app).await?;
    let microsoft = is_microsoft_connected(&app);
    Ok(anlg_calendar::is_provider_enabled(
        apple, microsoft, provider,
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn list_connection_ids<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<anlg_calendar::ProviderConnectionIds>, Error> {
    let apple = is_apple_authorized(&app).await?;
    let microsoft = is_microsoft_connected(&app);
    Ok(anlg_calendar::list_connection_ids(apple, microsoft))
}

#[tauri::command]
#[specta::specta]
pub async fn list_calendars<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
    _connection_id: String,
) -> Result<Vec<CalendarListItem>, Error> {
    anlg_calendar::list_calendars(provider)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn list_events<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
    _connection_id: String,
    filter: EventFilter,
) -> Result<Vec<CalendarEvent>, Error> {
    anlg_calendar::list_events(provider, filter)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn open_calendar<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
) -> Result<(), Error> {
    anlg_calendar::open_calendar(provider).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn create_event<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    provider: CalendarProviderType,
    input: CreateEventInput,
) -> Result<String, Error> {
    anlg_calendar::create_event(provider, input).map_err(Into::into)
}

/// Start the browser-based Microsoft sign-in and return the authorize URL for
/// the caller to open. PKCE is handled entirely in Rust.
#[tauri::command]
#[specta::specta]
pub async fn microsoft_start_login() -> Result<String, Error> {
    anlg_calendar::microsoft::start_login().map_err(Into::into)
}

/// Redeem an OAuth callback URL by hand. The deep link normally completes the
/// flow on its own; this exists for builds where the custom scheme is not
/// registered, and for tests.
#[tauri::command]
#[specta::specta]
pub async fn microsoft_complete_login<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    callback_url: String,
) -> Result<(), Error> {
    anlg_calendar::microsoft::complete_login(&crate::microsoft::tokens(&app), &callback_url)
        .await
        .map_err(Into::into)
}

/// Forget the locally stored refresh token. Access on Microsoft's side stays
/// until the user revokes it in their account settings.
#[tauri::command]
#[specta::specta]
pub async fn microsoft_disconnect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), Error> {
    anlg_calendar::microsoft::disconnect(&crate::microsoft::tokens(&app)).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn microsoft_is_connected<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> bool {
    is_microsoft_connected(&app)
}

fn is_microsoft_connected<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    anlg_calendar::microsoft::is_connected(&crate::microsoft::tokens(app))
}

async fn is_apple_authorized<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<bool, Error> {
    #[cfg(target_os = "macos")]
    {
        let status = app
            .permissions()
            .check(tauri_plugin_permissions::Permission::Calendar)
            .await
            .map_err(|e| Error::Permissions(e.to_string()))?;
        Ok(matches!(
            status,
            tauri_plugin_permissions::PermissionStatus::Authorized
        ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
}
