use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

use tauri::async_runtime::JoinHandle;
#[cfg(target_os = "macos")]
use tauri::menu::{HELP_SUBMENU_ID, Submenu, WINDOW_SUBMENU_ID};
#[cfg(target_os = "macos")]
use tauri::tray::{MouseButtonState, TrayIconEvent};
use tauri::{
    AppHandle, Result,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

use crate::{
    schedule::{
        TrayLabels, TrayMenuModel, TrayScheduleEvent, menu_bar_title, menu_model,
        next_schedule_refresh_ms,
    },
    tray_icon::{RECORDING_FRAMES, TrayIconState},
};

#[cfg(target_os = "macos")]
use crate::menu_items::{AppInfo, AppNew, HelpReportBug, HelpSuggestFeature, TrayQuit};
use crate::menu_items::{
    MenuItemHandler, TrayCheckUpdate, TrayOpen, TrayQuitCompletely, TraySettings, TrayStart,
    build_agenda_item, build_join_now_item,
};

const TRAY_ID: &str = "anlg-tray";

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static IS_DEGRADED: AtomicBool = AtomicBool::new(false);
static IS_UPDATE_AVAILABLE: AtomicBool = AtomicBool::new(false);
static SHOW_EVENTS: AtomicBool = AtomicBool::new(true);
static START_DISABLED: AtomicBool = AtomicBool::new(false);
static ANIMATION_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static SCHEDULE: Mutex<Vec<TrayScheduleEvent>> = Mutex::new(Vec::new());
static SCHEDULE_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static MENU_BAR_TITLE: Mutex<Option<String>> = Mutex::new(None);
static RECORDING_TITLE: Mutex<Option<String>> = Mutex::new(None);
static MENU_MODEL: Mutex<Option<TrayMenuModel>> = Mutex::new(None);
// muda 0.17 stores a raw MenuChild pointer on each NSMenuItem. Replacing the
// tray menu while it is still visible frees those items and crashes on click
// (HYPRNOTE2-2MTS). Defer set_menu until the next tray mouse-down instead.
#[cfg(target_os = "macos")]
static MENU_DIRTY: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static MENU_BUILT_FOR_DARK: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
pub fn build_app_menu(app: &AppHandle<tauri::Wry>) -> Result<Menu<tauri::Wry>> {
    let app_submenu = if crate::updates_enabled() {
        Submenu::with_items(
            app,
            app.package_info().name.clone(),
            true,
            &[
                &AppInfo::build(app)?,
                &TrayCheckUpdate::build(app)?,
                &TraySettings::build(app)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &TrayQuit::build(app)?,
            ],
        )?
    } else {
        Submenu::with_items(
            app,
            app.package_info().name.clone(),
            true,
            &[
                &AppInfo::build(app)?,
                &TraySettings::build(app)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &TrayQuit::build(app)?,
            ],
        )?
    };
    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &AppNew::build(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_submenu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    let window_submenu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help_submenu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            &HelpReportBug::build(app)?,
            &HelpSuggestFeature::build(app)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &help_submenu,
        ],
    )
}

pub struct Tray<'a, R: tauri::Runtime, M: tauri::Manager<R>> {
    manager: &'a M,
    _runtime: std::marker::PhantomData<fn() -> R>,
}

// libappindicator-sys panics at first use when it cannot dlopen any
// appindicator library, so probe the same candidates before tray-icon
// reaches it.
#[cfg(target_os = "linux")]
fn linux_tray_backend_available() -> bool {
    [
        "libayatana-appindicator3.so.1",
        "libappindicator3.so.1",
        "libayatana-appindicator3.so",
        "libappindicator3.so",
    ]
    .iter()
    .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
}

