//! Right-click menus (T105). The frontend describes a menu from a fixed set of item ids; Rust labels it in the
//! menu language, shows it as a native macOS menu, and reports the chosen item to the window as
//! `context-action`. File actions here resolve opaque document or sidebar tokens, never paths from the webview.
use crate::documents::{granted_file, relocating, removing, DocumentStore};
use crate::workspace::{self, WorkspaceStore};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, State, WebviewWindow, Wry};

/// Ids of a menu item chosen from a right-click menu carry this prefix, so they never run as main-menu items.
pub const PREFIX: &str = "ctx:";
const MAX_ITEMS: usize = 120;
const MAX_DEPTH: usize = 2;
const MAX_CLIPBOARD_BYTES: usize = 20 * 1024 * 1024;

/// Items only a right-click menu has. Main-menu ids (save, format-bold, …) may be used too.
pub const CONTEXT_ITEMS: &[&str] = &[
    "cut", "copy", "paste", "select-all", "paste-plain", "copy-markdown", "copy-plain", "find-selection", "search-folder",
    "ai", "ai-explain", "ai-translate", "ai-rewrite", "ai-continue", "ai-ask", "paragraph", "insert", "insert-table",
    "insert-rule", "format-clear", "export", "reveal", "copy-path", "rename", "trash", "open-link", "copy-link", "edit-link",
    "move-window", "close", "close-others", "close-right", "close-all", "open-entry", "new-file", "new-folder", "refresh",
    "close-folder", "close-all-folders",
];
/// Items AppKit performs itself on the focused view; a disabled one is drawn as a plain disabled item.
const PREDEFINED: &[&str] = &["cut", "copy", "paste", "select-all"];

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Entry {
    Item { id: String, #[serde(default = "enabled")] enabled: bool },
    Separator,
    Submenu { id: String, items: Vec<Entry> },
}
fn enabled() -> bool { true }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContextAction { id: String, text: Option<String> }

fn known(id: &str) -> bool {
    !crate::native_menu::label(id, false).is_empty() && (CONTEXT_ITEMS.contains(&id) || crate::native_menu::MENU_ITEMS.iter().any(|(item, _)| *item == id) || id == "format" || id == "transform")
}

/// Rejects unknown ids, nesting deeper than a submenu in a submenu, and oversized menus.
pub fn validate(entries: &[Entry]) -> Result<(), String> {
    fn walk(entries: &[Entry], depth: usize, count: &mut usize) -> Result<(), String> {
        if depth > MAX_DEPTH { return Err("INVALID_MENU".into()); }
        for entry in entries {
            *count += 1;
            if *count > MAX_ITEMS { return Err("INVALID_MENU".into()); }
            match entry {
                Entry::Item { id, .. } => if !known(id) { return Err("INVALID_MENU".into()); },
                Entry::Separator => {}
                Entry::Submenu { id, items } => { if !known(id) { return Err("INVALID_MENU".into()); } walk(items, depth + 1, count)?; }
            }
        }
        Ok(())
    }
    walk(entries, 0, &mut 0)
}

enum Built { Item(MenuItem<Wry>), Predefined(PredefinedMenuItem<Wry>), Submenu(Submenu<Wry>) }

fn build(app: &AppHandle, entries: &[Entry], english: bool) -> tauri::Result<Vec<Built>> {
    let mut built = Vec::new();
    for entry in entries {
        built.push(match entry {
            Entry::Separator => Built::Predefined(PredefinedMenuItem::separator(app)?),
            Entry::Item { id, enabled } if *enabled && PREDEFINED.contains(&id.as_str()) => {
                let text = Some(crate::native_menu::label(id, english));
                Built::Predefined(match id.as_str() {
                    "cut" => PredefinedMenuItem::cut(app, text)?,
                    "copy" => PredefinedMenuItem::copy(app, text)?,
                    "paste" => PredefinedMenuItem::paste(app, text)?,
                    _ => PredefinedMenuItem::select_all(app, text)?,
                })
            }
            Entry::Item { id, enabled } => Built::Item(MenuItem::with_id(app, format!("{PREFIX}{id}"), crate::native_menu::label(id, english), *enabled, crate::native_menu::accelerator(id))?),
            Entry::Submenu { id, items } => {
                let submenu = Submenu::with_id(app, format!("{PREFIX}{id}"), crate::native_menu::label(id, english), true)?;
                for child in build(app, items, english)? { append_to_submenu(&submenu, &child)?; }
                Built::Submenu(submenu)
            }
        });
    }
    Ok(built)
}
fn append_to_submenu(submenu: &Submenu<Wry>, item: &Built) -> tauri::Result<()> {
    match item { Built::Item(item) => submenu.append(item), Built::Predefined(item) => submenu.append(item), Built::Submenu(item) => submenu.append(item) }
}
fn append_to_menu(menu: &Menu<Wry>, item: &Built) -> tauri::Result<()> {
    match item { Built::Item(item) => menu.append(item), Built::Predefined(item) => menu.append(item), Built::Submenu(item) => menu.append(item) }
}

/// Shows the menu at the pointer. It returns when the menu closes; the chosen item arrives as `context-action`.
#[tauri::command(async)]
pub fn show_context_menu(app: AppHandle, window: WebviewWindow, items: Vec<Entry>) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    validate(&items)?;
    if items.is_empty() { return Ok(()); }
    let english = crate::native_menu::english();
    let menu = Menu::new(&app).map_err(|_| "IO_ERROR")?;
    for item in build(&app, &items, english).map_err(|_| "IO_ERROR")? { append_to_menu(&menu, &item).map_err(|_| "IO_ERROR")?; }
    window.popup_menu(&menu).map_err(|_| "IO_ERROR".into())
}

