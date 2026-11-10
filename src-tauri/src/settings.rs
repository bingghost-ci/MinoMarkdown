use crate::fs::atomic_write;
use crate::fs::bounded_file::read_canonical_parent;
use crate::fs::app_data::ensure_dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::{Path, PathBuf}, sync::Mutex};
#[cfg(test)]
use std::fs;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
static MERGE_LOCK: Mutex<()> = Mutex::new(());
fn default_editor_width() -> String { "centered".into() }
fn default_language() -> String { "zh-CN".into() }
fn default_editor_font() -> String { "system".into() }
fn default_editor_font_size() -> u32 { 15 }
fn default_editor_line_height() -> String { "comfortable".into() }
fn default_show_sidebar() -> bool { true }
fn default_auto_save_seconds() -> u32 { 30 }
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings { schema_version: u32, theme: String, sidebar_width: u32, window_width: u32, window_height: u32, #[serde(default)] show_file_toolbar: bool, #[serde(default = "default_editor_width")] editor_width: String, #[serde(default = "default_language")] language: String, #[serde(default = "default_editor_font")] editor_font: String, #[serde(default = "default_editor_font_size")] editor_font_size: u32, #[serde(default = "default_editor_line_height")] editor_line_height: String, #[serde(default = "default_show_sidebar")] show_sidebar: bool, #[serde(default)] show_outline: bool, #[serde(default)] auto_save: bool, #[serde(default = "default_auto_save_seconds")] auto_save_seconds: u32, #[serde(default)] restore_session: bool }
impl Default for Settings {
    fn default() -> Self { Self { schema_version: 1, theme: "system".into(), sidebar_width: 230, window_width: 1100, window_height: 760, show_file_toolbar: false, editor_width: default_editor_width(), language: default_language(), editor_font: default_editor_font(), editor_font_size: default_editor_font_size(), editor_line_height: default_editor_line_height(), show_sidebar: default_show_sidebar(), show_outline: false, auto_save: false, auto_save_seconds: default_auto_save_seconds(), restore_session: false } }
}
fn valid(settings: &Settings) -> bool {
    settings.schema_version == 1 && matches!(settings.auto_save_seconds, 15 | 30 | 60 | 120 | 300) && matches!(settings.theme.as_str(), "system" | "light" | "dark" | "paper" | "graphite" | "blueprint" | "mint" | "butter" | "eink") && matches!(settings.editor_width.as_str(), "centered" | "wide") && matches!(settings.language.as_str(), "zh-CN" | "en-US") && matches!(settings.editor_font.as_str(), "system" | "serif" | "mono" | "pingfang" | "songti" | "kaiti" | "yahei" | "georgia" | "avenir") && matches!(settings.editor_line_height.as_str(), "compact" | "comfortable" | "relaxed") && (13..=22).contains(&settings.editor_font_size) && (170..=420).contains(&settings.sidebar_width) && (720..=3000).contains(&settings.window_width) && (520..=2000).contains(&settings.window_height)
}
fn path(app: &AppHandle) -> Result<PathBuf, String> { Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join("settings.json")) }
pub fn initial_language(app: &AppHandle) -> String { path(app).map(|file| read_at(&file).language).unwrap_or_else(|_| default_language()) }
fn read_at(path: &Path) -> Settings {
    let Ok(bytes) = read_canonical_parent(path, 64 * 1024) else { return Settings::default() };
    if let Ok(settings) = serde_json::from_slice::<Settings>(&bytes) { if valid(&settings) { return settings } }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Settings::default() };
    if value.get("schemaVersion").and_then(|v| v.as_u64()) == Some(0) {
        let mut settings = Settings::default();
        if let Some(theme) = value.get("theme").and_then(|v| v.as_str()) { if matches!(theme,"system"|"light"|"dark"|"paper"|"graphite"|"blueprint"|"mint"|"butter"|"eink") { settings.theme = theme.into(); } }
        if let Some(width) = value.get("sidebarWidth").and_then(|v| v.as_u64()) { if (170..=420).contains(&width) { settings.sidebar_width = width as u32; } }
        return settings;
    }
    Settings::default()
}
fn write_at(path: &Path, settings: &Settings) -> Result<(), String> {
    if !valid(settings) { return Err("INVALID_SETTINGS".into()); }
    let _lock = SETTINGS_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let bytes = serde_json::to_vec(settings).map_err(|_| "IO_ERROR")?;
    let expected = read_canonical_parent(path, 64 * 1024).ok().map(|old| format!("{:x}", Sha256::digest(old)));
    atomic_write::commit_canonical_parent(path, &bytes, expected.as_deref()).map(|_| ())
}
#[tauri::command(async)]
pub fn get_settings(app: AppHandle, window: WebviewWindow) -> Result<Settings, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    Ok(read_at(&path(&app)?))
}
fn merged(current: &Settings, patch: serde_json::Map<String, serde_json::Value>) -> Result<Settings, String> {
    let serde_json::Value::Object(mut fields) = serde_json::to_value(current).map_err(|_| "IO_ERROR")? else { return Err("IO_ERROR".into()) };
    for (key, value) in patch {
        if key == "schemaVersion" || !fields.contains_key(&key) { return Err("INVALID_SETTINGS".into()); }
        fields.insert(key, value);
    }
    let next: Settings = serde_json::from_value(serde_json::Value::Object(fields)).map_err(|_| "INVALID_SETTINGS")?;
    if valid(&next) { Ok(next) } else { Err("INVALID_SETTINGS".into()) }
}
/// Applies only the fields a window changed, so one window cannot write back another window's stale values.
#[tauri::command(async)]
pub fn update_settings(app: AppHandle, window: WebviewWindow, patch: serde_json::Map<String, serde_json::Value>) -> Result<Settings, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    let file = path(&app)?;
    let next = { let _merge = MERGE_LOCK.lock().map_err(|_| "IO_ERROR")?; let next = merged(&read_at(&file), patch)?; write_at(&file, &next)?; next };
    let menu_app = app.clone();
    let language = next.language.clone();
    // Native menu items may only be changed from the main thread.
    let _ = app.run_on_main_thread(move || crate::native_menu::set_language(&menu_app, &language));
    crate::recent::refresh_menu(&app);
    let _ = app.emit("language-changed", &next.language);
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_and_old_settings_are_safe_and_do_not_touch_drafts() {
        let dir = std::env::temp_dir().join(format!("mino-settings-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let dir = fs::canonicalize(dir).unwrap(); let file = dir.join("settings.json");
        let draft = dir.join("draft.md"); fs::write(&draft,b"draft kept").unwrap();
        fs::write(&file,b"broken").unwrap();
        assert_eq!(read_at(&file),Settings::default());
        fs::write(&file,br#"{"schemaVersion":0,"theme":"dark","sidebarWidth":300}"#).unwrap();
        assert_eq!(read_at(&file).theme,"dark");
        assert_eq!(read_at(&file).sidebar_width,300);
        fs::write(&file,br#"{"schemaVersion":1,"theme":"dark","sidebarWidth":300,"windowWidth":1100,"windowHeight":760}"#).unwrap();
        assert_eq!(read_at(&file).editor_width, "centered");
        assert_eq!(read_at(&file).language, "zh-CN");
        assert_eq!(read_at(&file).editor_font, "system");
        assert_eq!(read_at(&file).editor_font_size, 15);
        assert!(read_at(&file).show_sidebar);
        assert!(!read_at(&file).show_outline);
        assert!(!read_at(&file).auto_save);
        assert!(!read_at(&file).restore_session);
        assert_eq!(read_at(&file).auto_save_seconds, 30);
        write_at(&file,&read_at(&file)).unwrap();
        assert_eq!(read_at(&file).schema_version,1);
        let mut expanded = read_at(&file);
        expanded.theme = "eink".into();
        expanded.editor_font = "georgia".into();
        write_at(&file, &expanded).unwrap();
        assert_eq!(read_at(&file), expanded);
        assert_eq!(fs::read(draft).unwrap(),b"draft kept");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn patches_only_touch_named_fields_and_reject_unknown_ones() {
        let mut current = Settings::default();
        current.theme = "dark".into();
        let patch = |value: serde_json::Value| value.as_object().unwrap().clone();
        let next = merged(&current, patch(serde_json::json!({"windowWidth": 1300}))).unwrap();
        assert_eq!((next.window_width, next.theme.as_str()), (1300, "dark"));
        assert!(merged(&current, patch(serde_json::json!({"theme": "neon"}))).is_err());
        assert!(merged(&current, patch(serde_json::json!({"nope": 1}))).is_err());
        assert!(merged(&current, patch(serde_json::json!({"schemaVersion": 0}))).is_err());
    }
    #[test]
    fn rejects_values_outside_whitelist() {
        let mut settings = Settings::default(); settings.theme = "remote".into();
        assert!(!valid(&settings));
        settings = Settings::default(); settings.sidebar_width = 1;
        assert!(!valid(&settings));
        settings = Settings::default(); settings.editor_width = "stretched".into();
        assert!(!valid(&settings));
        settings = Settings::default(); settings.language = "fr-FR".into();
        assert!(!valid(&settings));
        settings = Settings::default(); settings.auto_save_seconds = 1;
        assert!(!valid(&settings));
        settings = Settings::default(); settings.editor_font_size = 40;
        assert!(!valid(&settings));
        settings = Settings::default(); settings.theme = "eink".into(); settings.editor_font = "kaiti".into();
        assert!(valid(&settings));
        settings.editor_font = "downloaded-from-web".into();
        assert!(!valid(&settings));
    }
    #[cfg(unix)]
    #[test]
    fn linked_settings_are_ignored() {
        let dir = std::env::temp_dir().join(format!("mino-settings-link-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("outside.json"), br#"{"schemaVersion":1,"theme":"dark","sidebarWidth":300,"windowWidth":1100,"windowHeight":760}"#).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.json"), dir.join("settings.json")).unwrap();
        assert_eq!(read_at(&dir.join("settings.json")), Settings::default());
        fs::remove_dir_all(dir).unwrap();
    }
}
