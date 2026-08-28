mod commands;
mod error;
mod events;
mod microsoft;
mod runtime;

pub use anlg_calendar::ProviderConnectionIds;
pub use error::Error;
pub use events::*;

const PLUGIN_NAME: &str = "calendar";

fn make_specta_builder<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .plugin_name(PLUGIN_NAME)
        .commands(tauri_specta::collect_commands![
            commands::available_providers,
            commands::is_provider_enabled::<tauri::Wry>,
            commands::list_connection_ids::<tauri::Wry>,
            commands::list_calendars::<tauri::Wry>,
            commands::list_events::<tauri::Wry>,
            commands::open_calendar::<tauri::Wry>,
            commands::create_event::<tauri::Wry>,
            commands::microsoft_start_login,
            commands::microsoft_complete_login::<tauri::Wry>,
            commands::microsoft_disconnect::<tauri::Wry>,
            commands::microsoft_is_connected::<tauri::Wry>,
            commands::microsoft_dump_raw_events::<tauri::Wry>,
        ])
        .events(tauri_specta::collect_events![
            CalendarChangedEvent,
            MicrosoftConnectionChangedEvent
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let specta_builder = make_specta_builder();

    tauri::plugin::Builder::new(PLUGIN_NAME)
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app, _api| {
            use tauri::{Listener, Manager};

            specta_builder.mount_events(app);

            anlg_calendar::start(runtime::TauriCalendarRuntime(app.app_handle().clone()));

            // Listening on the raw deep-link event rather than through
            // tauri-plugin-deep-link's `on_open_url` helper: this plugin is
            // registered before that one, so its managed state does not exist
            // yet at setup time. The underlying event is order-independent, and
            // filtering by host keeps us off the /auth/callback route the
            // subscription sign-in owns.
            let deep_link_app = app.app_handle().clone();
            app.listen("deep-link://new-url", move |event| {
                let Ok(urls) = serde_json::from_str::<Vec<String>>(event.payload()) else {
                    return;
                };
                for url in urls {
                    if !anlg_calendar::microsoft::is_callback_url(&url) {
                        continue;
                    }
                    let app = deep_link_app.clone();
                    tauri::async_runtime::spawn(microsoft::handle_callback(app, url));
                }
            });

            Ok(())
        })
        .build()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn export_types() {
        const OUTPUT_FILE: &str = "./js/bindings.gen.ts";

        make_specta_builder::<tauri::Wry>()
            .export(
                specta_typescript::Typescript::default()
                    .formatter(specta_typescript::formatter::prettier)
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                OUTPUT_FILE,
            )
            .unwrap();

        let content = std::fs::read_to_string(OUTPUT_FILE).unwrap();
        std::fs::write(OUTPUT_FILE, format!("// @ts-nocheck\n{content}")).unwrap();
    }
}
