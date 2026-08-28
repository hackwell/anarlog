//! OAuth 2.0 authorization-code flow with PKCE against Microsoft identity
//! platform v2.0.
//!
//! This is a public client: there is no client secret, because a desktop binary
//! cannot keep one. PKCE (S256) is what binds the authorization code to this
//! process instead.
//!
//! 1. `start_login` builds the authorize URL, stashes the PKCE verifier and the
//!    CSRF `state` in process memory, and hands the URL back to be opened.
//! 2. The OS routes `sessionecho://ms-calendar/callback?code=…&state=…` back to
//!    the running app, which calls `complete_login`.
//! 3. `complete_login` validates `state`, exchanges the code, and persists the
//!    refresh token through the `TokenStore`.
//! 4. `access_token` mints access tokens on demand, refreshing when the cached
//!    one is within a minute of expiry.

use std::sync::{Mutex, RwLock};

use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::Error;
use crate::microsoft::config;
use crate::microsoft::token::TokenStore;

/// Refresh this far ahead of expiry so an in-flight request cannot be handed a
/// token that expires mid-round-trip.
const REFRESH_MARGIN_SECONDS: i64 = 60;

struct PendingLogin {
    verifier: String,
    state: String,
}

#[derive(Clone)]
struct CachedToken {
    access_token: String,
    expires_at: DateTime<Utc>,
    refresh_token: String,
}

static PENDING: Mutex<Option<PendingLogin>> = Mutex::new(None);
static CACHED: RwLock<Option<CachedToken>> = RwLock::new(None);

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

#[derive(Deserialize)]
struct TokenErrorResponse {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// True when a URL is this integration's OAuth callback. Matched on host and
/// path only, so the dev scheme (`sessionecho-dev://`) works the same as the
/// stable one.
pub fn is_callback_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    parsed.host_str() == Some(config::CALLBACK_HOST) && parsed.path() == config::CALLBACK_PATH
}

/// Build the authorize URL and remember the PKCE verifier for the callback.
///
/// Restarting a login before the previous one completed simply replaces the
/// pending attempt; the abandoned code can then never be redeemed.
pub fn start_login() -> Result<String, Error> {
    let client_id = config::client_id()?;

    let verifier = random_token();
    let state = random_token();
    let challenge = code_challenge(&verifier);

    let mut url = url::Url::parse(config::AUTHORIZE_URL)
        .map_err(|error| Error::MicrosoftAuth(format!("bad authorize URL: {error}")))?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &config::redirect_uri())
        .append_pair("response_mode", "query")
        .append_pair("scope", &config::scope_parameter())
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");

    *PENDING
        .lock()
        .map_err(|error| Error::MicrosoftAuth(format!("pending login lock: {error}")))? =
        Some(PendingLogin { verifier, state });

    Ok(url.to_string())
}

/// Redeem the authorization code carried by the callback URL.
pub async fn complete_login(store: &dyn TokenStore, callback_url: &str) -> Result<(), Error> {
    let parsed = url::Url::parse(callback_url)
        .map_err(|error| Error::MicrosoftAuth(format!("bad callback URL: {error}")))?;

    let mut code = None;
    let mut state = None;
    let mut error_code = None;
    let mut error_description = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error_code = Some(value.into_owned()),
            "error_description" => error_description = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error_code) = error_code {
        clear_pending()?;
        let detail = error_description.unwrap_or_default();
        return Err(Error::MicrosoftAuth(format!(
            "Microsoft rejected the sign-in: {error_code} {detail}"
        )));
    }

    let code = code.ok_or_else(|| Error::MicrosoftAuth("callback had no code".to_string()))?;
    let state = state.ok_or_else(|| Error::MicrosoftAuth("callback had no state".to_string()))?;

    let pending = {
        let mut guard = PENDING
            .lock()
            .map_err(|error| Error::MicrosoftAuth(format!("pending login lock: {error}")))?;
        guard
            .take()
            .ok_or_else(|| Error::MicrosoftAuth("no sign-in is in progress".to_string()))?
    };

    if pending.state != state {
        return Err(Error::MicrosoftAuth(
            "sign-in state did not match; ignoring the callback".to_string(),
        ));
    }

    let client_id = config::client_id()?;
    let redirect_uri = config::redirect_uri();
    let form = [
        ("client_id", client_id),
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", pending.verifier.as_str()),
        ("scope", &config::scope_parameter()),
    ];

    let token = post_token_request(&form).await?;
    let refresh_token = token.refresh_token.ok_or_else(|| {
        Error::MicrosoftAuth(
            "Microsoft returned no refresh token; the offline_access scope was not granted"
                .to_string(),
        )
    })?;

    store
        .write_refresh_token(&refresh_token)
        .map_err(Error::TokenStore)?;
    cache_token(token.access_token, token.expires_in, refresh_token)?;

    Ok(())
}

