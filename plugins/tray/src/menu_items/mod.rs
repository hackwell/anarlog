mod app_info;
mod app_new;
mod help_report_bug;
mod help_suggest_feature;
mod tray_agenda;
mod tray_check_update;
mod tray_open;
mod tray_quit;
mod tray_quit_completely;
mod tray_settings;
mod tray_start;

pub use app_info::AppInfo;
pub use app_new::AppNew;
pub use help_report_bug::HelpReportBug;
pub use help_suggest_feature::HelpSuggestFeature;
pub use tray_agenda::{build_agenda_item, handle_agenda_menu_event};
pub use tray_check_update::{TrayCheckUpdate, UpdateMenuState};
pub use tray_open::TrayOpen;
pub use tray_quit::TrayQuit;
pub use tray_quit_completely::{TrayQuitCompletely, quit_completely};
pub use tray_settings::TraySettings;
pub use tray_start::TrayStart;

use tauri::{
    AppHandle, Result,
    image::Image,
    menu::{IconMenuItem, MenuItemKind},
};

pub enum MenuIcon {
    OpenApp,
    Record,
    Settings,
    Quit,
    Join,
    Note,
    Link,
}

impl MenuIcon {
    // muda cannot mark menu images as templates, so the menu is built with
    // the set that matches the current system appearance instead.
    fn bytes(&self) -> &'static [u8] {
        macro_rules! icon {
            ($name:literal) => {
                if system_appearance_is_dark() {
                    include_bytes!(concat!("../../icons/menu/dark/", $name, ".png"))
                } else {
                    include_bytes!(concat!("../../icons/menu/light/", $name, ".png"))
                }
            };
        }
        match self {
            MenuIcon::OpenApp => icon!("open_app"),
            MenuIcon::Record => icon!("record"),
            MenuIcon::Settings => icon!("settings"),
            MenuIcon::Quit => icon!("quit"),
            MenuIcon::Join => icon!("join"),
            MenuIcon::Note => icon!("note"),
            MenuIcon::Link => icon!("link"),
        }
    }
}

#[cfg(target_os = "macos")]
pub fn system_appearance_is_dark() -> bool {
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    defaults
        .stringForKey(&NSString::from_str("AppleInterfaceStyle"))
        .is_some_and(|style| style.to_string().eq_ignore_ascii_case("dark"))
}

#[cfg(not(target_os = "macos"))]
pub fn system_appearance_is_dark() -> bool {
    false
}

pub fn icon_item(
    app: &AppHandle<tauri::Wry>,
    id: impl Into<tauri::menu::MenuId>,
    text: impl AsRef<str>,
    enabled: bool,
    icon: MenuIcon,
) -> Result<IconMenuItem<tauri::Wry>> {
    IconMenuItem::with_id(
        app,
        id,
        text,
        enabled,
        Some(Image::from_bytes(icon.bytes())?),
        None::<&str>,
    )
}

pub trait MenuItemHandler {
    const ID: &'static str;

    fn build(app: &AppHandle<tauri::Wry>) -> Result<MenuItemKind<tauri::Wry>>;
    fn handle(app: &AppHandle<tauri::Wry>);
}

macro_rules! menu_items {
    ($($variant:ident => $item:ty),* $(,)?) => {
        #[derive(Debug, Clone, Copy)]
        pub enum AnlgMenuItem {
            $($variant),*
        }

        impl From<AnlgMenuItem> for tauri::menu::MenuId {
            fn from(value: AnlgMenuItem) -> Self {
                match value {
                    $(AnlgMenuItem::$variant => <$item as MenuItemHandler>::ID),*
                }.into()
            }
        }

        impl TryFrom<tauri::menu::MenuId> for AnlgMenuItem {
            type Error = ();

            fn try_from(id: tauri::menu::MenuId) -> std::result::Result<Self, Self::Error> {
                let id = id.0.as_str();
                match id {
                    $(<$item as MenuItemHandler>::ID => Ok(AnlgMenuItem::$variant),)*
                    _ => Err(()),
                }
            }
        }

        impl AnlgMenuItem {
            pub fn handle(self, app: &AppHandle<tauri::Wry>) {
                match self {
                    $(AnlgMenuItem::$variant => <$item>::handle(app)),*
                }
            }
        }
    };
}

menu_items! {
    TrayOpen => TrayOpen,
    TrayStart => TrayStart,
    TraySettings => TraySettings,
    TrayCheckUpdate => TrayCheckUpdate,
    TrayQuit => TrayQuit,
    TrayQuitCompletely => TrayQuitCompletely,
    AppInfo => AppInfo,
    AppNew => AppNew,
    HelpReportBug => HelpReportBug,
    HelpSuggestFeature => HelpSuggestFeature,
}
