use crate::documents::{DocumentStore, OpenDocument, open_granted_path, read_selected_image_bytes, validate_image, validate_selected_file};
use crate::workspace::{WorkspaceRoot, WorkspaceStore, register_workspace};
use serde::Serialize;
use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{Duration, Instant}};
use tauri::{State, WebviewWindow};

static NEXT_INTENT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind { Markdown, Image, Folder }
struct Intent { path: PathBuf, kind: Kind, owner: String }
#[derive(Default)]
pub struct IntentStore { pending: Mutex<HashMap<String, Intent>>, queue: Mutex<HashMap<String, Vec<String>>>, recent_events: Mutex<HashMap<(String, PathBuf), Instant>> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentSummary { token: String, name: String, kind: &'static str }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageIntent { name: String, mime: &'static str, staged: String }

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
fn enqueue(store: &IntentStore, path: PathBuf, allow_image: bool, owner: &str) -> bool {
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
    let event_key = (owner.to_owned(), path.clone());
    if recent.contains_key(&event_key) { return false }
    recent.insert(event_key, Instant::now());
    let token = format!("intent-{}", NEXT_INTENT.fetch_add(1, Ordering::Relaxed));
    if let Ok(mut pending) = store.pending.lock() { pending.insert(token.clone(), Intent { path, kind, owner: owner.into() }); }
    else { return false }
    if let Ok(mut queue) = store.queue.lock() { queue.entry(owner.into()).or_default().push(token); true } else { false }
}
pub fn enqueue_opened(store: &IntentStore, urls: &[tauri::Url], owner: &str) -> bool {
    let mut changed = false;
    for url in urls { if url.scheme() == "file" { if let Ok(path) = url.to_file_path() { changed |= enqueue(store, path, false, owner); } } }
    changed
}
pub fn enqueue_dropped(store: &IntentStore, paths: &[PathBuf], owner: &str) -> bool {
    let mut changed = false;
    for path in paths { changed |= enqueue(store, path.clone(), true, owner); }
    changed
}
fn take_intent(store: &IntentStore, token: &str, owner: &str) -> Result<Intent, String> {
    let mut pending = store.pending.lock().map_err(|_| "IO_ERROR")?;
    if pending.get(token).is_none_or(|intent| intent.owner != owner) { return Err("OUT_OF_SCOPE".into()); }
    pending.remove(token).ok_or("OUT_OF_SCOPE".into())
}
#[tauri::command]
pub fn take_open_intents(window: WebviewWindow, store: State<'_, IntentStore>) -> Result<Vec<IntentSummary>, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    let tokens = store.queue.lock().map_err(|_| "IO_ERROR")?.remove(window.label()).unwrap_or_default();
    let map = store.pending.lock().map_err(|_| "IO_ERROR")?;
    Ok(tokens.into_iter().filter_map(|token| map.get(&token).map(|intent| IntentSummary { name: intent.path.file_name().unwrap_or_default().to_string_lossy().into_owned(), kind: match intent.kind { Kind::Markdown => "markdown", Kind::Image => "image", Kind::Folder => "folder" }, token })).collect())
}
#[tauri::command(async)]
pub fn open_intent_workspace(window: WebviewWindow, intents: State<'_, IntentStore>, workspaces: State<'_, WorkspaceStore>, token: String) -> Result<WorkspaceRoot, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    let intent = take_intent(&intents, &token, window.label())?;
    if intent.kind != Kind::Folder { return Err("OUT_OF_SCOPE".into()); }
    let metadata = fs::symlink_metadata(&intent.path).map_err(|_| "NOT_FOUND")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() { return Err("OUT_OF_SCOPE".into()); }
    register_workspace(&workspaces, intent.path)
}
#[tauri::command(async)]
pub fn open_intent_document(window: WebviewWindow, intents: State<'_, IntentStore>, documents: State<'_, DocumentStore>, token: String) -> Result<OpenDocument, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    let intent = take_intent(&intents, &token, window.label())?;
    if intent.kind != Kind::Markdown { return Err("OUT_OF_SCOPE".into()); }
    open_granted_path(&documents, &intent.path)
}
#[tauri::command(async)]
pub fn read_intent_image(window: WebviewWindow, intents: State<'_, IntentStore>, staging: State<'_, crate::staging::StagingStore>, token: String) -> Result<ImageIntent, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    let intent = take_intent(&intents, &token, window.label())?;
    if intent.kind != Kind::Image { return Err("OUT_OF_SCOPE".into()); }
    let mime = mime_for(&intent.path).ok_or("INVALID_IMAGE")?;
    let bytes = read_selected_image_bytes(&intent.path)?;
    validate_image(&bytes, mime)?;
    Ok(ImageIntent { name: intent.path.file_name().unwrap_or_default().to_string_lossy().into_owned(), mime, staged: staging.put(bytes)? })
}
#[tauri::command]
pub fn discard_open_intent(window: WebviewWindow, intents: State<'_, IntentStore>, token: String) -> Result<(), String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    let _ = take_intent(&intents, &token, window.label())?;
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
        assert!(enqueue(&store,md.clone(),false,"main"));
        assert!(!enqueue(&store,md.clone(),false,"main"));
        assert!(!enqueue(&store,txt,false,"main"));
        assert!(!enqueue(&store,root.join("link.md"),false,"main"));
        assert_eq!(store.queue.lock().unwrap().get("main").unwrap().len(),1);
        let nested = root.join("notes"); fs::create_dir(&nested).unwrap();
        assert!(enqueue(&store,nested.clone(),true,"main"));
        assert!(!enqueue(&store,nested.clone(),true,"main"));
        std::os::unix::fs::symlink(&nested,root.join("linked-folder")).unwrap();
        assert!(!enqueue(&store,root.join("linked-folder"),true,"main"));
        assert_eq!(store.queue.lock().unwrap().get("main").unwrap().len(),2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn queued_file_belongs_to_its_target_window() {
        let root = std::env::temp_dir().join(format!("mino-intent-owner-{}", NEXT_INTENT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        let path = root.join("note.md"); fs::write(&path, b"hello").unwrap();
        let store = IntentStore::default();
        assert!(enqueue(&store, path.clone(), false, "workspace-1"));
        assert!(store.queue.lock().unwrap().get("main").is_none());
        let token = store.queue.lock().unwrap().get("workspace-1").unwrap()[0].clone();
        assert!(take_intent(&store, &token, "main").is_err());
        assert!(take_intent(&store, &token, "workspace-1").is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
