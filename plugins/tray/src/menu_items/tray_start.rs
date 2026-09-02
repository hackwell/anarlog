use tauri::{
    AppHandle, Result,
    menu::{IconMenuItem, MenuItemKind},
};

use super::{MenuIcon, MenuItemHandler, icon_item};

pub struct TrayStart;

impl MenuItemHandler for TrayStart {
    const ID: &'static str = "anlg_tray_start";

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>> {
        Ok(MenuItemKind::Icon(Self::build_with_disabled(app, false)?))
    }

    fn handle(app: &AppHandle<tauri::Wry>) {
        use tauri_plugin_windows::{AppWindow, OpenTab, SessionsState, TabInput, WindowsPluginExt};
        use tauri_specta::Event;

        if app.windows().show(AppWindow::Main).is_ok() {
            let event = OpenTab {
                tab: TabInput::Sessions {
                    id: "new".to_string(),
                    state: Some(SessionsState {
                        view: Default::default(),
                        auto_start: Some(true),
                    }),
                },
            };
            let _ = event.emit(app);
        }
    }
}

impl TrayStart {
    pub fn build_with_disabled(
        app: &AppHandle<tauri::Wry>,
        disabled: bool,
    ) -> Result<IconMenuItem<tauri::Wry>> {
        icon_item(
            app,
            Self::ID,
            &crate::schedule::labels().start_meeting,
            !disabled,
            MenuIcon::Record,
        )
    }
}
