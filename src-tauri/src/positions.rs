use crate::{documents::{document_identity, DocumentStore}, file_kinds::DocumentKind, fs::{app_data::ensure_dir, atomic_write, bounded_file::read_canonical_parent}};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// Where the reader stopped in a text file or a PDF, kept across restarts (T83, T87). The file is keyed by a
/// hash of the path, so the record names no file; only a live document token can read or write an entry.
const MAX_ENTRIES: usize = 500;
const MAX_FILE: u64 = 256 * 1024;
/// How many files and folders a moved folder is walked through to carry reading positions along.
const RELOCATE_LIMIT: usize = 20_000;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    /// The page of a PDF, counted from 1; 0 for text.
    page: u32,
    /// How far down: of the whole text, or of the page.
    offset: f64,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct Entry { key: String, page: u32, offset: f64, at: u64 }

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Record { schema_version: u32, entries: Vec<Entry> }

fn key_of(path: &Path) -> String { crate::fs::sha256_hex(path.to_string_lossy().as_bytes()) }

fn valid(position: &Position) -> bool { position.page <= 1_000_000 && position.offset.is_finite() && (0.0..=1.0).contains(&position.offset) }

fn lookup(record: &Record, key: &str) -> Option<Position> {
    record.entries.iter().find(|entry| entry.key == key).map(|entry| Position { page: entry.page, offset: entry.offset }).filter(valid)
}

/// Puts the position first and drops the oldest entries beyond the limit.
fn remember(record: &mut Record, key: String, position: Position, at: u64) {
    record.schema_version = 1;
    record.entries.retain(|entry| entry.key != key);
    record.entries.insert(0, Entry { key, page: position.page, offset: position.offset, at });
    record.entries.truncate(MAX_ENTRIES);
}

fn storage(app: &AppHandle) -> Result<PathBuf, String> { Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join("reading-positions.json")) }

fn load(path: &Path) -> (Record, Option<String>) {
    let bytes = read_canonical_parent(path, MAX_FILE).ok();
    let expected = bytes.as_ref().map(|bytes| crate::fs::sha256_hex(bytes));
    let record = bytes.and_then(|bytes| serde_json::from_slice::<Record>(&bytes).ok()).filter(|record| record.schema_version == 1).unwrap_or_default();
    (record, expected)
}

/// Markdown keeps its place for the session only, as before; these records are for the kinds that are read like a book.
fn tracked(store: &DocumentStore, token: &str) -> Result<String, String> {
    let (path, kind) = document_identity(store, token)?;
    if kind == DocumentKind::Markdown { return Err("OUT_OF_SCOPE".into()); }
    Ok(key_of(&path))
}

#[tauri::command(async)]
pub fn get_reading_position(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<Option<Position>, String> {
    crate::require_workspace_window(&window)?;
    let key = tracked(&store, &token)?;
    Ok(lookup(&load(&storage(&app)?).0, &key))
}

#[tauri::command(async)]
pub fn set_reading_position(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, token: String, position: Position) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    if !valid(&position) { return Err("INVALID_POSITION".into()); }
    let key = tracked(&store, &token)?;
    let _guard = WRITE_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let path = storage(&app)?;
    let (mut record, expected) = load(&path);
    if lookup(&record, &key) == Some(position) { return Ok(()); }
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0);
    remember(&mut record, key, position, at);
    let bytes = serde_json::to_vec(&record).map_err(|_| "IO_ERROR")?;
    atomic_write::commit_canonical_parent(&path, &bytes, expected.as_deref()).map(|_| ())
}

/// Moves the keys of `old`, or of every file below a moved folder, to their new place (T109), so reading
/// positions survive a rename or a move in the sidebar. `new` is where the entry is now; its files are walked
/// without following links, up to a bound, because the record holds only hashes.
fn relocate_keys(record: &mut Record, old: &Path, new: &Path) -> bool {
    if record.entries.is_empty() { return false; }
    let mut moved = HashMap::new();
    let mut pending = vec![new.to_path_buf()];
    let mut seen = 0usize;
    while let Some(path) = pending.pop() {
        seen += 1;
        if seen > RELOCATE_LIMIT { break; }
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        if meta.is_dir() {
            if let Ok(children) = std::fs::read_dir(&path) { pending.extend(children.flatten().map(|child| child.path())); }
        } else if meta.is_file() {
            if let Ok(rest) = path.strip_prefix(new) {
                let before = if rest.as_os_str().is_empty() { old.to_path_buf() } else { old.join(rest) };
                moved.insert(key_of(&before), key_of(&path));
            }
        }
    }
    let mut changed = false;
    for entry in &mut record.entries {
        if let Some(key) = moved.get(&entry.key) { entry.key = key.clone(); changed = true; }
    }
    changed
}

