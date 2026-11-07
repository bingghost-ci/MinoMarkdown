mod documents;
mod drafts;
mod fs;
mod markdown_images;
mod workspace;
mod snapshots;
mod open_intents;
mod recent;
mod settings;

use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(documents::DocumentStore::default())
        .manage(workspace::WorkspaceStore::default())
        .manage(snapshots::SnapshotStore::default())
        .manage(open_intents::IntentStore::default())
        .menu(|app| {
            let menu = Menu::default(app)?;
            for item in menu.items()? {
                if let MenuItemKind::Submenu(file) = item {
                    if file.text()? == "File" {
                        file.prepend_items(&[
                            &MenuItem::with_id(app, "new", "新建文档", true, Some("Cmd+N"))?,
                            &MenuItem::with_id(app, "open", "打开文件…", true, Some("Cmd+O"))?,
                            &MenuItem::with_id(app, "open-folder", "打开文件夹…", true, Some("Cmd+Shift+O"))?,
                            &PredefinedMenuItem::separator(app)?,
                            &MenuItem::with_id(app, "save", "保存", true, Some("Cmd+S"))?,
                            &MenuItem::with_id(app, "save-as", "另存为…", true, Some("Cmd+Shift+S"))?,
                            &PredefinedMenuItem::separator(app)?,
                        ])?;
                    }
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| { let _ = app.emit("menu-action", event.id().as_ref()); })
        .on_webview_event(|webview, event| {
            if webview.label() != "main" { return; }
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if open_intents::enqueue_dropped(&webview.app_handle().state::<open_intents::IntentStore>(), paths) {
                    let _ = webview.emit("open-intents-available", ());
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
            documents::read_asset,
            documents::export_html,
            documents::export_source_markdown,
            drafts::write_draft,
            drafts::list_drafts,
            drafts::read_draft,
            drafts::discard_draft,
            workspace::choose_workspace,
            workspace::list_children,
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
            recent::choose_recent_file,
            recent::choose_recent_workspace,
            settings::get_settings,
            settings::update_settings,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build MinoMarkdown")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                if open_intents::enqueue_opened(&app.state::<open_intents::IntentStore>(), &urls) {
                    let _ = app.emit("open-intents-available", ());
                }
            }
        });
}
