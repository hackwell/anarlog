use tauri::{
    AppHandle, Result,
    menu::{MenuItem, MenuItemKind},
};
use tauri_plugin_windows::{AppWindow, OpenTab, TabInput, WindowsPluginExt};
use tauri_specta::Event;

use super::{MenuIcon, MenuItemHandler, icon_item};

pub struct TraySettings;

impl MenuItemHandler for TraySettings {
    const ID: &'static str = "anlg_tray_settings";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = MenuItem::with_id(
            app,
            Self::ID,
            &crate::schedule::labels().settings,
            true,
            None::<&str>,
        )?;
        Ok(MenuItemKind::MenuItem(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        if app.windows().show(AppWindow::Main).is_ok() {
            let event = OpenTab {
                tab: TabInput::Settings { state: None },
            };
            if let Err(e) = event.emit(app) {
                tracing::warn!("failed_emit_open_settings_tab: {e}");
            }
        }
    }
}

impl TraySettings {
    // The app menu keeps the plain item; only the tray shows icons.
    pub fn build_for_tray(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = icon_item(
            app,
            Self::ID,
            &crate::schedule::labels().settings,
            true,
            MenuIcon::Settings,
        )?;
        Ok(MenuItemKind::Icon(item))
    }
}
