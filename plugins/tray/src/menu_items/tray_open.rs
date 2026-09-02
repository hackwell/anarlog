use tauri::{AppHandle, Result, menu::MenuItemKind};

use super::{MenuIcon, MenuItemHandler, icon_item};

pub struct TrayOpen;

impl MenuItemHandler for TrayOpen {
    const ID: &'static str = "anlg_tray_open";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        let item = icon_item(
            app,
            Self::ID,
            crate::schedule::labels()
                .open_app
                .replace("{app}", app.package_info().name.as_str()),
            true,
            MenuIcon::OpenApp,
        )?;
        Ok(MenuItemKind::Icon(item))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        use tauri_plugin_windows::AppWindow;
        let _ = AppWindow::Main.show(app);
    }
}
