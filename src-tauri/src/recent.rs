use crate::{documents::{DocumentStore, OpenDocument, draft_target, open_granted_path, validate_selected_file}, fs::{app_data::ensure_dir, atomic_write, bounded_file::read_canonical_parent}, workspace::{WorkspaceStore, WorkspaceRoot, workspace_path, register_workspace}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State, WebviewWindow};

static RECENT_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentEntry { path: String, kind: String, last_opened: u64 }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentFile { schema_version: u32, entries: Vec<RecentEntry> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentSummary { id: String, name: String, kind: String, available: bool, last_opened: u64 }

fn require_main(window: &WebviewWindow) -> Result<(), String> { if crate::is_workspace_window(window.label()) { Ok(()) } else { Err("OUT_OF_SCOPE".into()) } }
fn storage(app: &AppHandle) -> Result<PathBuf, String> { Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join("recent.json")) }
#[cfg(target_os = "macos")]
fn note_system_recent(app: &AppHandle, path: PathBuf) {
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = objc2::MainThreadMarker::new() else { return; };
        let controller = objc2_app_kit::NSDocumentController::sharedDocumentController(mtm);
        let name = objc2_foundation::NSString::from_str(&path.to_string_lossy());
        let url = objc2_foundation::NSURL::fileURLWithPath(&name);
        controller.noteNewRecentDocumentURL(&url);
    });
}
pub struct RecentMenu(pub tauri::menu::Submenu<tauri::Wry>);

/// Rebuilds File > Open Recent. Item ids carry the recent id, never a path.
pub fn refresh_menu(app: &AppHandle) {
    let Ok(file) = storage(app) else { return };
    let items = summaries(load(&file));
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        use tauri::menu::{IsMenuItem, MenuItem};
        let menu = handle.state::<RecentMenu>();
        if let Ok(existing) = menu.0.items() { for item in existing { let _ = menu.0.remove(&item); } }
        let english = crate::settings::initial_language(&handle) == "en-US";
        if items.is_empty() {
            if let Ok(item) = MenuItem::with_id(&handle, "no-recent", crate::native_menu::label("no-recent", english), false, None::<&str>) { let _ = menu.0.append(&item as &dyn IsMenuItem<tauri::Wry>); }
            return;
        }
        for entry in items {
            if let Ok(item) = MenuItem::with_id(&handle, format!("recent:{}:{}", entry.kind, entry.id), &entry.name, entry.available, None::<&str>) { let _ = menu.0.append(&item as &dyn IsMenuItem<tauri::Wry>); }
        }
    });
}

fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn id_for(entry: &RecentEntry) -> String { hash(format!("{}:{}", entry.kind, entry.path).as_bytes())[..24].into() }
fn load(path: &Path) -> RecentFile {
    read_canonical_parent(path, 64 * 1024).ok().and_then(|bytes| serde_json::from_slice::<RecentFile>(&bytes).ok()).filter(|record| record.schema_version == 1).unwrap_or(RecentFile { schema_version: 1, entries: vec![] })
}
fn remember_at(path: &Path, target: &Path, kind: &str) -> Result<(), String> {
    let Some(target) = target.to_str() else { return Ok(()); };
    let _lock = RECENT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let mut record = load(path);
    let last_opened = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "IO_ERROR")?.as_secs();
    if let Some(entry) = record.entries.iter_mut().find(|entry| entry.path == target && entry.kind == kind) {
        entry.last_opened = last_opened;
    } else {
        record.entries.insert(0, RecentEntry { path: target.into(), kind: kind.into(), last_opened });
    }
    record.entries.truncate(20);
    let bytes = serde_json::to_vec(&record).map_err(|_| "IO_ERROR")?;
    let expected = read_canonical_parent(path, 64 * 1024).ok().map(|bytes| hash(&bytes));
    atomic_write::commit_canonical_parent(path, &bytes, expected.as_deref()).map(|_| ())
}
fn summaries(record: RecentFile) -> Vec<RecentSummary> {
    record.entries.into_iter().filter(|entry| entry.kind == "file" || entry.kind == "folder").map(|entry| {
        let path = Path::new(&entry.path);
        let available = fs::symlink_metadata(path).is_ok_and(|m| !m.file_type().is_symlink() && if entry.kind == "file" { m.is_file() } else { m.is_dir() });
        RecentSummary { id: id_for(&entry), name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| entry.path.clone()), kind: entry.kind, available, last_opened: entry.last_opened }
    }).collect()
}
fn find(app: &AppHandle, id: &str, kind: &str) -> Result<RecentEntry, String> {
    load(&storage(app)?).entries.into_iter().find(|entry| entry.kind == kind && id_for(entry) == id).ok_or("NOT_FOUND".into())
}
#[tauri::command(async)]
pub fn list_recent(app: AppHandle, window: WebviewWindow) -> Result<Vec<RecentSummary>, String> { require_main(&window)?; Ok(summaries(load(&storage(&app)?))) }
#[tauri::command(async)]
pub fn remember_recent_document(app: AppHandle, window: WebviewWindow, documents: State<'_, DocumentStore>, token: String) -> Result<(), String> {
    require_main(&window)?;
    let path = PathBuf::from(draft_target(&documents, &token)?);
    remember_at(&storage(&app)?, &path, "file")?;
    refresh_menu(&app);
    #[cfg(target_os = "macos")]
    note_system_recent(&app, path);
    Ok(())
}
#[tauri::command(async)]
pub fn remember_recent_workspace(app: AppHandle, window: WebviewWindow, workspaces: State<'_, WorkspaceStore>, token: String) -> Result<(), String> {
    require_main(&window)?;
    remember_at(&storage(&app)?, &workspace_path(&workspaces, &token)?, "folder")?;
    refresh_menu(&app);
    Ok(())
}
#[tauri::command(async)]
pub fn remove_recent(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    require_main(&window)?;
    let path = storage(&app)?;
    let _lock = RECENT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let mut record = load(&path);
    record.entries.retain(|entry| id_for(entry) != id);
    let bytes = serde_json::to_vec(&record).map_err(|_| "IO_ERROR")?;
    let expected = read_canonical_parent(&path, 64 * 1024).ok().map(|bytes| hash(&bytes));
    atomic_write::commit_canonical_parent(&path, &bytes, expected.as_deref())?;
    refresh_menu(&app);
    Ok(())
}
#[tauri::command(async)]
pub fn reorder_recent(app: AppHandle, window: WebviewWindow, ids: Vec<String>) -> Result<(), String> {
    require_main(&window)?;
    let path = storage(&app)?;
    let _lock = RECENT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let mut record = load(&path);
    if ids.len() != record.entries.len() || ids.len() > 20 { return Err("INVALID_ORDER".into()); }
    let mut ordered = Vec::with_capacity(ids.len());
    for id in ids {
        let Some(index) = record.entries.iter().position(|entry| id_for(entry) == id) else { return Err("INVALID_ORDER".into()); };
        ordered.push(record.entries.remove(index));
    }
    record.entries = ordered;
    let bytes = serde_json::to_vec(&record).map_err(|_| "IO_ERROR")?;
    let expected = read_canonical_parent(&path, 64 * 1024).ok().map(|bytes| hash(&bytes));
    atomic_write::commit_canonical_parent(&path, &bytes, expected.as_deref())?;
    refresh_menu(&app);
    Ok(())
}
#[tauri::command(async)]
pub fn choose_recent_file(app: AppHandle, window: WebviewWindow, documents: State<'_, DocumentStore>, id: String) -> Result<Option<OpenDocument>, String> {
    require_main(&window)?;
    let entry = find(&app, &id, "file")?;
    let path = validate_selected_file(Path::new(&entry.path))?;
    Ok(Some(open_granted_path(&documents, &path)?))
}
#[tauri::command(async)]
pub fn choose_recent_workspace(app: AppHandle, window: WebviewWindow, workspaces: State<'_, WorkspaceStore>, id: String) -> Result<Option<WorkspaceRoot>, String> {
    require_main(&window)?;
    let entry = find(&app, &id, "folder")?;
    let path = PathBuf::from(entry.path);
    let meta = fs::symlink_metadata(&path).map_err(|_| "NOT_FOUND")?;
    if meta.file_type().is_symlink() || !meta.is_dir() { return Err("OUT_OF_SCOPE".into()); }
    Ok(Some(register_workspace(&workspaces, path)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_recent_file_recovers_without_granting_paths() {
        let dir = std::env::temp_dir().join(format!("mino-recent-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let dir = fs::canonicalize(dir).unwrap(); let file = dir.join("recent.json");
        fs::write(&file,b"not json").unwrap();
        assert!(load(&file).entries.is_empty());
        let note = dir.join("note.md"); fs::write(&note,b"hi").unwrap();
        remember_at(&file,&note,"file").unwrap();
        let items = summaries(load(&file));
        assert_eq!(items.len(),1); assert!(items[0].available);
        assert!(!items[0].id.contains("note"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn opening_an_existing_recent_item_keeps_manual_order() {
        let dir = std::env::temp_dir().join(format!("mino-recent-order-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let dir = fs::canonicalize(dir).unwrap(); let file = dir.join("recent.json");
        let first = dir.join("first.md"); let second = dir.join("second.md");
        fs::write(&first, b"one").unwrap(); fs::write(&second, b"two").unwrap();
        remember_at(&file, &first, "file").unwrap();
        remember_at(&file, &second, "file").unwrap();
        remember_at(&file, &first, "file").unwrap();
        let entries = load(&file).entries;
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, second.to_str().unwrap());
        assert_eq!(entries[1].path, first.to_str().unwrap());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn linked_recent_record_is_ignored() {
        let dir = std::env::temp_dir().join(format!("mino-recent-link-{}",std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("outside.json"), br#"{"schemaVersion":1,"entries":[{"path":"/tmp/secret.md","kind":"file","lastOpened":1}]}"#).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.json"), dir.join("recent.json")).unwrap();
        assert!(load(&dir.join("recent.json")).entries.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
