use std::{collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Mino")
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 520.0)
        .visible(false);
    // Like the main window (tauri.conf.json): no system title bar, the traffic lights sit on the app's own top row.
    // tao makes the title bar `button height + y` tall and keeps the buttons 10 pt above its bottom, so y = 24 puts
    // their top 14 pt down and their center on the center of the 44 pt top row (measured through Accessibility).
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(tauri::LogicalPosition::new(16.0, 24.0));
    match builder.build() {
        Ok(_) => { show_if_webview_stalls(app.clone(), label.clone()); Ok(label) }
        Err(_) => { let _ = transfers.0.lock().map(|mut map| map.remove(&label)); Err("WINDOW_CREATE_FAILED".into()) }
    }
}

/// Windows start hidden until their webview has applied saved settings. If it never reports in, show it anyway.
pub fn show_if_webview_stalls(app: AppHandle, label: String) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        if let Some(window) = app.get_webview_window(&label) {
            if !window.is_visible().unwrap_or(true) { let _ = window.show(); let _ = window.set_focus(); }
        }
    });
}

/// The one settings window (T113). It is a native window so it can sit beside the document or on another display.
pub const SETTINGS_WINDOW: &str = "settings";
const SETTINGS_TABS: &[&str] = &["appearance", "code", "diagrams", "typography", "reading", "workspace", "ai"];
/// The page the settings window should show, read by its webview when it is ready.
pub struct SettingsTab(pub Mutex<String>);
impl Default for SettingsTab { fn default() -> Self { Self(Mutex::new(SETTINGS_TABS[0].into())) } }

pub fn settings_title(language: &str) -> &'static str { if language == "en-US" { "Settings" } else { "设置" } }
pub fn settings_focused(app: &AppHandle) -> bool { app.get_webview_window(SETTINGS_WINDOW).is_some_and(|window| window.is_focused().unwrap_or(false)) }
pub fn close_settings(app: &AppHandle) { if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) { let _ = window.destroy(); } }

/// Shows the settings window, creating it when there is none. `tab` selects a page; without it an open window keeps its page.
pub fn open_settings(app: &AppHandle, tab: Option<&str>) -> Result<(), String> {
    if let Some(tab) = tab {
        if !SETTINGS_TABS.contains(&tab) { return Err("INVALID_SETTINGS".into()); }
        *app.state::<SettingsTab>().0.lock().map_err(|_| "IO_ERROR")? = tab.into();
    }
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        if let Some(tab) = tab { let _ = app.emit_to(SETTINGS_WINDOW, "settings-tab", tab); }
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|_| "WINDOW_SHOW_FAILED".into());
    }
    let language = crate::settings::initial_language(app);
    WebviewWindowBuilder::new(app, SETTINGS_WINDOW, WebviewUrl::App("index.html".into()))
        .title(settings_title(&language))
        .inner_size(720.0, 760.0)
        .min_inner_size(600.0, 420.0)
        .maximizable(false)
        .visible(false)
        .build()
        .map_err(|_| "WINDOW_CREATE_FAILED")?;
    show_if_webview_stalls(app.clone(), SETTINGS_WINDOW.into());
    Ok(())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle, window: WebviewWindow, tab: Option<String>) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    open_settings(&app, tab.as_deref())
}

/// Called by the settings window once its page has the saved settings: shows it and tells it which page to open.
/// Shows a window that was created hidden, once its page has its style, and brings it to the front.
fn reveal(window: &WebviewWindow) -> Result<(), String> {
    if !window.is_visible().unwrap_or(false) { window.show().map_err(|_| "WINDOW_SHOW_FAILED")?; let _ = window.set_focus(); }
    Ok(())
}

#[tauri::command]
pub fn settings_window_ready(window: WebviewWindow, tab: State<'_, SettingsTab>) -> Result<String, String> {
    if window.label() != SETTINGS_WINDOW { return Err("OUT_OF_SCOPE".into()); }
    reveal(&window)?;
    Ok(tab.0.lock().map_err(|_| "IO_ERROR")?.clone())
}

#[tauri::command]
pub fn close_settings_window(window: WebviewWindow) -> Result<(), String> {
    if window.label() != SETTINGS_WINDOW { return Err("OUT_OF_SCOPE".into()); }
    window.destroy().map_err(|_| "WINDOW_CLOSE_FAILED".into())
}

fn external_url(raw: &str) -> Option<String> {
    let url = tauri::Url::parse(raw).ok()?;
    matches!(url.scheme(), "http" | "https" | "mailto").then(|| url.to_string())
}

/// Hands a web or mail link to the system. Only these schemes ever leave the app.
#[tauri::command(async)]
pub fn open_external(window: WebviewWindow, url: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let url = external_url(&url).ok_or("OUT_OF_SCOPE")?;
    std::process::Command::new("/usr/bin/open").arg(url).spawn().map(|_| ()).map_err(|_| "IO_ERROR".into())
}

#[cfg(test)]
mod tests {
    use super::external_url;
    #[test]
    fn the_settings_window_is_an_app_window_but_not_a_document_window() {
        assert!(crate::is_app_window(super::SETTINGS_WINDOW) && crate::is_app_window("main") && crate::is_app_window("workspace-3"));
        assert!(!crate::is_workspace_window(super::SETTINGS_WINDOW));
        for other in ["", "settings-2", "pdf-export", "Settings"] { assert!(!crate::is_app_window(other), "{other}"); }
        assert_eq!((super::settings_title("en-US"), super::settings_title("zh-CN")), ("Settings", "设置"));
    }
    #[test]
    fn only_web_and_mail_links_open_externally() {
        assert!(external_url("https://example.com/a").is_some());
        assert!(external_url("mailto:a@example.com").is_some());
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "tel:1", "-a Calculator", "./note.md"] { assert!(external_url(bad).is_none(), "{bad}"); }
    }
}

#[tauri::command]
pub fn show_workspace_window(window: WebviewWindow) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    reveal(&window)?;
    Ok(())
}

#[tauri::command]
pub fn create_workspace_window(app: AppHandle, window: WebviewWindow, transfers: State<'_, TransferStore>, documents: State<'_, crate::documents::DocumentStore>, drafts: State<'_, crate::drafts::DraftClaims>, transfer: Option<serde_json::Value>) -> Result<String, String> {
    crate::require_workspace_window(&window)?;
    let field = |name: &str| transfer.as_ref().and_then(|value| value.get(name)).and_then(|value| value.as_str()).filter(|value| !value.is_empty()).map(str::to_owned);
    let (token, draft) = (field("token"), field("draftId"));
    let label = create(&app, &transfers, transfer)?;
    // The moved tab's file and draft belong to the new window from now on, even before its page has loaded.
    if let Some(token) = token { crate::documents::hand_over(&documents, &token, &label)?; }
    if let Some(draft) = draft { drafts.hand_over(&draft, &label); }
    Ok(label)
}

#[tauri::command]
pub fn take_window_transfer(window: WebviewWindow, transfers: State<'_, TransferStore>) -> Result<Option<serde_json::Value>, String> {
    crate::require_workspace_window(&window)?;
    Ok(transfers.0.lock().map_err(|_| "IO_ERROR")?.remove(window.label()))
}

#[tauri::command]
pub fn close_workspace_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    window.destroy().map_err(|_| "WINDOW_CLOSE_FAILED")?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if !app.webview_windows().values().any(|item| crate::is_workspace_window(item.label())) { app.exit(0); }
    });
    Ok(())
}