/// Follows a rename or move made in the app. Positions are a convenience: failing here never fails the move.
pub(crate) fn relocate(app: &AppHandle, old: &Path, new: &Path) {
    let Ok(_guard) = WRITE_LOCK.lock() else { return };
    let Ok(path) = storage(app) else { return };
    let (mut record, expected) = load(&path);
    if !relocate_keys(&mut record, old, new) { return; }
    if let Ok(bytes) = serde_json::to_vec(&record) { let _ = atomic_write::commit_canonical_parent(&path, &bytes, expected.as_deref()); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_position_replaces_the_old_one_and_the_list_is_bounded() {
        let mut record = Record::default();
        remember(&mut record, "a".into(), Position { page: 0, offset: 0.25 }, 1);
        remember(&mut record, "b".into(), Position { page: 12, offset: 0.5 }, 2);
        remember(&mut record, "a".into(), Position { page: 0, offset: 0.75 }, 3);
        assert_eq!(record.entries.iter().map(|entry| entry.key.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(lookup(&record, "a"), Some(Position { page: 0, offset: 0.75 }));
        assert_eq!(lookup(&record, "b"), Some(Position { page: 12, offset: 0.5 }));
        assert_eq!(lookup(&record, "c"), None);
        for index in 0..MAX_ENTRIES + 20 { remember(&mut record, format!("k{index}"), Position { page: 1, offset: 0.0 }, 10); }
        assert_eq!(record.entries.len(), MAX_ENTRIES);
        assert_eq!(lookup(&record, "a"), None);
        assert_eq!(record.schema_version, 1);
    }

    #[test]
    fn positions_outside_the_page_are_refused_and_never_returned() {
        for position in [Position { page: 0, offset: -0.1 }, Position { page: 0, offset: 1.5 }, Position { page: 0, offset: f64::NAN }, Position { page: 2_000_000, offset: 0.0 }] { assert!(!valid(&position)); }
        assert!(valid(&Position { page: 0, offset: 0.0 }) && valid(&Position { page: 300, offset: 1.0 }));
        let record = Record { schema_version: 1, entries: vec![Entry { key: "a".into(), page: 0, offset: 7.0, at: 0 }] };
        assert_eq!(lookup(&record, "a"), None);
    }

    #[test]
    fn the_record_holds_no_path() {
        let key = key_of(Path::new("/Users/someone/Books/小说.txt"));
        assert_eq!(key.len(), 64);
        assert!(key.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(key, key_of(Path::new("/Users/someone/Books/小说2.txt")));
        let mut record = Record::default();
        remember(&mut record, key, Position { page: 3, offset: 0.5 }, 9);
        let json = serde_json::to_string(&record).unwrap();
        assert!(!json.contains("Books") && !json.contains("小说"));
        assert!(json.contains("\"schemaVersion\":1"));
    }

    #[test]
    fn positions_follow_a_renamed_file_and_the_files_of_a_moved_folder() {
        let dir = std::env::temp_dir().join(format!("mino-positions-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("new/sub")).unwrap();
        std::fs::write(dir.join("new/a.txt"), "a").unwrap();
        std::fs::write(dir.join("new/sub/b.pdf"), "b").unwrap();
        let mut record = Record::default();
        remember(&mut record, key_of(&dir.join("old/a.txt")), Position { page: 0, offset: 0.5 }, 1);
        remember(&mut record, key_of(&dir.join("old/sub/b.pdf")), Position { page: 4, offset: 0.25 }, 2);
        remember(&mut record, key_of(&dir.join("other.txt")), Position { page: 0, offset: 0.75 }, 3);
        assert!(relocate_keys(&mut record, &dir.join("old"), &dir.join("new")));
        assert_eq!(lookup(&record, &key_of(&dir.join("new/a.txt"))), Some(Position { page: 0, offset: 0.5 }));
        assert_eq!(lookup(&record, &key_of(&dir.join("new/sub/b.pdf"))), Some(Position { page: 4, offset: 0.25 }));
        assert_eq!(lookup(&record, &key_of(&dir.join("other.txt"))), Some(Position { page: 0, offset: 0.75 }));
        // A single file.
        std::fs::rename(dir.join("new/a.txt"), dir.join("new/c.txt")).unwrap();
        assert!(relocate_keys(&mut record, &dir.join("new/a.txt"), &dir.join("new/c.txt")));
        assert_eq!(lookup(&record, &key_of(&dir.join("new/c.txt"))), Some(Position { page: 0, offset: 0.5 }));
        assert!(!relocate_keys(&mut record, &dir.join("nothing"), &dir.join("new/sub")));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn markdown_documents_and_unknown_tokens_are_not_tracked() {
        let store = DocumentStore::default();
        assert_eq!(tracked(&store, "doc-none").err().as_deref(), Some("OUT_OF_SCOPE"));
    }
}
