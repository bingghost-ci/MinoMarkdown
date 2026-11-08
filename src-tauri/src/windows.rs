use std::{collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct TransferStore(Mutex<HashMap<String, serde_json::Value>>);
pub struct ActiveWindow(pub Mutex<String>);
impl Default for ActiveWindow { fn default() -> Self { Self(Mutex::new("main".into())) } }

pub fn create(app: &AppHandle, transfers: &TransferStore, transfer: Option<serde_json::Value>) -> Result<String, String> {
    if let Some(value) = &transfer {
        let size = serde_json::to_vec(value).map_err(|_| "INVALID_TRANSFER")?.len();
        if size > 100 * 1024 * 1024 || !value.is_object() { return Err("INVALID_TRANSFER".into()); }
    }
    let label = format!("workspace-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    if let Some(value) = transfer { transfers.0.lock().map_err(|_| "IO_ERROR")?.insert(label.clone(), value); }
    match WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("MinoMarkdown")
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 520.0)
        .build() {
        Ok(window) => { let _ = window.set_focus(); Ok(label) }
        Err(_) => { let _ = transfers.0.lock().map(|mut map| map.remove(&label)); Err("WINDOW_CREATE_FAILED".into()) }
    }
}

#[tauri::command]
pub fn create_workspace_window(app: AppHandle, window: WebviewWindow, transfers: State<'_, TransferStore>, transfer: Option<serde_json::Value>) -> Result<String, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    create(&app, &transfers, transfer)
}

#[tauri::command]
pub fn take_window_transfer(window: WebviewWindow, transfers: State<'_, TransferStore>) -> Result<Option<serde_json::Value>, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    Ok(transfers.0.lock().map_err(|_| "IO_ERROR")?.remove(window.label()))
}

#[tauri::command]
pub fn close_workspace_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    window.destroy().map_err(|_| "WINDOW_CLOSE_FAILED")?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if !app.webview_windows().values().any(|item| crate::is_workspace_window(item.label())) { app.exit(0); }
    });
    Ok(())
}