impl<'a, M: tauri::Manager<tauri::Wry>> Tray<'a, tauri::Wry, M> {
    pub fn create_tray_menu(&self) -> Result<()> {
        let app = self.manager.app_handle();

        if app.tray_by_id(TRAY_ID).is_some() {
            return Ok(());
        }

        #[cfg(target_os = "linux")]
        if !linux_tray_backend_available() {
            tracing::warn!("appindicator_library_missing_skipping_tray_icon");
            return Ok(());
        }

        let model = Self::current_menu_model();
        let menu = Self::build_tray_menu(app, &model)?;
        *MENU_MODEL.lock().unwrap() = Some(model);
        #[cfg(target_os = "macos")]
        MENU_BUILT_FOR_DARK.store(
            crate::menu_items::system_appearance_is_dark(),
            Ordering::SeqCst,
        );

        let builder = TrayIconBuilder::with_id(TRAY_ID)
            .icon(TrayIconState::Default.to_image()?)
            .icon_as_template(true)
            .menu(&menu)
            .show_menu_on_left_click(true);
        #[cfg(target_os = "macos")]
        let builder = {
            let app = app.clone();
            builder.on_tray_icon_event(move |_tray, event| {
                // Enter fires as the pointer reaches the icon, while the menu is
                // still closed - the only safe moment to swap it, and early
                // enough that the click opens the new one. Click alone was not
                // enough: with show_menu_on_left_click the menu opens without
                // the handler seeing the press, so the agenda never arrived.
                let ready = matches!(
                    event,
                    TrayIconEvent::Enter { .. }
                        | TrayIconEvent::Move { .. }
                        | TrayIconEvent::Click {
                            button_state: MouseButtonState::Down,
                            ..
                        }
                );
                if ready {
                    // Icons are baked for one appearance; swap the menu when
                    // the system switched between light and dark since it
                    // was built.
                    if crate::menu_items::system_appearance_is_dark()
                        != MENU_BUILT_FOR_DARK.load(Ordering::SeqCst)
                    {
                        MENU_DIRTY.store(true, Ordering::SeqCst);
                    }
                    let _ = Self::apply_pending_menu(&app);
                }
            })
        };
        builder.build(app)?;
        #[cfg(target_os = "macos")]
        MENU_DIRTY.store(false, Ordering::SeqCst);

        Self::refresh_menu_bar_title(app)?;

        Ok(())
    }

