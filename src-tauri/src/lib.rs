mod documents;
mod drafts;
mod fs;
mod markdown_images;
mod workspace;
mod snapshots;
mod open_intents;
mod recent;
mod settings;
mod staging;
mod windows;
mod native_menu;
mod app_assets;
mod ai;
mod system_fonts;
mod file_kinds;
mod text_encoding;
mod positions;
mod context_menu;

use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItemKind, PredefinedMenuItem, Submenu};

pub(crate) fn is_workspace_window(label: &str) -> bool { label == "main" || label.starts_with("workspace-") }
/// The first line of every command: only the app's own document windows may call it.
pub(crate) fn require_workspace_window(window: &tauri::WebviewWindow) -> Result<(), String> { require_workspace_label(window.label()) }
pub(crate) fn require_workspace_label(label: &str) -> Result<(), String> { if is_workspace_window(label) { Ok(()) } else { Err("OUT_OF_SCOPE".into()) } }
fn focused_workspace(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows().into_values().find(|window| is_workspace_window(window.label()) && window.is_focused().unwrap_or(false))
        .or_else(|| app.state::<windows::ActiveWindow>().0.lock().ok().and_then(|label| app.get_webview_window(&label)))
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| app.webview_windows().into_values().find(|window| is_workspace_window(window.label())))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("mino-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let label = ctx.webview_label().to_owned();
            tauri::async_runtime::spawn_blocking(move || responder.respond(documents::asset_response(&app, &label, request.uri().path())));
        })
        .manage(documents::DocumentStore::default())
        .manage(staging::StagingStore::default())
        .manage(workspace::WorkspaceStore::default())
        .manage(workspace::SearchState::default())
        .manage(snapshots::SnapshotStore::default())
        .manage(open_intents::IntentStore::default())
        .manage(windows::TransferStore::default())
        .manage(windows::ActiveWindow::default())
        .manage(ai::AiState::default())
        .setup(|app| {
            let handle = app.handle();
            windows::show_if_webview_stalls(handle.clone(), "main".into());
            // Listing recent files asks the disk about each of them, and one on a volume that does not answer
            // would hold up the launch. The list is read off the main thread and the menu filled in when it is ready (T99).
            let recent_handle = handle.clone();
            std::thread::spawn(move || recent::refresh_menu(&recent_handle));
            #[cfg(target_os = "macos")]
            native_menu::install_dock_menu(handle);
            Ok(())
        })
        .menu(|app| {
            let menu = Menu::default(app)?;
            // The settings file is read once at launch; the menu is built in its language and remembers it.
            let english = settings::initial_language(app) == "en-US";
            native_menu::built_in(english);
            let recent_menu = Submenu::with_id(app, "open-recent", native_menu::label("open-recent", english), true)?;
            app.manage(recent::RecentMenu(recent_menu.clone()));
            for item in menu.items()? {
                if let MenuItemKind::Submenu(submenu) = item {
                    let title = submenu.text()?;
                    if title == "File" || title == "文件" {
                        submenu.prepend_items(&[
                            &native_menu::item(app, "new", english)?,
                            &native_menu::item(app, "new-window", english)?,
                            &native_menu::item(app, "open", english)?,
                            &native_menu::item(app, "open-folder", english)?,
                            &recent_menu,
                            &PredefinedMenuItem::separator(app)?,
                            &native_menu::item(app, "save", english)?,
                            &native_menu::item(app, "save-as", english)?,
                            &native_menu::item(app, "recover-drafts", english)?,
                            &native_menu::item(app, "close-tab", english)?,
                            &PredefinedMenuItem::separator(app)?,
                            &native_menu::item(app, "export-md", english)?,
                            &native_menu::item(app, "export-text", english)?,
                            &native_menu::item(app, "export-html", english)?,
                            &native_menu::item(app, "print", english)?,
                            &PredefinedMenuItem::separator(app)?,
                        ])?;
                    } else if title == "Edit" || title == "编辑" {
                        submenu.append_items(&[
                            &PredefinedMenuItem::separator(app)?,
                            &native_menu::item(app, "find", english)?,
                        ])?;
                    } else if title == "View" || title == "视图" {
                        submenu.prepend_items(&[
                            &native_menu::item(app, "toggle-reading", english)?,
                            &native_menu::item(app, "toggle-source", english)?,
                            &native_menu::item(app, "view-toolbar", english)?,
                            &native_menu::item(app, "view-sidebar", english)?,
                            &native_menu::item(app, "view-outline", english)?,
                            &PredefinedMenuItem::separator(app)?,
                            &native_menu::item(app, "zoom-in", english)?,
                            &native_menu::item(app, "zoom-out", english)?,
                            &native_menu::item(app, "zoom-reset", english)?,
                            &PredefinedMenuItem::separator(app)?,
                        ])?;
                    } else if title == app.package_info().name || title == "Mino" {
                        submenu.insert_items(&[
                            &native_menu::item(app, "preferences", english)?,
                            &PredefinedMenuItem::separator(app)?,
                        ], 2)?;
                        for existing in submenu.items()? {
                            if let MenuItemKind::Predefined(item) = existing {
                                let text = item.text()?;
                                if text.starts_with("Quit ") || text.starts_with("退出") {
                                    submenu.remove(&item)?;
                                }
                            }
                        }
                        submenu.append(&native_menu::item(app, "quit", english)?)?;
                    }
                }
            }
            let format_position = menu.items()?.iter().position(|item| matches!(item, MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|title| title == "Edit" || title == "编辑"))).map_or(0, |index| index + 1);
            let format_menu = Submenu::with_id_and_items(app, "format", native_menu::label("format", english), true, &[
                &native_menu::item(app, "format-paragraph", english)?,
                &native_menu::item(app, "format-heading1", english)?,
                &native_menu::item(app, "format-heading2", english)?,
                &native_menu::item(app, "format-heading3", english)?,
                &native_menu::item(app, "format-heading4", english)?,
                &native_menu::item(app, "format-heading5", english)?,
                &native_menu::item(app, "format-heading6", english)?,
                &PredefinedMenuItem::separator(app)?,
                &native_menu::item(app, "format-bold", english)?,
                &native_menu::item(app, "format-italic", english)?,
                &native_menu::item(app, "format-strike", english)?,
                &native_menu::item(app, "format-inline-code", english)?,
                &PredefinedMenuItem::separator(app)?,
                &native_menu::item(app, "format-bullet", english)?,
                &native_menu::item(app, "format-ordered", english)?,
                &native_menu::item(app, "format-task", english)?,
                &native_menu::item(app, "format-quote", english)?,
                &native_menu::item(app, "format-code-block", english)?,
                &PredefinedMenuItem::separator(app)?,
                &native_menu::item(app, "format-link", english)?,
                &PredefinedMenuItem::separator(app)?,
                &Submenu::with_id_and_items(app, "transform", native_menu::label("transform", english), true, &[
                    &native_menu::item(app, "transform-upper", english)?,
                    &native_menu::item(app, "transform-lower", english)?,
                    &native_menu::item(app, "transform-title", english)?,
                    &native_menu::item(app, "transform-cjk-spacing", english)?,
                    &native_menu::item(app, "transform-full-punct", english)?,
                    &native_menu::item(app, "transform-half-punct", english)?,
                ])?,
            ])?;
            menu.insert(&format_menu, format_position)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                for window in app.webview_windows().into_values().filter(|window| is_workspace_window(window.label())) {
                    let _ = app.emit_to(window.label(), "app-quit-requested", ());
                }
            } else if event.id().as_ref() == "new-window" {
                let _ = windows::create(app, &app.state::<windows::TransferStore>(), None);
            } else if let Some(window) = focused_workspace(app) {
                // A right-click menu item never runs as the main-menu item of the same name (T105).
                if let Some(id) = event.id().as_ref().strip_prefix(context_menu::PREFIX) { context_menu::chosen(app, window.label(), id); return; }
                let _ = app.emit_to(window.label(), "menu-action", event.id().as_ref());
            }
        })
        .on_window_event(|window, event| {
            if !is_workspace_window(window.label()) { return; }
            if let tauri::WindowEvent::Focused(true) = event {
                if let Ok(mut active) = window.app_handle().state::<windows::ActiveWindow>().0.lock() { *active = window.label().into(); }
            }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if paths.is_empty() {
                    let _ = window.app_handle().emit_to(window.label(), "open-intents-empty-drop", ());
                } else if open_intents::enqueue_dropped(&window.app_handle().state::<open_intents::IntentStore>(), paths, window.label()) {
                    let _ = window.app_handle().emit_to(window.label(), "open-intents-available", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_assets::read_app_asset,
            documents::open_document,
            documents::release_document,
            documents::find_open_document,
            documents::choose_unsaved_action,
            documents::check_document_revision,
            documents::read_disk_version,
            documents::reload_document,
            documents::read_document_range,
            positions::get_reading_position,
            positions::set_reading_position,
            native_menu::set_menu_state,
            context_menu::show_context_menu,
            context_menu::reveal_in_finder,
            context_menu::copy_file_path,
            context_menu::write_clipboard_text,
            context_menu::rename_document,
            context_menu::trash_document,
            documents::save_conflict_copy,
            documents::save_as_document,
            documents::save_document,
            staging::stage_binary,
            staging::read_staged,
            documents::export_html,
            documents::save_note_beside,
            drafts::write_draft,
            drafts::list_drafts,
            drafts::read_draft,
            drafts::discard_draft,
            workspace::choose_workspace,
            workspace::list_children,
            workspace::search_workspace,
            workspace::open_workspace_document,
            workspace::release_workspace,
            workspace::create_workspace_entry,
            workspace::rename_workspace_entry,
            workspace::trash_workspace_entry,
            snapshots::create_snapshot,
            snapshots::release_snapshot,
            snapshots::read_snapshot,
            snapshots::export_snapshot_md,
            open_intents::take_open_intents,
            open_intents::open_intent_document,
            open_intents::open_intent_workspace,
            open_intents::read_intent_image,
            open_intents::discard_open_intent,
            recent::remember_recent_document,
            recent::remember_recent_workspace,
            recent::choose_recent_file,
            recent::choose_recent_workspace,
            recent::remember_session,
            recent::restore_session,
            settings::get_settings,
            settings::update_settings,
            windows::create_workspace_window,
            windows::show_workspace_window,
            windows::open_external,
            windows::take_window_transfer,
            windows::close_workspace_window,
            system_fonts::list_system_fonts,
            ai::ai_get_config,
            ai::ai_set_config,
            ai::ai_set_key,
            ai::ai_clear_key,
            ai::ai_list_models,
            ai::ai_chat,
            ai::ai_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Mino")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let target = focused_workspace(app).map(|window| window.label().to_owned()).unwrap_or_else(|| "main".into());
                if open_intents::enqueue_opened(&app.state::<open_intents::IntentStore>(), &urls, &target) {
                    if let Some(window) = app.get_webview_window(&target) {
                        let _ = app.emit_to(window.label(), "open-intents-available", ());
                    }
                }
            }
        });
}