/// Called from the app's menu handler for an id with `PREFIX`. "Paste as plain text" reads the clipboard here,
/// so the webview gets its text only when the user chose that item.
pub fn chosen(app: &AppHandle, window: &str, id: &str) {
    let text = if id == "paste-plain" { clipboard::read() } else { None };
    let _ = app.emit_to(window, "context-action", ContextAction { id: id.to_owned(), text });
}

/// A document token or a sidebar entry token, resolved to its checked path.
fn target_path(documents: &DocumentStore, entries: &WorkspaceStore, document_token: Option<String>, entry_token: Option<String>) -> Result<PathBuf, String> {
    match (document_token, entry_token) {
        (Some(token), None) => granted_file(documents, &token),
        (None, Some(token)) => workspace::entry_path(entries, &token).map(|(path, _)| path),
        _ => Err("OUT_OF_SCOPE".into()),
    }
}

#[tauri::command(async)]
pub fn reveal_in_finder(window: WebviewWindow, documents: State<'_, DocumentStore>, entries: State<'_, WorkspaceStore>, document_token: Option<String>, entry_token: Option<String>) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let path = target_path(&documents, &entries, document_token, entry_token)?;
    let status = std::process::Command::new("/usr/bin/open").arg("-R").arg("--").arg(&path).status().map_err(|_| "IO_ERROR")?;
    if status.success() { Ok(()) } else { Err("IO_ERROR".into()) }
}

/// Puts the full path on the clipboard without handing it to the webview.
#[tauri::command(async)]
pub fn copy_file_path(window: WebviewWindow, documents: State<'_, DocumentStore>, entries: State<'_, WorkspaceStore>, document_token: Option<String>, entry_token: Option<String>) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let path = target_path(&documents, &entries, document_token, entry_token)?;
    clipboard::write(path.to_str().ok_or("INVALID_PATH")?)
}

#[tauri::command(async)]
pub fn write_clipboard_text(window: WebviewWindow, text: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    if text.len() > MAX_CLIPBOARD_BYTES { return Err("DOCUMENT_TOO_LARGE".into()); }
    clipboard::write(&text)
}