/// Forget the local tokens. Microsoft-side revocation stays the user's own
/// business at account.microsoft.com / their tenant admin.
pub fn disconnect(store: &dyn TokenStore) -> Result<(), Error> {
    clear_cache()?;
    clear_pending()?;
    store.delete_refresh_token().map_err(Error::TokenStore)
}

pub fn is_connected(store: &dyn TokenStore) -> bool {
    matches!(store.read_refresh_token(), Ok(Some(token)) if !token.is_empty())
}

/// A valid access token, refreshed transparently when the cached one is spent.
pub async fn access_token(store: &dyn TokenStore) -> Result<String, Error> {
    let cached = read_cache()?;

    if let Some(cached) = cached.as_ref()
        && cached.expires_at > Utc::now() + Duration::seconds(REFRESH_MARGIN_SECONDS)
    {
        return Ok(cached.access_token.clone());
    }

    let refresh_token = match cached {
        Some(cached) => cached.refresh_token,
        None => store
            .read_refresh_token()
            .map_err(Error::TokenStore)?
            .filter(|token| !token.is_empty())
            .ok_or(Error::MicrosoftNotConnected)?,
    };

    refresh_access_token(store, &refresh_token).await
}

async fn refresh_access_token(
    store: &dyn TokenStore,
    refresh_token: &str,
) -> Result<String, Error> {
    let client_id = config::client_id()?;
    let form = [
        ("client_id", client_id),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", &config::scope_parameter()),
    ];

    let token = post_token_request(&form).await?;

    // Entra ID rotates refresh tokens; persist the replacement when it sends one.
    let next_refresh = token
        .refresh_token
        .unwrap_or_else(|| refresh_token.to_string());
    if next_refresh != refresh_token {
        store
            .write_refresh_token(&next_refresh)
            .map_err(Error::TokenStore)?;
    }

    let access_token = token.access_token.clone();
    cache_token(token.access_token, token.expires_in, next_refresh)?;

    Ok(access_token)
}

async fn post_token_request(form: &[(&str, &str)]) -> Result<TokenResponse, Error> {
    let response = reqwest::Client::new()
        .post(config::TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|error| Error::MicrosoftAuth(format!("token request failed: {error}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| Error::MicrosoftAuth(format!("token response unreadable: {error}")))?;

    if !status.is_success() {
        let detail = serde_json::from_str::<TokenErrorResponse>(&body)
            .ok()
            .and_then(|parsed| match (parsed.error, parsed.error_description) {
                (Some(code), Some(description)) => Some(format!("{code}: {description}")),
                (Some(code), None) => Some(code),
                (None, description) => description,
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(Error::MicrosoftAuth(detail));
    }

    serde_json::from_str(&body)
        .map_err(|error| Error::MicrosoftAuth(format!("token response unparseable: {error}")))
}

fn cache_token(
    access_token: String,
    expires_in: Option<i64>,
    refresh_token: String,
) -> Result<(), Error> {
    let expires_at = Utc::now() + Duration::seconds(expires_in.unwrap_or(3600));
    *CACHED
        .write()
        .map_err(|error| Error::MicrosoftAuth(format!("token cache lock: {error}")))? =
        Some(CachedToken {
            access_token,
            expires_at,
            refresh_token,
        });
    Ok(())
}

fn read_cache() -> Result<Option<CachedToken>, Error> {
    Ok(CACHED
        .read()
        .map_err(|error| Error::MicrosoftAuth(format!("token cache lock: {error}")))?
        .clone())
}

fn clear_cache() -> Result<(), Error> {
    *CACHED
        .write()
        .map_err(|error| Error::MicrosoftAuth(format!("token cache lock: {error}")))? = None;
    Ok(())
}

fn clear_pending() -> Result<(), Error> {
    *PENDING
        .lock()
        .map_err(|error| Error::MicrosoftAuth(format!("pending login lock: {error}")))? = None;
    Ok(())
}

/// 256 bits of CSPRNG output rendered as hex, which is inside PKCE's unreserved
/// character set and inside its 43..=128 length window.
fn random_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn code_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_the_callback_on_either_scheme() {
        assert!(is_callback_url(
            "sessionecho://ms-calendar/callback?code=abc&state=xyz"
        ));
        assert!(is_callback_url(
            "sessionecho-dev://ms-calendar/callback?code=abc&state=xyz"
        ));
    }

    #[test]
    fn leaves_the_subscription_login_callback_alone() {
        assert!(!is_callback_url("sessionecho://auth/callback?code=abc"));
        assert!(!is_callback_url(
            "http://localhost:1455/auth/callback?code=abc"
        ));
        assert!(!is_callback_url("sessionecho://integration/callback"));
        assert!(!is_callback_url("not a url"));
    }

    #[test]
    fn pkce_verifiers_are_unique_and_correctly_sized() {
        let first = random_token();
        let second = random_token();

        assert_ne!(first, second);
        assert_eq!(first.len(), 64);
        assert!((43..=128).contains(&first.len()));
        assert!(first.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn code_challenge_is_s256_base64url_unpadded() {
        // RFC 7636 appendix B's worked example.
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
