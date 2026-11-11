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
// Missing fields fall back to these values, which keep the look of settings written before T51.
// `Settings::default()` holds the values for a new install instead.
fn legacy_day_theme() -> String { "light".into() }
fn legacy_night_theme() -> String { "dark".into() }
fn default_font_preset() -> String { "auto".into() }
fn default_paragraph_spacing() -> String { "standard".into() }
fn legacy_measure() -> String { "unlimited".into() }
fn default_text_align() -> String { "left".into() }
fn default_table_style() -> String { "three-line".into() }
fn default_true() -> bool { true }
fn default_export_style() -> String { "current".into() }
fn default_pdf_mode() -> String { "print".into() }
fn default_page_size() -> String { "a4".into() }
fn default_page_margin() -> String { "standard".into() }
const STYLE_IDS: &[&str] = &["light", "paper", "xuan", "kraft", "parchment", "newsprint", "mint", "butter", "eink", "amber", "graphite", "dark", "ink", "blueprint"];
fn is_style(id: &str) -> bool { STYLE_IDS.contains(&id) }
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    schema_version: u32, theme: String, sidebar_width: u32, window_width: u32, window_height: u32,
    #[serde(default)] show_file_toolbar: bool, #[serde(default = "default_editor_width")] editor_width: String, #[serde(default = "default_language")] language: String, #[serde(default = "default_editor_font")] editor_font: String, #[serde(default = "default_editor_font_size")] editor_font_size: u32, #[serde(default = "default_editor_line_height")] editor_line_height: String, #[serde(default = "default_show_sidebar")] show_sidebar: bool, #[serde(default)] show_outline: bool, #[serde(default)] auto_save: bool, #[serde(default = "default_auto_save_seconds")] auto_save_seconds: u32, #[serde(default)] restore_session: bool,
    #[serde(default = "legacy_day_theme")] day_theme: String, #[serde(default = "legacy_night_theme")] night_theme: String, #[serde(default = "default_font_preset")] font_preset: String, #[serde(default = "default_paragraph_spacing")] paragraph_spacing: String, #[serde(default = "legacy_measure")] measure: String, #[serde(default = "default_text_align")] text_align: String, #[serde(default)] first_line_indent: bool, #[serde(default = "default_table_style")] table_style: String, #[serde(default = "default_true")] image_captions: bool, #[serde(default = "default_true")] image_dimming: bool, #[serde(default = "default_true")] open_in_reading_mode: bool, #[serde(default = "default_export_style")] export_style: String, #[serde(default = "default_pdf_mode")] pdf_mode: String, #[serde(default = "default_page_size")] page_size: String, #[serde(default = "default_page_margin")] page_margin: String,
}
impl Default for Settings {
    fn default() -> Self { Self { schema_version: 1, theme: "system".into(), sidebar_width: 230, window_width: 1100, window_height: 760, show_file_toolbar: false, editor_width: default_editor_width(), language: default_language(), editor_font: default_editor_font(), editor_font_size: default_editor_font_size(), editor_line_height: default_editor_line_height(), show_sidebar: default_show_sidebar(), show_outline: false, auto_save: false, auto_save_seconds: default_auto_save_seconds(), restore_session: false, day_theme: "paper".into(), night_theme: "graphite".into(), font_preset: default_font_preset(), paragraph_spacing: default_paragraph_spacing(), measure: "36".into(), text_align: default_text_align(), first_line_indent: false, table_style: default_table_style(), image_captions: true, image_dimming: true, open_in_reading_mode: true, export_style: default_export_style(), pdf_mode: default_pdf_mode(), page_size: default_page_size(), page_margin: default_page_margin() } }
}
fn valid(settings: &Settings) -> bool {
    settings.schema_version == 1 && matches!(settings.auto_save_seconds, 15 | 30 | 60 | 120 | 300) && (settings.theme == "system" || is_style(&settings.theme)) && is_style(&settings.day_theme) && is_style(&settings.night_theme) && matches!(settings.editor_width.as_str(), "centered" | "wide") && matches!(settings.language.as_str(), "zh-CN" | "en-US") && matches!(settings.editor_font.as_str(), "system" | "serif" | "mono" | "pingfang" | "songti" | "kaiti" | "yahei" | "georgia" | "avenir") && matches!(settings.editor_line_height.as_str(), "compact" | "comfortable" | "relaxed") && (13..=22).contains(&settings.editor_font_size) && (170..=420).contains(&settings.sidebar_width) && (720..=3000).contains(&settings.window_width) && (520..=2000).contains(&settings.window_height)
        && matches!(settings.font_preset.as_str(), "auto" | "song" | "kai" | "hei" | "system") && matches!(settings.paragraph_spacing.as_str(), "compact" | "standard" | "relaxed") && matches!(settings.measure.as_str(), "30" | "36" | "42" | "unlimited") && matches!(settings.text_align.as_str(), "left" | "justify") && matches!(settings.table_style.as_str(), "three-line" | "grid") && matches!(settings.export_style.as_str(), "current" | "plain") && matches!(settings.pdf_mode.as_str(), "print" | "screen") && matches!(settings.page_size.as_str(), "a4" | "letter") && matches!(settings.page_margin.as_str(), "narrow" | "standard" | "wide")
}
fn path(app: &AppHandle) -> Result<PathBuf, String> { Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join("settings.json")) }
pub fn initial_language(app: &AppHandle) -> String { path(app).map(|file| read_at(&file).language).unwrap_or_else(|_| default_language()) }
fn read_at(path: &Path) -> Settings {
    let Ok(bytes) = read_canonical_parent(path, 64 * 1024) else { return Settings::default() };
    if let Ok(mut settings) = serde_json::from_slice::<Settings>(&bytes) {
        if valid(&settings) {
            // `editorFont` predates font presets: a font someone picked stays in use until they choose a preset.
            let has_preset = serde_json::from_slice::<serde_json::Value>(&bytes).ok().is_some_and(|value| value.get("fontPreset").is_some());
            if !has_preset && settings.editor_font != "system" { settings.font_preset = "system".into(); }
            return settings
        }
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Settings::default() };
    if value.get("schemaVersion").and_then(|v| v.as_u64()) == Some(0) {
        let mut settings = Settings::default();
        if let Some(theme) = value.get("theme").and_then(|v| v.as_str()) { if theme == "system" || is_style(theme) { settings.theme = theme.into(); settings.day_theme = legacy_day_theme(); settings.night_theme = legacy_night_theme(); settings.measure = legacy_measure(); } }
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
        // Fields added for reading styles keep the old look when a pre-T51 file lacks them.
        let old = read_at(&file);
        assert_eq!((old.day_theme.as_str(), old.night_theme.as_str(), old.measure.as_str(), old.font_preset.as_str()), ("light", "dark", "unlimited", "auto"));
        assert!(old.open_in_reading_mode && old.image_captions && old.image_dimming && !old.first_line_indent);
        assert_eq!(old.table_style, "three-line");
        assert_eq!((old.pdf_mode.as_str(), old.export_style.as_str(), old.page_size.as_str(), old.page_margin.as_str()), ("print", "current", "a4", "standard"));
        fs::write(&file,br#"{"schemaVersion":1,"theme":"paper","sidebarWidth":300,"windowWidth":1100,"windowHeight":760,"editorFont":"kaiti"}"#).unwrap();
        assert_eq!(read_at(&file).font_preset, "system");
        fs::write(&file,br#"{"schemaVersion":1,"theme":"paper","sidebarWidth":300,"windowWidth":1100,"windowHeight":760,"editorFont":"kaiti","fontPreset":"song"}"#).unwrap();
        assert_eq!(read_at(&file).font_preset, "song");
        fs::write(&file,br#"{"schemaVersion":1,"theme":"dark","sidebarWidth":300,"windowWidth":1100,"windowHeight":760}"#).unwrap();
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
        let defaults = Settings::default();
        assert!(valid(&defaults));
        assert_eq!((defaults.day_theme.as_str(), defaults.night_theme.as_str(), defaults.measure.as_str()), ("paper", "graphite", "36"));
        for id in STYLE_IDS { settings = Settings::default(); settings.theme = (*id).into(); settings.night_theme = (*id).into(); assert!(valid(&settings), "{id}"); }
        for (field, value) in [("dayTheme", "neon"), ("nightTheme", "system"), ("fontPreset", "comic"), ("paragraphSpacing", "huge"), ("measure", "80"), ("textAlign", "center"), ("tableStyle", "dotted"), ("exportStyle", "remote"), ("pdfMode", "auto"), ("pageSize", "a3"), ("pageMargin", "none")] {
            assert!(merged(&Settings::default(), serde_json::json!({ field: value }).as_object().unwrap().clone()).is_err(), "{field}");
        }
        assert!(merged(&Settings::default(), serde_json::json!({"firstLineIndent": "yes"}).as_object().unwrap().clone()).is_err());
        assert_eq!(merged(&Settings::default(), serde_json::json!({"tableStyle": "grid"}).as_object().unwrap().clone()).unwrap().table_style, "grid");
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
