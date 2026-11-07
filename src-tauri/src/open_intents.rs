use crate::documents::{DocumentStore, OpenDocument, open_granted_path, read_selected_image_bytes, validate_image, validate_selected_file};
use crate::workspace::{WorkspaceRoot, WorkspaceStore, register_workspace};
use serde::Serialize;
use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{Duration, Instant}};
use tauri::{State, WebviewWindow};

static NEXT_INTENT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind { Markdown, Image, Folder }
struct Intent { path: PathBuf, kind: Kind }
#[derive(Default)]
pub struct IntentStore { pending: Mutex<HashMap<String, Intent>>, queue: Mutex<Vec<String>>, recent_events: Mutex<HashMap<PathBuf, Instant>> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentSummary { token: String, name: String, kind: &'static str }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageIntent { name: String, mime: &'static str, bytes: Vec<u8> }

fn kind_for(path: &Path) -> Option<Kind> {
    match path.extension().and_then(|e| e.to_str())?.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Some(Kind::Markdown),
        "png" | "jpg" | "jpeg" | "gif" | "webp" => Some(Kind::Image),
        _ => None,
    }
}
fn mime_for(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str())?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"), "gif" => Some("image/gif"), "webp" => Some("image/webp"), _ => None,
    }
}
fn enqueue(store: &IntentStore, path: PathBuf, allow_image: bool) -> bool {
    // A path can enter this queue only from a native OS open/drop event.
    // Reject a symlink at the dropped root before resolving its canonical path.
    let Ok(metadata) = fs::symlink_metadata(&path) else { return false };
    if metadata.file_type().is_symlink() { return false }
    let (path, kind) = if metadata.is_dir() {
        let Ok(canonical) = fs::canonicalize(&path) else { return false };
        (canonical, Kind::Folder)
    } else {
        let Ok(validated) = validate_selected_file(&path) else { return false };
        let Some(kind) = kind_for(&validated) else { return false };
        (validated, kind)
    };
    if kind == Kind::Image && !allow_image { return false }
    let Ok(mut recent) = store.recent_events.lock() else { return false };
    recent.retain(|_, at| at.elapsed() < Duration::from_secs(2));
    if recent.contains_key(&path) { return false }
    recent.insert(path.clone(), Instant::now());
    let token = format!("intent-{}", NEXT_INTENT.fetch_add(1, Ordering::Relaxed));
    if let Ok(mut pending) = store.pending.lock() { pending.insert(token.clone(), Intent { path, kind }); }
    else { return false }
    if let Ok(mut queue) = store.queue.lock() { queue.push(token); true } else { false }
}
pub fn enqueue_opened(store: &IntentStore, urls: &[tauri::Url]) -> bool {
    let mut changed = false;
    for url in urls { if url.scheme() == "file" { if let Ok(path) = url.to_file_path() { changed |= enqueue(store, path, false); } } }
    changed
}
pub fn enqueue_dropped(store: &IntentStore, paths: &[PathBuf]) -> bool {
    let mut changed = false;
    for path in paths { changed |= enqueue(store, path.clone(), true); }
    changed
}
#[tauri::command]
pub fn take_open_intents(window: WebviewWindow, store: State<'_, IntentStore>) -> Result<Vec<IntentSummary>, String> {
    if window.label() != "main" { return Err("OUT_OF_SCOPE".into()); }
    let tokens = std::mem::take(&mut *store.queue.lock().map_err(|_| "IO_ERROR")?);
    let map = store.pending.lock().map_err(|_| "IO_ERROR")?;
    Ok(tokens.into_iter().filter_map(|token| map.get(&token).map(|intent| IntentSummary { name: intent.path.file_name().unwrap_or_default().to_string_lossy().into_owned(), kind: match intent.kind { Kind::Markdown => "markdown", Kind::Image => "image", Kind::Folder => "folder" }, token })).collect())
}
#[tauri::command]
pub fn open_intent_workspace(window: WebviewWindow, intents: State<'_, IntentStore>, workspaces: State<'_, WorkspaceStore>, token: String) -> Result<WorkspaceRoot, String> {
    if window.label() != "main" { return Err("OUT_OF_SCOPE".into()); }
    let intent = intents.pending.lock().map_err(|_| "IO_ERROR")?.remove(&token).ok_or("OUT_OF_SCOPE")?;
    if intent.kind != Kind::Folder { return Err("OUT_OF_SCOPE".into()); }
    let metadata = fs::symlink_metadata(&intent.path).map_err(|_| "NOT_FOUND")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() { return Err("OUT_OF_SCOPE".into()); }
    register_workspace(&workspaces, intent.path)
}
#[tauri::command]
pub fn open_intent_document(window: WebviewWindow, intents: State<'_, IntentStore>, documents: State<'_, DocumentStore>, token: String) -> Result<OpenDocument, String> {
    if window.label() != "main" { return Err("OUT_OF_SCOPE".into()); }
    let intent = intents.pending.lock().map_err(|_| "IO_ERROR")?.remove(&token).ok_or("OUT_OF_SCOPE")?;
    if intent.kind != Kind::Markdown { return Err("OUT_OF_SCOPE".into()); }
    open_granted_path(&documents, &intent.path)
}
#[tauri::command]
pub fn read_intent_image(window: WebviewWindow, intents: State<'_, IntentStore>, token: String) -> Result<ImageIntent, String> {
    if window.label() != "main" { return Err("OUT_OF_SCOPE".into()); }
    let intent = intents.pending.lock().map_err(|_| "IO_ERROR")?.remove(&token).ok_or("OUT_OF_SCOPE")?;
    if intent.kind != Kind::Image { return Err("OUT_OF_SCOPE".into()); }
    let mime = mime_for(&intent.path).ok_or("INVALID_IMAGE")?;
    let bytes = read_selected_image_bytes(&intent.path)?;
    validate_image(&bytes, mime)?;
    Ok(ImageIntent { name: intent.path.file_name().unwrap_or_default().to_string_lossy().into_owned(), mime, bytes })
}
#[tauri::command]
pub fn discard_open_intent(window: WebviewWindow, intents: State<'_, IntentStore>, token: String) -> Result<(), String> {
    if window.label() != "main" { return Err("OUT_OF_SCOPE".into()); }
    intents.pending.lock().map_err(|_| "IO_ERROR")?.remove(&token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_supported_files_enter_queue_and_repeats_are_deduplicated() {
        let root = std::env::temp_dir().join(format!("mino-intents-{}-{}",std::process::id(),NEXT_INTENT.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        let md = root.join("note.md"); let txt = root.join("bad.txt");
        fs::write(&md,b"hi").unwrap(); fs::write(&txt,b"hi").unwrap();
        std::os::unix::fs::symlink(&md, root.join("link.md")).unwrap();
        let store = IntentStore::default();
        assert!(enqueue(&store,md.clone(),false));
        assert!(!enqueue(&store,md.clone(),false));
        assert!(!enqueue(&store,txt,false));
        assert!(!enqueue(&store,root.join("link.md"),false));
        assert_eq!(store.queue.lock().unwrap().len(),1);
        let nested = root.join("notes"); fs::create_dir(&nested).unwrap();
        assert!(enqueue(&store,nested.clone(),true));
        assert!(!enqueue(&store,nested.clone(),true));
        std::os::unix::fs::symlink(&nested,root.join("linked-folder")).unwrap();
        assert!(!enqueue(&store,root.join("linked-folder"),true));
        assert_eq!(store.queue.lock().unwrap().len(),2);
        fs::remove_dir_all(root).unwrap();
    }
}
