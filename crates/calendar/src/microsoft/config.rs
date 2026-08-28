//! Build-time configuration for the Microsoft Graph calendar integration.

use crate::Error;

/// Multi-tenant authority. Session Echo ships under MIT and anyone may connect
/// their own mailbox, so this must stay `common` — it accepts work/school
/// accounts and personal Microsoft accounts alike. There is deliberately no
/// tenant switch: a dormant one would only invite the restriction to be
/// reintroduced by accident.
pub const AUTHORIZE_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/// Custom-scheme redirect the OS routes back to the running app.
///
/// Deliberately not `/auth/callback`: that path is already claimed by the local
/// Claude Pro / ChatGPT Plus sign-in, and a collision would deliver Microsoft's
/// authorization code to the wrong handler.
pub const REDIRECT_URI: &str = "sessionecho://ms-calendar/callback";

/// Host and path of `REDIRECT_URI`, matched scheme-agnostically so dev builds
/// (`sessionecho-dev://`) route the same way as stable ones.
pub const CALLBACK_HOST: &str = "ms-calendar";
pub const CALLBACK_PATH: &str = "/callback";

/// Read-only calendar access, plus `offline_access` because Entra ID does not
/// return a refresh token without it.
pub const SCOPES: &[&str] = &["Calendars.Read", "offline_access"];

pub const GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0";

/// The Azure App Registration's application (client) ID.
///
/// A public value that ships in the binary, but it is never committed — it is
/// baked in from the build environment. `option_env!` keeps a build without it
/// compiling; every call site that needs it fails loudly instead.
pub fn client_id() -> Result<&'static str, Error> {
    option_env!("MICROSOFT_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(Error::MicrosoftNotConfigured)
}

pub fn scope_parameter() -> String {
    SCOPES.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authority_is_multi_tenant() {
        assert!(AUTHORIZE_URL.starts_with("https://login.microsoftonline.com/common/"));
        assert!(TOKEN_URL.starts_with("https://login.microsoftonline.com/common/"));
    }

    #[test]
    fn redirect_uri_does_not_collide_with_the_subscription_login() {
        assert_eq!(REDIRECT_URI, "sessionecho://ms-calendar/callback");
        assert!(!REDIRECT_URI.contains("/auth/callback"));
    }

    #[test]
    fn requests_offline_access_so_a_refresh_token_comes_back() {
        assert_eq!(scope_parameter(), "Calendars.Read offline_access");
    }
}
