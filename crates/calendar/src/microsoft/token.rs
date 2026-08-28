//! Durable storage for the Microsoft refresh token.
//!
//! The calendar crate has no `AppHandle`, so persistence is a trait the Tauri
//! plugin implements over the app's existing secure store. Only the refresh
//! token is persisted; access tokens live in memory and are re-minted on demand.

pub trait TokenStore: Send + Sync {
    fn read_refresh_token(&self) -> Result<Option<String>, String>;
    fn write_refresh_token(&self, refresh_token: &str) -> Result<(), String>;
    fn delete_refresh_token(&self) -> Result<(), String>;
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryTokenStore(std::sync::Mutex<Option<String>>);

#[cfg(test)]
impl TokenStore for MemoryTokenStore {
    fn read_refresh_token(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().clone())
    }

    fn write_refresh_token(&self, refresh_token: &str) -> Result<(), String> {
        *self.0.lock().unwrap() = Some(refresh_token.to_string());
        Ok(())
    }

    fn delete_refresh_token(&self) -> Result<(), String> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}
