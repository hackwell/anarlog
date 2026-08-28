//! Microsoft 365 calendar, read directly from Microsoft Graph.
//!
//! There is no broker in this path: the app holds its own Azure App
//! Registration, signs the user in with PKCE, and calls
//! `graph.microsoft.com` itself.

pub mod config;
mod oauth;
pub mod token;

pub use oauth::{
    access_token, complete_login, disconnect, is_callback_url, is_connected, start_login,
};
pub use token::TokenStore;
