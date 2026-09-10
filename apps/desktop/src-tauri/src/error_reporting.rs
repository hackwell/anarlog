use std::borrow::Cow;
use std::sync::Arc;

use sentry::protocol::{Breadcrumb, Event, Value};
use tauri_plugin_tracing::redaction::redact_text;

/// Where the DSN comes from: the environment at run time, else whatever was
/// baked in at build time. Neither one present means error reporting stays off
/// and the app behaves exactly as it did before.
fn dsn() -> Option<String> {
    std::env::var("SENTRY_DSN")
        .ok()
        .or_else(|| option_env!("SENTRY_DSN").map(str::to_owned))
        .map(|dsn| dsn.trim().to_owned())
        .filter(|dsn| !dsn.is_empty())
}

const INSTALL_ID_FILENAME: &str = "install-id";

/// A random identifier for this installation. It is what tells one machine
/// reporting an error eleven times apart from eleven machines reporting it once
/// — the only thing a user count can be built from without knowing anything
/// about a person. Generated here, tied to no account, sent nowhere else.
pub fn install_id(identifier: &str) -> Option<String> {
    let dir = crate::db::desktop_db_dir(identifier)?;
    let path = dir.join(INSTALL_ID_FILENAME);
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return Some(existing.to_owned());
        }
    }

    let generated = uuid::Uuid::new_v4().to_string();
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(&path, &generated).ok()?;
    Some(generated)
}

/// Starts error reporting. The returned guard flushes pending events when it is
/// dropped, so it has to live for as long as the process does.
pub fn init(
    version: &str,
    is_dev_build: bool,
    install_id: Option<String>,
) -> Option<sentry::ClientInitGuard> {
    let dsn = dsn()?;

    // `ClientOptions` is non-exhaustive, so it is filled in field by field.
    let mut options = sentry::ClientOptions::default();
    options.release = Some(Cow::Owned(version.to_owned()));
    options.environment = Some(Cow::Borrowed(if is_dev_build {
        "development"
    } else {
        "production"
    }));
    options.max_breadcrumbs = 50;
    // This app records meetings. Nothing that names a person, a meeting or a
    // machine may leave the computer, so identifying data is turned off at the
    // source and every string still goes through the same scrubbing the log
    // file gets.
    options.send_default_pii = false;
    options.before_send = Some(Arc::new(|event| Some(scrub_event(event))));
    options.before_breadcrumb = Some(Arc::new(|breadcrumb| Some(scrub_breadcrumb(breadcrumb))));

    let guard = sentry::init((dsn, options));
    if let Some(install_id) = install_id {
        sentry::configure_scope(|scope| {
            scope.set_user(Some(sentry::User {
                id: Some(install_id),
                ..Default::default()
            }));
        });
    }
    Some(guard)
}

fn scrub_event(mut event: Event<'static>) -> Event<'static> {
    // The hostname of a personal machine is usually its owner's name, and the
    // username is always one. Sentry fills both in by default.
    event.server_name = None;
    // The anonymous installation id is the only thing worth keeping here;
    // username, email and IP are filled in by Sentry and are not ours to send.
    if let Some(user) = event.user.as_mut() {
        let id = user.id.take();
        *user = sentry::protocol::User {
            id,
            ..Default::default()
        };
    }

    if let Some(message) = event.message.take() {
        event.message = Some(redact_text(&message));
    }
    if let Some(logentry) = event.logentry.as_mut() {
        logentry.message = redact_text(&logentry.message);
        for param in &mut logentry.params {
            scrub_value(param);
        }
    }
    for exception in &mut event.exception.values {
        if let Some(value) = exception.value.take() {
            exception.value = Some(redact_text(&value));
        }
    }
    for breadcrumb in &mut event.breadcrumbs.values {
        scrub_breadcrumb_in_place(breadcrumb);
    }
    for value in event.extra.values_mut() {
        scrub_value(value);
    }
    event
}

fn scrub_breadcrumb(mut breadcrumb: Breadcrumb) -> Breadcrumb {
    scrub_breadcrumb_in_place(&mut breadcrumb);
    breadcrumb
}

fn scrub_breadcrumb_in_place(breadcrumb: &mut Breadcrumb) {
    if let Some(message) = breadcrumb.message.take() {
        breadcrumb.message = Some(redact_text(&message));
    }
    for value in breadcrumb.data.values_mut() {
        scrub_value(value);
    }
}

fn scrub_value(value: &mut Value) {
    match value {
        Value::String(text) => *text = redact_text(text),
        Value::Array(items) => items.iter_mut().for_each(scrub_value),
        Value::Object(entries) => entries.values_mut().for_each(scrub_value),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_the_machine_and_the_person_out_of_an_event() {
        let mut event = Event::default();
        event.server_name = Some("Joergs-MacBook-Pro.local".into());
        event.message = Some("failed to reach person@example.com from 192.168.1.4".to_string());
        event.user = Some(sentry::protocol::User {
            id: Some("install-1".to_string()),
            email: Some("person@example.com".to_string()),
            username: Some("someone".to_string()),
            ..Default::default()
        });

        let scrubbed = scrub_event(event);

        assert!(scrubbed.server_name.is_none());
        let user = scrubbed.user.as_ref().expect("the installation id stays");
        assert_eq!(user.id.as_deref(), Some("install-1"));
        assert!(user.email.is_none(), "the address does not");
        assert!(user.username.is_none(), "nor the name");
        let message = scrubbed.message.expect("message survives");
        assert!(!message.contains("person@example.com"), "{message}");
        assert!(!message.contains("192.168.1.4"), "{message}");
    }

    #[test]
    fn scrubs_nested_breadcrumb_data() {
        let mut breadcrumb = Breadcrumb::default();
        breadcrumb.message = Some("upload failed for person@example.com".to_string());
        breadcrumb.data.insert(
            "detail".to_string(),
            Value::Array(vec![Value::String("second@example.com".to_string())]),
        );

        let scrubbed = scrub_breadcrumb(breadcrumb);

        assert!(!scrubbed.message.expect("message").contains('@'));
        let Some(Value::Array(items)) = scrubbed.data.get("detail") else {
            panic!("array survives");
        };
        let Some(Value::String(first)) = items.first() else {
            panic!("entry survives");
        };
        assert!(!first.contains('@'), "{first}");
    }
}
