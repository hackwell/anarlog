//! Tauri-side wiring for the Microsoft Graph calendar provider: where the
//! refresh token lives, and how the OAuth callback gets back into Rust.

use anlg_calendar::microsoft::TokenStore;

/// Secure-store coordinate for the refresh token.
///
/// `store2` keeps secrets in the OS credential store (Keychain, Credential
/// Manager, Secret Service) keyed by `scope:key`, and the `ms-calendar:` prefix
/// is on its native-only reserve list, so the renderer cannot read the refresh
/// token back out through `getSecret`.
const SECRET_SCOPE: &str = "ms-calendar";
const SECRET_KEY: &str = "refresh_token";

pub struct SecureStoreTokens<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> TokenStore for SecureStoreTokens<R> {
    fn read_refresh_token(&self) -> Result<Option<String>, String> {
        tauri_plugin_store2::read_secret_blocking(&self.0, SECRET_SCOPE, SECRET_KEY)
    }

    fn write_refresh_token(&self, refresh_token: &str) -> Result<(), String> {
        tauri_plugin_store2::write_secret_blocking(&self.0, SECRET_SCOPE, SECRET_KEY, refresh_token)
    }

    fn delete_refresh_token(&self) -> Result<(), String> {
        tauri_plugin_store2::delete_secret_blocking(&self.0, SECRET_SCOPE, SECRET_KEY)
    }
}

pub fn tokens<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> SecureStoreTokens<R> {
    SecureStoreTokens(app.clone())
}

/// Complete an OAuth callback that arrived over the custom scheme and report
/// the outcome so the settings UI can stop spinning.
pub async fn handle_callback<R: tauri::Runtime>(app: tauri::AppHandle<R>, url: String) {
    use tauri_specta::Event as _;

    let result = anlg_calendar::microsoft::complete_login(&tokens(&app), &url).await;
    let event = match result {
        Ok(()) => crate::MicrosoftConnectionChangedEvent {
            connected: true,
            error: None,
        },
        Err(error) => {
            tracing::warn!(%error, "microsoft_calendar_callback_failed");
            crate::MicrosoftConnectionChangedEvent {
                connected: false,
                error: Some(error.to_string()),
            }
        }
    };

    let _ = event.emit(&app);
}
