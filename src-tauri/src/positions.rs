use crate::{documents::{document_identity, DocumentStore}, file_kinds::DocumentKind, fs::{app_data::ensure_dir, atomic_write, bounded_file::read_canonical_parent}};
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State, WebviewWindow};

/// Where the reader stopped in a text file or a PDF, kept across restarts (T83, T87). The file is keyed by a
/// hash of the path, so the record names no file; only a live document token can read or write an entry.
const MAX_ENTRIES: usize = 500;
const MAX_FILE: u64 = 256 * 1024;
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
    fn markdown_documents_and_unknown_tokens_are_not_tracked() {
        let store = DocumentStore::default();
        assert_eq!(tracked(&store, "doc-none").err().as_deref(), Some("OUT_OF_SCOPE"));
    }
}
