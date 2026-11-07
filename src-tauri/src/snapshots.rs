use crate::{documents::validate_image, fs::{atomic_write, asset_directory::{AssetDirectory, PutResult}}, markdown_images};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::Path, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{Duration, Instant}};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const MAX_DOCUMENT: usize = 20 * 1024 * 1024;
const MAX_TOTAL_ASSETS: usize = 100 * 1024 * 1024;
const MAX_GLOBAL_ASSETS: usize = 128 * 1024 * 1024;
const MAX_ASSETS: usize = 64;
const MAX_SNAPSHOTS: usize = 8;
static NEXT_SNAPSHOT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAsset { url: String, mime: String, bytes: Vec<u8> }
#[derive(Clone)]
struct Snapshot { markdown: String, title: String, assets: Vec<SnapshotAsset>, generation: u64, revision: u64, created: Instant }
#[derive(Default)]
pub struct SnapshotStore(Mutex<HashMap<String, Snapshot>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAsset { path: String, sha256: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult { name: String, sha256: String, assets: Vec<ExportedAsset>, generation: u64, revision: u64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotOut { markdown: String, title: String, assets: Vec<SnapshotAsset>, generation: u64, revision: u64 }

fn main_window(window: &WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("OUT_OF_SCOPE".into()) } }
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn register(store: &SnapshotStore, markdown: String, title: String, assets: Vec<SnapshotAsset>, generation: u64, revision: u64) -> Result<String, String> {
    if markdown.len() > MAX_DOCUMENT || title.len() > 256 || assets.len() > MAX_ASSETS { return Err("SNAPSHOT_TOO_LARGE".into()); }
    let mut total = 0usize;
    let image_urls = markdown_images::image_urls(&markdown);
    for asset in &assets {
        total = total.checked_add(asset.bytes.len()).ok_or("SNAPSHOT_TOO_LARGE")?;
        if total > MAX_TOTAL_ASSETS || !image_urls.contains(&asset.url) { return Err("INVALID_ASSET".into()); }
        validate_image(&asset.bytes, &asset.mime)?;
    }
    let mut map = store.0.lock().map_err(|_| "IO_ERROR")?;
    map.retain(|_, item| item.created.elapsed() < Duration::from_secs(30 * 60));
    if map.len() >= MAX_SNAPSHOTS { return Err("SNAPSHOT_BUDGET".into()); }
    let held: usize = map.values().flat_map(|item| item.assets.iter()).map(|asset| asset.bytes.len()).sum();
    if held.saturating_add(total) > MAX_GLOBAL_ASSETS { return Err("SNAPSHOT_BUDGET".into()); }
    let id = format!("snapshot-{}", NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed));
    map.insert(id.clone(), Snapshot { markdown, title, assets, generation, revision, created: Instant::now() });
    Ok(id)
}
fn snapshot(store: &SnapshotStore, id: &str) -> Result<Snapshot, String> {
    let map = store.0.lock().map_err(|_| "IO_ERROR")?;
    let item = map.get(id).ok_or("SNAPSHOT_NOT_FOUND")?;
    if item.created.elapsed() >= Duration::from_secs(30 * 60) { return Err("SNAPSHOT_NOT_FOUND".into()); }
    Ok(item.clone())
}
fn export_at(snapshot: &Snapshot, target: &Path, text_only: bool) -> Result<ExportResult, String> {
    if target.extension().and_then(|e| e.to_str()).is_none_or(|e| !e.eq_ignore_ascii_case("md") && !e.eq_ignore_ascii_case("markdown")) { return Err("UNSUPPORTED_FILE_TYPE".into()); }
    if target.exists() || fs::symlink_metadata(target).is_ok() { return Err("TARGET_EXISTS".into()); }
    let mut markdown = snapshot.markdown.clone();
    let mut assets_out = Vec::new();
    if text_only {
        let replacements = markdown_images::image_urls(&markdown).into_iter().map(|url| (url, "#image-not-exported".to_owned())).collect();
        markdown = markdown_images::rewrite_image_urls(&markdown, &replacements)?;
    } else {
        let urls = markdown_images::image_urls(&markdown);
        let lookup: HashMap<_, _> = snapshot.assets.iter().map(|asset| (asset.url.as_str(), asset)).collect();
        if urls.iter().any(|url| !lookup.contains_key(url.as_str())) { return Err("EXPORT_RESOURCE_MISSING".into()); }
        let parent = target.parent().ok_or("INVALID_PATH")?;
        let directory = if urls.is_empty() { None } else { Some(AssetDirectory::open(parent, true)?) };
        let mut replacements = HashMap::new();
        for url in urls {
            let asset = lookup.get(url.as_str()).ok_or("EXPORT_RESOURCE_MISSING")?;
            let ext = validate_image(&asset.bytes, &asset.mime)?;
            let sha256 = digest(&asset.bytes);
            let mut selected = None;
            for attempt in 0..100 {
                let name = if attempt == 0 { format!("image-{}.{}", &sha256[..24], ext) } else { format!("image-{}-{}.{}", &sha256[..24], attempt, ext) };
                if directory.as_ref().ok_or("ASSET_WRITE_FAILED")?.put(std::ffi::OsStr::new(&name), &asset.bytes)? == PutResult::ExistingDifferent { continue; }
                selected = Some(format!("assets/{name}")); break;
            }
            let relative = selected.ok_or("ASSET_WRITE_FAILED")?;
            replacements.insert(url, relative.clone());
            assets_out.push(ExportedAsset { path: relative, sha256 });
        }
        if let Some(directory) = &directory { directory.verify_location()?; }
        markdown = markdown_images::rewrite_image_urls(&markdown, &replacements)?;
    }
    let sha256 = atomic_write::commit(target, markdown.as_bytes(), None)?;
    Ok(ExportResult { name: target.file_name().ok_or("INVALID_PATH")?.to_string_lossy().into_owned(), sha256, assets: assets_out, generation: snapshot.generation, revision: snapshot.revision })
}

#[tauri::command]
pub fn create_snapshot(window: WebviewWindow, store: State<'_, SnapshotStore>, markdown: String, title: String, assets: Vec<SnapshotAsset>, generation: u64, revision: u64) -> Result<String, String> {
    main_window(&window)?;
    register(&store, markdown, title, assets, generation, revision)
}
#[tauri::command]
pub fn release_snapshot(window: WebviewWindow, store: State<'_, SnapshotStore>, snapshot_id: String) -> Result<(), String> {
    main_window(&window)?;
    store.0.lock().map_err(|_| "IO_ERROR")?.remove(&snapshot_id);
    Ok(())
}
#[tauri::command]
pub fn read_snapshot(window: WebviewWindow, store: State<'_, SnapshotStore>, snapshot_id: String) -> Result<SnapshotOut, String> {
    main_window(&window)?;
    let item = snapshot(&store, &snapshot_id)?;
    Ok(SnapshotOut { markdown: item.markdown, title: item.title, assets: item.assets, generation: item.generation, revision: item.revision })
}
#[tauri::command]
pub fn export_snapshot_md(app: AppHandle, window: WebviewWindow, store: State<'_, SnapshotStore>, snapshot_id: String, text_only: bool) -> Result<Option<ExportResult>, String> {
    main_window(&window)?;
    let frozen = snapshot(&store, &snapshot_id)?;
    let selected = app.dialog().file().add_filter("Markdown", &["md", "markdown"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "INVALID_PATH")?;
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let target = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    export_at(&frozen, &target, text_only).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn temp() -> PathBuf { let path = std::env::temp_dir().join(format!("mino-snapshot-{}-{}",std::process::id(),NEXT_SNAPSHOT.fetch_add(1,Ordering::Relaxed))); fs::create_dir(&path).unwrap(); fs::canonicalize(path).unwrap() }
    #[test]
    fn snapshot_is_frozen_and_exported_with_local_image() {
        let store = SnapshotStore::default();
        let bytes = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png").to_vec();
        let id = register(&store,"![x](blob:one)".into(),"note".into(),vec![SnapshotAsset { url: "blob:one".into(), mime: "image/png".into(), bytes: bytes.clone() }],7,3).unwrap();
        let mut frozen = snapshot(&store,&id).unwrap();
        frozen.markdown = "changed".into();
        assert_eq!(snapshot(&store,&id).unwrap().markdown,"![x](blob:one)");
        let dir = temp(); let target = dir.join("note.md");
        let output = export_at(&snapshot(&store,&id).unwrap(),&target,false).unwrap();
        assert_eq!(output.generation,7); assert_eq!(output.revision,3);
        let md = fs::read_to_string(target).unwrap();
        assert!(!md.contains("blob:"));
        assert_eq!(fs::read(dir.join(&output.assets[0].path)).unwrap(), bytes);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn missing_image_never_commits_markdown_but_text_only_is_explicit() {
        let dir = temp(); let target = dir.join("note.md");
        let snap = Snapshot { markdown: "![x](assets/missing.png)".into(), title: "n".into(), assets: vec![], generation: 1, revision: 1, created: Instant::now() };
        assert_eq!(export_at(&snap,&target,false).err().as_deref(),Some("EXPORT_RESOURCE_MISSING"));
        assert!(!target.exists());
        let out = export_at(&snap,&target,true).unwrap();
        assert!(out.assets.is_empty());
        assert_eq!(fs::read_to_string(target).unwrap(), "![x](#image-not-exported)");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reference_image_exports_with_its_definition_and_local_asset() {
        let markdown = "[link][ref] ![图][pic]\n\n[ref]: https://example.org/path\n[pic]: ./assets/中文%20图片%23%25%28a%29.png \"标题\"";
        let url = "./assets/中文%20图片%23%25%28a%29.png";
        let bytes = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png").to_vec();
        let store = SnapshotStore::default();
        let id = register(&store, markdown.into(), "note".into(), vec![SnapshotAsset { url: url.into(), mime: "image/png".into(), bytes: bytes.clone() }], 1, 1).unwrap();
        let dir = temp(); let target = dir.join("note.md");
        let result = export_at(&snapshot(&store, &id).unwrap(), &target, false).unwrap();
        let output = fs::read_to_string(&target).unwrap();
        assert!(output.contains("[ref]: https://example.org/path"));
        assert!(output.contains("[pic]: assets/image-"));
        assert_eq!(fs::read(dir.join(&result.assets[0].path)).unwrap(), bytes);
        fs::remove_dir_all(dir).unwrap();
    }
}
