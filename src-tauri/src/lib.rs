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

use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};

pub(crate) fn is_workspace_window(label: &str) -> bool { label == "main" || label.starts_with("workspace-") }
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
        .setup(|app| {
            let handle = app.handle();
            native_menu::set_language(handle, &settings::initial_language(handle));
            windows::show_if_webview_stalls(handle.clone(), "main".into());
            recent::refresh_menu(handle);
            #[cfg(target_os = "macos")]
            native_menu::install_dock_menu(handle);
            Ok(())
        })
        .menu(|app| {
            let menu = Menu::default(app)?;
            let english = settings::initial_language(app) == "en-US";
            let recent_menu = Submenu::with_id(app, "open-recent", native_menu::label("open-recent", english), true)?;
            app.manage(recent::RecentMenu(recent_menu.clone()));
            for item in menu.items()? {
                if let MenuItemKind::Submenu(submenu) = item {
                    let title = submenu.text()?;
                    if title == "File" || title == "文件" {
                        submenu.prepend_items(&[
                            &MenuItem::with_id(app, "new", native_menu::label("new", english), true, Some("Cmd+N"))?,
                            &MenuItem::with_id(app, "new-window", native_menu::label("new-window", english), true, Some("Cmd+Shift+N"))?,
                            &MenuItem::with_id(app, "open", native_menu::label("open", english), true, Some("Cmd+O"))?,
                            &MenuItem::with_id(app, "open-folder", native_menu::label("open-folder", english), true, Some("Cmd+Shift+O"))?,
                            &recent_menu,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(app, "save", native_menu::label("save", english), true, Some("Cmd+S"))?,
                            &MenuItem::with_id(app, "save-as", native_menu::label("save-as", english), true, Some("Cmd+Shift+S"))?,
                            &MenuItem::with_id(app, "recover-drafts", native_menu::label("recover-drafts", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "close-tab", native_menu::label("close-tab", english), true, Some("Cmd+W"))?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(app, "export-md", native_menu::label("export-md", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "export-text", native_menu::label("export-text", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "export-html", native_menu::label("export-html", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "print", native_menu::label("print", english), true, Some("Cmd+P"))?,
                            &PredefinedMenuItem::separator(app)?,
                        ])?;
                    } else if title == "Edit" || title == "编辑" {
                        submenu.append_items(&[
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(app, "find", native_menu::label("find", english), true, Some("Cmd+F"))?,
                        ])?;
                    } else if title == "View" || title == "视图" {
                        submenu.prepend_items(&[
                            &MenuItem::with_id(app, "toggle-source", native_menu::label("toggle-source", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "view-toolbar", native_menu::label("view-toolbar", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "view-sidebar", native_menu::label("view-sidebar", english), true, None::<&str>)?,
                            &MenuItem::with_id(app, "view-outline", native_menu::label("view-outline", english), true, None::<&str>)?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(app, "zoom-in", native_menu::label("zoom-in", english), true, Some("Cmd+="))?,
                            &MenuItem::with_id(app, "zoom-out", native_menu::label("zoom-out", english), true, Some("Cmd+-"))?,
                            &MenuItem::with_id(app, "zoom-reset", native_menu::label("zoom-reset", english), true, Some("Cmd+0"))?,
                            &PredefinedMenuItem::separator(app)?,
                        ])?;
                    } else if title == app.package_info().name || title == "MinoMarkdown" {
                        submenu.insert_items(&[
                            &MenuItem::with_id(app, "preferences", native_menu::label("preferences", english), true, Some("Cmd+,"))?,
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
                        submenu.append(&MenuItem::with_id(app, "quit", native_menu::label("quit", english), true, Some("Cmd+Q"))?)?;
                    }
                }
            }
            let format_position = menu.items()?.iter().position(|item| matches!(item, MenuItemKind::Submenu(submenu) if submenu.text().is_ok_and(|title| title == "Edit" || title == "编辑"))).map_or(0, |index| index + 1);
            let format_menu = Submenu::with_id_and_items(app, "format", native_menu::label("format", english), true, &[
                &MenuItem::with_id(app, "format-paragraph", native_menu::label("format-paragraph", english), true, Some("Cmd+Alt+0"))?,
                &MenuItem::with_id(app, "format-heading1", native_menu::label("format-heading1", english), true, Some("Cmd+Alt+1"))?,
                &MenuItem::with_id(app, "format-heading2", native_menu::label("format-heading2", english), true, Some("Cmd+Alt+2"))?,
                &MenuItem::with_id(app, "format-heading3", native_menu::label("format-heading3", english), true, Some("Cmd+Alt+3"))?,
                &MenuItem::with_id(app, "format-heading4", native_menu::label("format-heading4", english), true, Some("Cmd+Alt+4"))?,
                &MenuItem::with_id(app, "format-heading5", native_menu::label("format-heading5", english), true, Some("Cmd+Alt+5"))?,
                &MenuItem::with_id(app, "format-heading6", native_menu::label("format-heading6", english), true, Some("Cmd+Alt+6"))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "format-bold", native_menu::label("format-bold", english), true, Some("Cmd+B"))?,
                &MenuItem::with_id(app, "format-italic", native_menu::label("format-italic", english), true, Some("Cmd+I"))?,
                &MenuItem::with_id(app, "format-strike", native_menu::label("format-strike", english), true, Some("Cmd+Alt+X"))?,
                &MenuItem::with_id(app, "format-inline-code", native_menu::label("format-inline-code", english), true, Some("Cmd+E"))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "format-bullet", native_menu::label("format-bullet", english), true, Some("Cmd+Alt+8"))?,
                &MenuItem::with_id(app, "format-ordered", native_menu::label("format-ordered", english), true, Some("Cmd+Alt+7"))?,
                &MenuItem::with_id(app, "format-task", native_menu::label("format-task", english), true, None::<&str>)?,
                &MenuItem::with_id(app, "format-quote", native_menu::label("format-quote", english), true, Some("Cmd+Shift+B"))?,
                &MenuItem::with_id(app, "format-code-block", native_menu::label("format-code-block", english), true, Some("Cmd+Alt+C"))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "format-link", native_menu::label("format-link", english), true, Some("Cmd+K"))?,
                &PredefinedMenuItem::separator(app)?,
                &Submenu::with_id_and_items(app, "transform", native_menu::label("transform", english), true, &[
                    &MenuItem::with_id(app, "transform-upper", native_menu::label("transform-upper", english), true, None::<&str>)?,
                    &MenuItem::with_id(app, "transform-lower", native_menu::label("transform-lower", english), true, None::<&str>)?,
                    &MenuItem::with_id(app, "transform-title", native_menu::label("transform-title", english), true, None::<&str>)?,
                    &MenuItem::with_id(app, "transform-cjk-spacing", native_menu::label("transform-cjk-spacing", english), true, None::<&str>)?,
                    &MenuItem::with_id(app, "transform-full-punct", native_menu::label("transform-full-punct", english), true, None::<&str>)?,
                    &MenuItem::with_id(app, "transform-half-punct", native_menu::label("transform-half-punct", english), true, None::<&str>)?,
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
            documents::open_document,
            documents::release_document,
            documents::choose_unsaved_action,
            documents::check_document_revision,
            documents::read_disk_version,
            documents::reload_document,
            documents::save_conflict_copy,
            documents::save_as_document,
            documents::save_document,
            staging::stage_binary,
            staging::read_staged,
            documents::export_html,
            documents::export_source_markdown,
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
            recent::list_recent,
            recent::remember_recent_document,
            recent::remember_recent_workspace,
            recent::remove_recent,
            recent::reorder_recent,
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
        ])
        .build(tauri::generate_context!())
        .expect("failed to build MinoMarkdown")
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