    pub fn set_visible(&self, visible: bool) -> Result<()> {
        let app = self.manager.app_handle();

        if visible {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                tray.set_visible(true)?;
            } else {
                self.create_tray_menu()?;
            }
            Self::refresh_icon(app)?;
        } else {
            if let Ok(mut task) = ANIMATION_TASK.lock()
                && let Some(handle) = task.take()
            {
                handle.abort();
            }

            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                tray.set_visible(false)?;
            }
        }

        Ok(())
    }

    pub fn set_title(&self, title: Option<&str>) -> Result<()> {
        let app = self.manager.app_handle();
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray.set_title(title)?;
        }
        Ok(())
    }

    pub fn set_schedule(&self, mut events: Vec<TrayScheduleEvent>) -> Result<()> {
        events.retain(|event| event.starts_at_ms.is_finite());
        events.sort_by(|left, right| {
            left.starts_at_ms
                .partial_cmp(&right.starts_at_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        *SCHEDULE.lock().unwrap() = events;

        let app = self.manager.app_handle();
        Self::refresh_menu_bar_title(app)?;
        Self::refresh_menu_if_agenda_changed(app)?;

        Self::restart_schedule_task(app);

        Ok(())
    }

    pub fn shows_events(&self) -> bool {
        SHOW_EVENTS.load(Ordering::SeqCst)
    }

    pub fn set_show_events(&self, show: bool) -> Result<()> {
        SHOW_EVENTS.store(show, Ordering::SeqCst);

        let app = self.manager.app_handle();
        Self::refresh_menu_bar_title(app)?;
        Self::rebuild_menu(app)?;
        Self::restart_schedule_task(app);
        Ok(())
    }

    fn refresh_menu_bar_title(app: &AppHandle<tauri::Wry>) -> Result<()> {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return Ok(());
        };

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as f64;
        let recording_title = RECORDING_TITLE.lock().unwrap().clone();
        let title = menu_bar_title(
            &SCHEDULE.lock().unwrap(),
            now_ms,
            SHOW_EVENTS.load(Ordering::SeqCst),
            IS_RECORDING.load(Ordering::SeqCst),
            recording_title.as_deref(),
            &crate::schedule::labels(),
        );
        let mut current_title = MENU_BAR_TITLE.lock().unwrap();

        if *current_title != title {
            // tray-icon currently treats None as a no-op on macOS.
            tray.set_title(Some(title.as_deref().unwrap_or("")))?;
            *current_title = title;
        }

        Ok(())
    }

    pub fn set_labels(&self, labels: TrayLabels) -> Result<()> {
        crate::schedule::set_labels(labels);

        let app = self.manager.app_handle();
        Self::refresh_menu_bar_title(app)?;
        // Every item title comes from these words, and none of them live in the
        // agenda, so comparing agendas would find nothing changed and leave the
        // menu in the language it was built with.
        Self::rebuild_menu(app)?;

        Ok(())
    }

    fn current_menu_model() -> TrayMenuModel {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as f64;
        let schedule = SCHEDULE.lock().unwrap();
        let show_events = SHOW_EVENTS.load(Ordering::SeqCst);
        menu_model(&schedule, now_ms, show_events, &crate::schedule::labels())
    }

    fn build_tray_menu(
        app: &AppHandle<tauri::Wry>,
        model: &TrayMenuModel,
    ) -> Result<Menu<tauri::Wry>> {
        let agenda = &model.sections;
        let menu = Menu::new(app)?;

        for (section_index, section) in agenda.iter().enumerate() {
            let heading = MenuItem::with_id(
                app,
                format!("anlg_tray_agenda_section_{section_index}"),
                &section.label,
                false,
                None::<&str>,
            )?;
            menu.append(&heading)?;

            for event in &section.events {
                let item = build_agenda_item(app, &event.id, &event.label, event.has_meeting_link)?;
                menu.append(&item)?;
            }
        }

        if !agenda.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }

        let recording = START_DISABLED.load(Ordering::SeqCst);

        menu.append(&TrayOpen::build(app)?)?;
        // The meeting under way, or the one about to start, is what the person
        // came to the menu for. Reaching it should not cost a submenu.
        if let Some(join_now) = &model.join_now {
            menu.append(&build_join_now_item(
                app,
                &join_now.event_id,
                &join_now.label,
                !recording,
            )?)?;
        }
        menu.append(&TrayStart::build_with_disabled(app, recording)?)?;
        menu.append(&TraySettings::build_for_tray(app)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        // Checking for updates lives in Settings; the tray only surfaces an
        // update that is already downloaded and waiting for a restart.
        if crate::updates_enabled() && TrayCheckUpdate::restart_pending() {
            menu.append(&TrayCheckUpdate::build(app)?)?;
        }
        menu.append(&TrayQuitCompletely::build(app)?)?;

        Ok(menu)
    }

    pub fn refresh_menu(&self) -> Result<()> {
        Self::rebuild_menu(self.manager.app_handle())
    }

    fn rebuild_menu(app: &AppHandle<tauri::Wry>) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            MENU_DIRTY.store(true, Ordering::SeqCst);
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        Self::install_menu(app)
    }

    fn install_menu(app: &AppHandle<tauri::Wry>) -> Result<()> {
        let model = Self::current_menu_model();
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray.set_menu(Some(Self::build_tray_menu(app, &model)?))?;
        }
        *MENU_MODEL.lock().unwrap() = Some(model);
        #[cfg(target_os = "macos")]
        {
            MENU_BUILT_FOR_DARK.store(
                crate::menu_items::system_appearance_is_dark(),
                Ordering::SeqCst,
            );
            MENU_DIRTY.store(false, Ordering::SeqCst);
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn apply_pending_menu(app: &AppHandle<tauri::Wry>) -> Result<()> {
        while MENU_DIRTY.swap(false, Ordering::SeqCst) {
            Self::install_menu(app)?;
        }
        Ok(())
    }

    fn refresh_menu_if_agenda_changed(app: &AppHandle<tauri::Wry>) -> Result<()> {
        let model = Self::current_menu_model();
        if MENU_MODEL.lock().unwrap().as_ref() == Some(&model) {
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        {
            *MENU_MODEL.lock().unwrap() = Some(model);
            MENU_DIRTY.store(true, Ordering::SeqCst);
            return Ok(());
        }

        #[cfg(not(target_os = "macos"))]
        Self::install_menu(app)
    }

    fn restart_schedule_task(app: &AppHandle<tauri::Wry>) {
        let mut task = SCHEDULE_TASK.lock().unwrap();
        if let Some(handle) = task.take() {
            handle.abort();
        }

        let next_delay = || {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as f64;
            next_schedule_refresh_ms(
                &SCHEDULE.lock().unwrap(),
                now_ms,
                SHOW_EVENTS.load(Ordering::SeqCst),
                IS_RECORDING.load(Ordering::SeqCst),
            )
        };
        let Some(initial_delay_ms) = next_delay() else {
            return;
        };

        let app = app.clone();
        *task = Some(tauri::async_runtime::spawn(async move {
            let mut delay_ms = initial_delay_ms;
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                if let Err(error) = Self::refresh_menu_bar_title(&app) {
                    tracing::warn!(%error, "failed to refresh menu bar title");
                }
                if let Err(error) = Self::refresh_menu_if_agenda_changed(&app) {
                    tracing::warn!(%error, "failed to refresh tray agenda");
                }
                let Some(next_delay_ms) = next_delay() else {
                    return;
                };
                delay_ms = next_delay_ms;
            }
        }));
    }

    pub fn set_recording(&self, recording: bool) -> Result<()> {
        IS_RECORDING.store(recording, Ordering::SeqCst);
        if !recording {
            *RECORDING_TITLE.lock().unwrap() = None;
        }

        let app = self.manager.app_handle();
        Self::refresh_menu_bar_title(app)?;
        Self::refresh_icon(app)?;
        Self::restart_schedule_task(app);
        Ok(())
    }

    pub fn set_recording_title(&self, title: Option<String>) -> Result<()> {
        *RECORDING_TITLE.lock().unwrap() = title.and_then(|title| {
            let title = title.trim();
            (!title.is_empty()).then(|| title.to_string())
        });
        Self::refresh_menu_bar_title(self.manager.app_handle())
    }

    pub fn set_degraded(&self, degraded: bool) -> Result<()> {
        IS_DEGRADED.store(degraded, Ordering::SeqCst);
        Self::refresh_icon(self.manager.app_handle())
    }

    pub fn set_update_available(&self, available: bool) -> Result<()> {
        IS_UPDATE_AVAILABLE.store(available, Ordering::SeqCst);
        Self::refresh_icon(self.manager.app_handle())
    }

    fn refresh_icon(app: &AppHandle<tauri::Wry>) -> Result<()> {
        {
            let mut task = ANIMATION_TASK.lock().unwrap();
            if let Some(handle) = task.take() {
                handle.abort();
            }

            if IS_RECORDING.load(Ordering::SeqCst) && !IS_DEGRADED.load(Ordering::SeqCst) {
                let app = app.clone();
                *task = Some(tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
                    let mut frame = 0usize;
                    loop {
                        interval.tick().await;
                        if let Some(tray) = app.tray_by_id(TRAY_ID)
                            && let Ok(image) = Image::from_bytes(RECORDING_FRAMES[frame])
                        {
                            let _ = tray.set_icon(Some(image));
                        }
                        frame = (frame + 1) % RECORDING_FRAMES.len();
                    }
                }));
                return Ok(());
            }
        }

        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return Ok(());
        };

        let state = if IS_UPDATE_AVAILABLE.load(Ordering::SeqCst) {
            TrayIconState::UpdateAvailable
        } else if IS_DEGRADED.load(Ordering::SeqCst) {
            TrayIconState::Degraded
        } else {
            TrayIconState::Default
        };

        tray.set_icon(Some(state.to_image()?))?;

        Ok(())
    }

    pub fn set_start_disabled(&self, disabled: bool) -> Result<()> {
        START_DISABLED.store(disabled, Ordering::SeqCst);
        Self::rebuild_menu(self.manager.app_handle())
    }
}

pub(crate) fn scheduled_event(event_id: &str) -> Option<TrayScheduleEvent> {
    SCHEDULE
        .lock()
        .unwrap()
        .iter()
        .find(|event| event.id == event_id)
        .cloned()
}

pub trait TrayPluginExt<R: tauri::Runtime> {
    fn tray(&self) -> Tray<'_, R, Self>
    where
        Self: tauri::Manager<R> + Sized;
}

impl<R: tauri::Runtime, T: tauri::Manager<R>> TrayPluginExt<R> for T {
    fn tray(&self) -> Tray<'_, R, Self>
    where
        Self: Sized,
    {
        Tray {
            manager: self,
            _runtime: std::marker::PhantomData,
        }
    }
}