/// Renames an open document's file in place. It keeps its kind, as a rename in the sidebar does.
#[tauri::command(async)]
pub fn rename_document(app: AppHandle, window: WebviewWindow, documents: State<'_, DocumentStore>, entries: State<'_, WorkspaceStore>, token: String, new_name: String) -> Result<String, String> {
    crate::require_workspace_window(&window)?;
    let source = granted_file(&documents, &token)?;
    if !workspace::valid_rename(&source, &new_name, false) { return Err("INVALID_NAME".into()); }
    let target = relocating(&documents, &source, || workspace::rename_entry_at(&source, &new_name, false))?;
    workspace::relocate_entries(&entries, &source, &target)?;
    crate::positions::relocate(&app, &source, &target);
    Ok(new_name)
}

/// Moves an open document's file to the Trash. Its grants end here; the tab is closed by the frontend.
#[tauri::command(async)]
pub fn trash_document(window: WebviewWindow, documents: State<'_, DocumentStore>, entries: State<'_, WorkspaceStore>, token: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let path = granted_file(&documents, &token)?;
    removing(&documents, &path, || workspace::move_to_trash(&path))?;
    workspace::forget_entries(&entries, &path)
}

#[cfg(target_os = "macos")]
mod clipboard {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    pub fn read() -> Option<String> {
        let board = NSPasteboard::generalPasteboard();
        let text = board.stringForType(unsafe { NSPasteboardTypeString })?.to_string();
        if text.len() > super::MAX_CLIPBOARD_BYTES { None } else { Some(text) }
    }
    pub fn write(text: &str) -> Result<(), String> {
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        if board.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString }) { Ok(()) } else { Err("IO_ERROR".into()) }
    }
}
#[cfg(not(target_os = "macos"))]
mod clipboard {
    pub fn read() -> Option<String> { None }
    pub fn write(_text: &str) -> Result<(), String> { Err("UNSUPPORTED_PLATFORM".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> Entry { Entry::Item { id: id.into(), enabled: true } }

    #[test]
    fn every_context_item_is_labeled_in_both_languages() {
        for id in CONTEXT_ITEMS { assert!(!crate::native_menu::label(id, false).is_empty() && !crate::native_menu::label(id, true).is_empty(), "{id}"); }
    }

    #[test]
    fn menus_take_only_known_items_and_stay_small() {
        assert!(validate(&[item("cut"), Entry::Separator, item("save"), Entry::Submenu { id: "format".into(), items: vec![item("format-bold"), Entry::Submenu { id: "transform".into(), items: vec![item("transform-upper")] }] }]).is_ok());
        assert_eq!(validate(&[item("rm -rf")]), Err("INVALID_MENU".into()));
        assert_eq!(validate(&[item("")]), Err("INVALID_MENU".into()));
        assert_eq!(validate(&[Entry::Submenu { id: "unknown".into(), items: vec![] }]), Err("INVALID_MENU".into()));
        let deep = Entry::Submenu { id: "ai".into(), items: vec![Entry::Submenu { id: "ai".into(), items: vec![Entry::Submenu { id: "ai".into(), items: vec![item("copy")] }] }] };
        assert_eq!(validate(&[deep]), Err("INVALID_MENU".into()));
        assert_eq!(validate(&(0..=MAX_ITEMS).map(|_| Entry::Separator).collect::<Vec<_>>()), Err("INVALID_MENU".into()));
    }

    #[test]
    fn the_menu_description_is_read_from_tagged_json() {
        let entries: Vec<Entry> = serde_json::from_str(r#"[{"type":"item","id":"copy","enabled":false},{"type":"separator"},{"type":"submenu","id":"ai","items":[{"type":"item","id":"ai-explain"}]}]"#).unwrap();
        assert!(matches!(&entries[0], Entry::Item { id, enabled: false } if id == "copy"));
        assert!(matches!(&entries[2], Entry::Submenu { items, .. } if matches!(&items[0], Entry::Item { enabled: true, .. })));
        assert!(validate(&entries).is_ok());
    }
}
