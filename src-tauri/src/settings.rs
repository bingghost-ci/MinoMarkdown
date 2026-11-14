use crate::fs::atomic_write;
use crate::fs::bounded_file::read_canonical_parent;
use crate::fs::app_data::ensure_dir;
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::Mutex};
#[cfg(test)]
use std::fs;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
static MERGE_LOCK: Mutex<()> = Mutex::new(());
fn default_editor_width() -> String { "centered".into() }
fn default_language() -> String { "zh-CN".into() }
fn default_editor_font_size() -> u32 { 15 }
fn default_editor_line_height() -> String { "comfortable".into() }
fn default_show_sidebar() -> bool { true }
fn default_auto_save_seconds() -> u32 { 30 }
// Missing fields fall back to these values, which keep the look of settings written by older versions.
// `Settings::default()` holds the values for a new install instead.
fn legacy_day_theme() -> String { "white".into() }
fn legacy_night_theme() -> String { "dark".into() }
fn default_font() -> String { "auto".into() }
fn default_outline_width() -> u32 { 240 }
fn default_ai_width() -> u32 { 400 }
fn default_paragraph_spacing() -> String { "standard".into() }
fn legacy_measure() -> String { "unlimited".into() }
fn default_text_align() -> String { "left".into() }
fn default_table_style() -> String { "three-line".into() }
fn default_texture_strength() -> u32 { 60 }
fn default_diagram_style() -> String { "page".into() }
fn default_auto() -> String { "auto".into() }
fn default_latin_layout() -> String { "auto".into() }
fn default_true() -> bool { true }
fn default_export_style() -> String { "current".into() }
fn default_pdf_mode() -> String { "print".into() }
fn default_page_size() -> String { "a4".into() }
fn default_page_margin() -> String { "standard".into() }
/// The reading styles (T62, night styles revised in T74); `src/features/reading/styles.ts` lists the same IDs.
const STYLE_IDS: &[&str] = &["white", "mist", "paper", "xuan", "parchment", "kraft", "mint", "charcoal", "dark", "gray", "slate", "dusk"];
/// Style IDs of earlier versions and their replacements; the same table is `legacyStyleIds` in styles.ts.
const LEGACY_STYLE_IDS: &[(&str, &str)] = &[("light", "white"), ("blueprint", "white"), ("newsprint", "mist"), ("eink", "mist"), ("butter", "paper"), ("amber", "paper"), ("graphite", "dark"), ("ink", "charcoal"), ("black", "charcoal")];
fn is_style(id: &str) -> bool { STYLE_IDS.contains(&id) }
/// A font choice is `auto`, the ID of a bundled font, or `sys:<family>` naming a font installed on this Mac.
/// The family name ends up in generated CSS, so the characters that could leave a quoted CSS string are refused.
fn is_font_choice(value: &str) -> bool {
    if let Some(name) = value.strip_prefix("sys:") {
        return !name.is_empty() && name.chars().count() <= 100 && name.trim() == name && !name.chars().any(|c| c.is_control() || matches!(c, '"' | '\'' | '\\' | ',' | ';' | '{' | '}' | '<' | '>'))
    }
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    schema_version: u32, theme: String, sidebar_width: u32, window_width: u32, window_height: u32,
    #[serde(default = "default_outline_width")] outline_width: u32, #[serde(default = "default_ai_width")] ai_width: u32,
    #[serde(default)] show_file_toolbar: bool, #[serde(default = "default_editor_width")] editor_width: String, #[serde(default = "default_language")] language: String, #[serde(default = "default_editor_font_size")] editor_font_size: u32, #[serde(default = "default_editor_line_height")] editor_line_height: String, #[serde(default = "default_show_sidebar")] show_sidebar: bool, #[serde(default)] show_outline: bool, #[serde(default)] auto_save: bool, #[serde(default = "default_auto_save_seconds")] auto_save_seconds: u32, #[serde(default)] restore_session: bool,
    #[serde(default = "legacy_day_theme")] day_theme: String, #[serde(default = "legacy_night_theme")] night_theme: String, #[serde(default = "default_font")] cjk_font: String, #[serde(default = "default_font")] latin_font: String, #[serde(default = "default_font")] code_font: String, #[serde(default = "default_paragraph_spacing")] paragraph_spacing: String, #[serde(default = "legacy_measure")] measure: String, #[serde(default = "default_text_align")] text_align: String, #[serde(default)] first_line_indent: bool, #[serde(default = "default_table_style")] table_style: String, #[serde(default = "default_diagram_style")] diagram_style: String, #[serde(default = "default_auto")] diagram_line: String, #[serde(default = "default_auto")] diagram_curve: String, #[serde(default = "default_texture_strength")] texture_strength: u32, #[serde(default = "default_latin_layout")] latin_layout: String, #[serde(default = "default_true")] image_captions: bool, #[serde(default = "default_true")] image_dimming: bool, #[serde(default = "default_true")] open_in_reading_mode: bool, #[serde(default = "default_export_style")] export_style: String, #[serde(default = "default_pdf_mode")] pdf_mode: String, #[serde(default = "default_page_size")] page_size: String, #[serde(default = "default_page_margin")] page_margin: String,
}
impl Default for Settings {
    fn default() -> Self { Self { schema_version: 1, theme: "system".into(), sidebar_width: 230, outline_width: default_outline_width(), ai_width: default_ai_width(), window_width: 1100, window_height: 760, show_file_toolbar: false, editor_width: default_editor_width(), language: default_language(), editor_font_size: 16, editor_line_height: default_editor_line_height(), show_sidebar: default_show_sidebar(), show_outline: false, auto_save: false, auto_save_seconds: default_auto_save_seconds(), restore_session: false, day_theme: "white".into(), night_theme: "dark".into(), cjk_font: default_font(), latin_font: default_font(), code_font: default_font(), paragraph_spacing: default_paragraph_spacing(), measure: "36".into(), text_align: default_text_align(), first_line_indent: false, table_style: default_table_style(), diagram_style: default_diagram_style(), diagram_line: default_auto(), diagram_curve: default_auto(), texture_strength: default_texture_strength(), latin_layout: default_latin_layout(), image_captions: true, image_dimming: true, open_in_reading_mode: true, export_style: default_export_style(), pdf_mode: default_pdf_mode(), page_size: default_page_size(), page_margin: default_page_margin() } }
}
fn valid(settings: &Settings) -> bool {
    settings.schema_version == 1 && matches!(settings.auto_save_seconds, 15 | 30 | 60 | 120 | 300) && (settings.theme == "system" || is_style(&settings.theme)) && is_style(&settings.day_theme) && is_style(&settings.night_theme) && matches!(settings.editor_width.as_str(), "centered" | "wide") && matches!(settings.language.as_str(), "zh-CN" | "en-US") && matches!(settings.editor_line_height.as_str(), "compact" | "comfortable" | "relaxed") && (13..=22).contains(&settings.editor_font_size) && (170..=520).contains(&settings.sidebar_width) && (180..=520).contains(&settings.outline_width) && (300..=640).contains(&settings.ai_width) && (720..=3000).contains(&settings.window_width) && (520..=2000).contains(&settings.window_height)
        && is_font_choice(&settings.cjk_font) && is_font_choice(&settings.latin_font) && is_font_choice(&settings.code_font) && settings.texture_strength <= 100 && matches!(settings.latin_layout.as_str(), "auto" | "off")
        && matches!(settings.paragraph_spacing.as_str(), "compact" | "standard" | "relaxed") && matches!(settings.measure.as_str(), "30" | "36" | "42" | "unlimited") && matches!(settings.text_align.as_str(), "left" | "justify") && matches!(settings.table_style.as_str(), "three-line" | "grid") && matches!(settings.diagram_style.as_str(), "page" | "hand" | "program" | "scifi" | "ink" | "color") && matches!(settings.diagram_line.as_str(), "auto" | "solid" | "dashed" | "dotted") && matches!(settings.diagram_curve.as_str(), "auto" | "curved" | "angular" | "straight") && matches!(settings.export_style.as_str(), "current" | "plain") && matches!(settings.pdf_mode.as_str(), "print" | "screen") && matches!(settings.page_size.as_str(), "a4" | "letter") && matches!(settings.page_margin.as_str(), "narrow" | "standard" | "wide")
}
/// Rewrites values of older versions in place, before validation: retired style IDs (T62) and the
/// `fontPreset` / `editorFont` pair that `cjkFont` and `latinFont` replace (T68).
fn migrate(value: &mut serde_json::Value) {
    let Some(fields) = value.as_object_mut() else { return };
    for key in ["theme", "dayTheme", "nightTheme"] {
        let replacement = fields.get(key).and_then(|v| v.as_str()).and_then(|id| LEGACY_STYLE_IDS.iter().find(|(old, _)| *old == id)).map(|(_, new)| *new);
        if let Some(new) = replacement { fields.insert(key.into(), new.into()); }
    }
    if fields.contains_key("cjkFont") || fields.contains_key("latinFont") { return; }
    let preset = fields.get("fontPreset").and_then(|v| v.as_str()).map(str::to_owned);
    let font = fields.get("editorFont").and_then(|v| v.as_str()).unwrap_or("system").to_owned();
    // `editorFont` predates presets: a font someone picked stayed in use until they chose a preset.
    let (cjk, latin) = match preset.as_deref() {
        Some("song") => ("song", "auto"), Some("kai") => ("kai", "auto"), Some("hei") => ("hei", "auto"), Some("auto") => ("auto", "auto"),
        _ => match font.as_str() {
            "pingfang" => ("hei", "auto"), "songti" => ("sys:Songti SC", "auto"), "kaiti" => ("sys:Kaiti SC", "auto"), "yahei" => ("sys:Microsoft YaHei", "auto"),
            "georgia" | "serif" => ("sys:Songti SC", "sys:Georgia"), "avenir" => ("hei", "sys:Avenir Next"), "mono" => ("hei", "mono"),
            _ => if preset.is_some() { ("hei", "auto") } else { ("auto", "auto") },
        },
    };
    fields.insert("cjkFont".into(), cjk.into());
    fields.insert("latinFont".into(), latin.into());
}
fn path(app: &AppHandle) -> Result<PathBuf, String> { Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join("settings.json")) }
pub fn initial_language(app: &AppHandle) -> String { path(app).map(|file| read_at(&file).language).unwrap_or_else(|_| default_language()) }
fn read_at(path: &Path) -> Settings {
    let Ok(bytes) = read_canonical_parent(path, 64 * 1024) else { return Settings::default() };
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Settings::default() };
    migrate(&mut value);
    if let Ok(settings) = serde_json::from_value::<Settings>(value.clone()) {
        if valid(&settings) { return settings }
    }
    if value.get("schemaVersion").and_then(|v| v.as_u64()) == Some(0) {
        let mut settings = Settings::default();
        if let Some(theme) = value.get("theme").and_then(|v| v.as_str()) { if theme == "system" || is_style(theme) { settings.theme = theme.into(); settings.day_theme = legacy_day_theme(); settings.night_theme = legacy_night_theme(); settings.measure = legacy_measure(); } }
        if let Some(width) = value.get("sidebarWidth").and_then(|v| v.as_u64()) { if (170..=520).contains(&width) { settings.sidebar_width = width as u32; } }
        return settings;
    }
    Settings::default()
}
fn write_at(path: &Path, settings: &Settings) -> Result<(), String> {
    if !valid(settings) { return Err("INVALID_SETTINGS".into()); }
    let _lock = SETTINGS_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let bytes = serde_json::to_vec(settings).map_err(|_| "IO_ERROR")?;
    atomic_write::replace_record(path, &bytes, 64 * 1024)
}
#[tauri::command(async)]
pub fn get_settings(app: AppHandle, window: WebviewWindow) -> Result<Settings, String> {
    crate::require_workspace_window(&window)?;
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
/// Whether a change of settings shows in the native menu: only its language does.
fn menu_follows(current: &Settings, next: &Settings) -> bool { current.language != next.language }
/// Applies only the fields a window changed, so one window cannot write back another window's stale values.
#[tauri::command(async)]
pub fn update_settings(app: AppHandle, window: WebviewWindow, patch: serde_json::Map<String, serde_json::Value>) -> Result<Settings, String> {
    crate::require_workspace_window(&window)?;
    let file = path(&app)?;
    let (next, relabel) = { let _merge = MERGE_LOCK.lock().map_err(|_| "IO_ERROR")?; let current = read_at(&file); let next = merged(&current, patch)?; write_at(&file, &next)?; let relabel = menu_follows(&current, &next); (next, relabel) };
    // Most patches are a window size, a pane width or a font size, several a second while one is dragged.
    // The menu shows none of those, so it is rewritten only when the language changes (T99).
    if relabel {
        let menu_app = app.clone();
        let language = next.language.clone();
        // Native menu items may only be changed from the main thread.
        let _ = app.run_on_main_thread(move || crate::native_menu::set_language(&menu_app, &language));
        crate::recent::refresh_menu(&app);
    }
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
        assert_eq!(read_at(&file).editor_font_size, 15);
        assert!(read_at(&file).show_sidebar);
        assert!(!read_at(&file).show_outline);
        assert!(!read_at(&file).auto_save);
        assert!(!read_at(&file).restore_session);
        assert_eq!(read_at(&file).auto_save_seconds, 30);
        // Fields added for reading styles keep the old look when an older file lacks them.
        let old = read_at(&file);
        assert_eq!((old.day_theme.as_str(), old.night_theme.as_str(), old.measure.as_str(), old.cjk_font.as_str(), old.latin_font.as_str()), ("white", "dark", "unlimited", "auto", "auto"));
        assert!(old.open_in_reading_mode && old.image_captions && old.image_dimming && !old.first_line_indent);
        assert_eq!((old.table_style.as_str(), old.texture_strength, old.latin_layout.as_str(), old.editor_font_size), ("three-line", 60, "auto", 15));
        assert_eq!((old.pdf_mode.as_str(), old.export_style.as_str(), old.page_size.as_str(), old.page_margin.as_str()), ("print", "current", "a4", "standard"));
        fs::write(&file,br#"{"schemaVersion":1,"theme":"dark","sidebarWidth":300,"windowWidth":1100,"windowHeight":760}"#).unwrap();
        write_at(&file,&read_at(&file)).unwrap();
        assert_eq!(read_at(&file).schema_version,1);
        let mut expanded = read_at(&file);
        expanded.theme = "mist".into();
        expanded.cjk_font = "sys:Songti SC".into();
        expanded.texture_strength = 100;
        write_at(&file, &expanded).unwrap();
        assert_eq!(read_at(&file), expanded);
        assert_eq!(fs::read(draft).unwrap(),b"draft kept");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn only_a_change_of_language_reaches_the_native_menu() {
        let current = Settings::default();
        let patch = |value: serde_json::Value| value.as_object().unwrap().clone();
        // What a window sends while it is resized, a pane is dragged or a slider moves.
        for change in [serde_json::json!({"windowWidth": 1300, "windowHeight": 900}), serde_json::json!({"sidebarWidth": 300}), serde_json::json!({"editorFontSize": 18}), serde_json::json!({"theme": "dark"}), serde_json::json!({"language": current.language})] {
            assert!(!menu_follows(&current, &merged(&current, patch(change.clone())).unwrap()), "{change}");
        }
        let other = if current.language == "en-US" { "zh-CN" } else { "en-US" };
        assert!(menu_follows(&current, &merged(&current, patch(serde_json::json!({"language": other}))).unwrap()));
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
        settings = Settings::default(); settings.theme = "eink".into();
        assert!(!valid(&settings), "retired IDs are migrated on read and never written");
        settings = Settings::default(); settings.texture_strength = 101;
        assert!(!valid(&settings));
        let defaults = Settings::default();
        assert!(valid(&defaults));
        assert_eq!((defaults.day_theme.as_str(), defaults.night_theme.as_str(), defaults.measure.as_str()), ("white", "dark", "36"));
        for id in STYLE_IDS { settings = Settings::default(); settings.theme = (*id).into(); settings.night_theme = (*id).into(); assert!(valid(&settings), "{id}"); }
        for (field, value) in [("dayTheme", "neon"), ("nightTheme", "system"), ("cjkFont", "Comic Sans"), ("latinFont", "sys:a'b"), ("latinFont", "sys:"), ("cjkFont", "sys:x;y"), ("latinLayout", "always"), ("paragraphSpacing", "huge"), ("measure", "80"), ("textAlign", "center"), ("tableStyle", "dotted"), ("diagramStyle", "neon"), ("diagramLine", "wavy"), ("diagramCurve", "spline"), ("exportStyle", "remote"), ("pdfMode", "auto"), ("pageSize", "a3"), ("pageMargin", "none")] {
            assert!(merged(&Settings::default(), serde_json::json!({ field: value }).as_object().unwrap().clone()).is_err(), "{field}");
        }
        assert!(merged(&Settings::default(), serde_json::json!({"firstLineIndent": "yes"}).as_object().unwrap().clone()).is_err());
        assert_eq!(merged(&Settings::default(), serde_json::json!({"tableStyle": "grid"}).as_object().unwrap().clone()).unwrap().table_style, "grid");
        // Diagram looks: a settings file written before they existed draws diagrams on the page as before.
        assert_eq!(Settings::default().diagram_style, "page");
        for look in ["page", "hand", "program", "scifi", "ink", "color"] { assert_eq!(merged(&Settings::default(), serde_json::json!({"diagramStyle": look}).as_object().unwrap().clone()).unwrap().diagram_style, look); }
        let edges = merged(&Settings::default(), serde_json::json!({"diagramLine": "dotted", "diagramCurve": "angular"}).as_object().unwrap().clone()).unwrap();
        assert_eq!((Settings::default().diagram_line.as_str(), edges.diagram_line.as_str(), edges.diagram_curve.as_str()), ("auto", "dotted", "angular"));
        // The code font (T90) follows the same rule, and a settings file written before it existed reads as `auto`.
        assert_eq!(Settings::default().code_font, "auto");
        let code = merged(&Settings::default(), serde_json::json!({"codeFont": "fira-code"}).as_object().unwrap().clone()).unwrap();
        assert_eq!(code.code_font, "fira-code");
        assert_eq!(merged(&Settings::default(), serde_json::json!({"codeFont": "sys:Maple Mono"}).as_object().unwrap().clone()).unwrap().code_font, "sys:Maple Mono");
        for bad in ["sys:a'b", "sys:", "Fira Code", ""] { assert!(merged(&Settings::default(), serde_json::json!({"codeFont": bad}).as_object().unwrap().clone()).is_err(), "{bad}"); }
        let fonts = merged(&Settings::default(), serde_json::json!({"cjkFont": "sys:方正书宋 GBK", "latinFont": "source-serif"}).as_object().unwrap().clone()).unwrap();
        assert_eq!((fonts.cjk_font.as_str(), fonts.latin_font.as_str()), ("sys:方正书宋 GBK", "source-serif"));
        assert!(merged(&Settings::default(), serde_json::json!({"textureStrength": 300}).as_object().unwrap().clone()).is_err());
    }
    /// T78: pane widths default for a file written before they existed, are kept in range, and a width out of range is not accepted.
    #[test]
    fn pane_widths_default_and_are_range_checked() {
        let dir = std::env::temp_dir().join(format!("mino-settings-panes-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let dir = fs::canonicalize(dir).unwrap(); let file = dir.join("settings.json");
        let write = |extra: &str| fs::write(&file, format!(r#"{{"schemaVersion":1,"theme":"dark","sidebarWidth":300,"windowWidth":1100,"windowHeight":760{extra}}}"#)).unwrap();
        write("");
        let read = read_at(&file);
        assert_eq!((read.sidebar_width, read.outline_width, read.ai_width, read.theme.as_str()), (300, 240, 400, "dark"));
        write(r#","sidebarWidth":520,"outlineWidth":520,"aiWidth":640"#);
        let read = read_at(&file);
        assert_eq!((read.sidebar_width, read.outline_width, read.ai_width), (520, 520, 640));
        for bad in [r#","outlineWidth":179"#, r#","outlineWidth":521"#, r#","aiWidth":299"#, r#","aiWidth":641"#] {
            write(bad);
            assert_eq!(read_at(&file), Settings::default(), "{bad}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    /// T62 and T68: a settings file of any earlier version keeps its other values and a matching look.
    #[test]
    fn older_style_ids_and_font_settings_are_migrated_on_read() {
        let dir = std::env::temp_dir().join(format!("mino-settings-migrate-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let dir = fs::canonicalize(dir).unwrap(); let file = dir.join("settings.json");
        let write = |extra: &str| fs::write(&file, format!(r#"{{"schemaVersion":1,"sidebarWidth":300,"windowWidth":1100,"windowHeight":760,{extra}}}"#)).unwrap();
        for (old, new) in LEGACY_STYLE_IDS {
            assert!(is_style(new), "{new}");
            write(&format!(r#""theme":"{old}","dayTheme":"{old}","nightTheme":"{old}""#));
            let read = read_at(&file);
            assert_eq!((read.theme.as_str(), read.day_theme.as_str(), read.night_theme.as_str(), read.sidebar_width), (*new, *new, *new, 300), "{old}");
        }
        for id in STYLE_IDS { write(&format!(r#""theme":"{id}""#)); assert_eq!(read_at(&file).theme, *id); }
        write(r#""theme":"system","dayTheme":"butter","nightTheme":"graphite""#);
        assert_eq!((read_at(&file).theme.as_str(), read_at(&file).day_theme.as_str(), read_at(&file).night_theme.as_str()), ("system", "paper", "dark"));
        for (extra, cjk, latin) in [
            (r#""theme":"paper","editorFont":"kaiti""#, "sys:Kaiti SC", "auto"),
            (r#""theme":"paper","editorFont":"kaiti","fontPreset":"song""#, "song", "auto"),
            (r#""theme":"paper","editorFont":"georgia","fontPreset":"system""#, "sys:Songti SC", "sys:Georgia"),
            (r#""theme":"paper","editorFont":"system","fontPreset":"system""#, "hei", "auto"),
            (r#""theme":"paper","fontPreset":"auto""#, "auto", "auto"),
            (r#""theme":"paper","fontPreset":"kai","cjkFont":"sans""#, "sans", "auto"),
        ] {
            write(extra);
            let read = read_at(&file);
            assert_eq!((read.cjk_font.as_str(), read.latin_font.as_str()), (cjk, latin), "{extra}");
            assert!(valid(&read));
        }
        write(r#""theme":"neon""#);
        assert_eq!(read_at(&file), Settings::default());
        fs::remove_dir_all(dir).unwrap();
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
