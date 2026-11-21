use crate::documents::{DocumentStore, asset_mime, draft_target, read_granted_asset};
use crate::staging::{DiskAsset, HeldAsset as DraftAsset, StagedAsset, StagingStore};
use crate::fs::bounded_file::read_no_follow;
use crate::fs::app_data::ensure_dir;
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use std::fs::OpenOptions;
use std::{collections::HashMap, fs::{self, File}, io::Write, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const MAX_DOCUMENT: usize = crate::file_kinds::MAX_TEXT_BYTES as usize;
const MAX_IMAGE: usize = crate::file_kinds::MAX_IMAGE_BYTES as usize;
const MAX_ASSETS: usize = 64;
/// The most image bytes a draft copies from beside its file. Restoring stages every image of a draft, so this
/// stays well inside the staging budget (512 MiB), and a draft that could be written can always be restored.
const MAX_DISK_ASSET_BYTES: usize = 256 * 1024 * 1024;
const KEEP_SNAPSHOTS: usize = 3;
static NEXT_SNAPSHOT: AtomicU64 = AtomicU64::new(1);
static DRAFT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetRecord { url: String, mime: String, filename: String, sha256: String }
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest { schema_version: u32, draft_id: String, name: String, target_path: Option<String>, base_disk_revision: Option<String>, body_revision: String, assets: Vec<AssetRecord> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary { draft_id: String, name: String, target_path: Option<String>, target_status: &'static str, snapshots: usize }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftContent { draft_id: String, name: String, markdown: String, assets: Vec<StagedAsset>, asset_count: usize, target_path: Option<String>, target_status: &'static str }

/// The most a snapshot's manifest may hold.
const MANIFEST_LIMIT: u64 = 64 * 1024;
/// Whether a draft keeps this image: the text refers to it, and it is a raster image within the size limit.
fn storable(asset: &DraftAsset, markdown: &str) -> bool {
    !asset.url.is_empty() && asset.url.len() <= 1024 && markdown.contains(&asset.url) && !asset.bytes.is_empty() && asset.bytes.len() <= MAX_IMAGE
        && matches!(asset.mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp")
}
fn hash(bytes: &[u8]) -> String { crate::fs::sha256_hex(bytes) }
fn valid_id(id: &str) -> bool { id.len() >= 8 && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|_| "IO_ERROR")?;
    let path = ensure_dir(&app_data)?.join("drafts");
    if let Ok(meta) = fs::symlink_metadata(&path) { if meta.file_type().is_symlink() || !meta.is_dir() { return Err("OUT_OF_SCOPE".into()); } }
    Ok(path)
}
#[cfg(not(target_os = "macos"))]
fn write_sync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path).map_err(|_| "IO_ERROR")?;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "IO_ERROR".into())
}
#[cfg(not(target_os = "macos"))]
fn sync_dir(path: &Path) -> Result<(), String> { File::open(path).and_then(|f| f.sync_all()).map_err(|_| "IO_ERROR".into()) }
#[cfg(any(test, not(target_os = "macos")))]
fn snapshots(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(folder) else { return vec![] };
    let mut result: Vec<_> = entries.flatten().map(|e| e.path()).filter(|p| p.file_name().and_then(|s| s.to_str()).is_some_and(|s| s.starts_with("snapshot-")) && fs::symlink_metadata(p).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())).collect();
    result.sort_by(|a,b| b.file_name().cmp(&a.file_name()));
    result
}
/// The first number of a new snapshot's name (`snapshot-<first:020>-<counter:010>`, newest highest): the time in
/// milliseconds, or one past the highest number already in the draft's folder when that is later, so a clock set
/// back never makes the newest snapshot sort, and get pruned, as the oldest. Names written before keep their order.
fn next_sequence<'a>(names: impl Iterator<Item = &'a str>, now: u128) -> u128 {
    const WIDEST: u128 = 99_999_999_999_999_999_999; // 20 digits; a longer number would no longer sort by its text
    names.filter_map(|name| name.strip_prefix("snapshot-").or_else(|| name.strip_prefix(".staging-")))
        .filter_map(|rest| rest.split('-').next()?.parse::<u128>().ok())
        .filter(|first| *first < WIDEST)
        .fold(now, |next, first| next.max(first + 1))
}
fn now_millis() -> Result<u128, String> {
    Ok(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "IO_ERROR")?.as_millis())
}
fn target_status(path: Option<&str>, base: Option<&str>) -> &'static str {
    let Some(path) = path else { return "untitled" };
    let Some(base) = base else { return "unknown" };
    let path = Path::new(path);
    match read_no_follow(path, MAX_DOCUMENT as u64) {
        Ok(bytes) if hash(&bytes) == base => "same",
        Ok(_) => "changed",
        Err(code) if code == "NOT_FOUND" => "deleted",
        Err(_) => "unknown",
    }
}
#[cfg(any(test, not(target_os = "macos")))]
fn read_snapshot(path: &Path) -> Result<(Manifest, String, Vec<DraftAsset>), String> {
    let manifest_bytes = read_no_follow(&path.join("manifest.json"), MANIFEST_LIMIT).map_err(|_| "CORRUPT_DRAFT")?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|_| "CORRUPT_DRAFT")?;
    if manifest.schema_version != 1 || !valid_id(&manifest.draft_id) || manifest.assets.len() > MAX_ASSETS { return Err("CORRUPT_DRAFT".into()); }
    let body = read_no_follow(&path.join("document.md"), MAX_DOCUMENT as u64).map_err(|_| "CORRUPT_DRAFT")?;
    if hash(&body) != manifest.body_revision { return Err("CORRUPT_DRAFT".into()); }
    let markdown = String::from_utf8(body).map_err(|_| "CORRUPT_DRAFT")?;
    let mut assets = Vec::new();
    // As on macOS: a missing or damaged image is left out, and the newest text still wins.
    for asset in &manifest.assets {
        if !asset.filename.starts_with("asset-") || asset.filename.contains('/') || asset.filename.contains('\\') || !markdown.contains(&asset.url) { continue; }
        let Ok(bytes) = read_no_follow(&path.join("assets").join(&asset.filename), MAX_IMAGE as u64) else { continue };
        if hash(&bytes) != asset.sha256 { continue; }
        assets.push(DraftAsset { url: asset.url.clone(), mime: asset.mime.clone(), bytes });
    }
    Ok((manifest, markdown, assets))
}
#[cfg(any(test, not(target_os = "macos")))]
fn latest(folder: &Path) -> Result<(Manifest, String, Vec<DraftAsset>), String> {
    for snapshot in snapshots(folder) { if let Ok(record) = read_snapshot(&snapshot) { return Ok(record); } }
    Err("CORRUPT_DRAFT".into())
}
#[cfg(test)]
fn write_at(root: &Path, draft_id: &str, name: &str, target_path: Option<String>, base_disk_revision: Option<String>, markdown: &str, assets: Vec<DraftAsset>) -> Result<(), String> {
    write_retaining(root, draft_id, name, target_path, base_disk_revision, markdown, assets, &[])
}
/// `retained` lists asset URLs whose bytes are already in the draft's latest snapshot and are reused without re-upload.
#[allow(clippy::too_many_arguments)]
fn write_retaining(root: &Path, draft_id: &str, name: &str, target_path: Option<String>, base_disk_revision: Option<String>, markdown: &str, assets: Vec<DraftAsset>, retained: &[String]) -> Result<(), String> {
    if !valid_id(draft_id) || name.len() > 256 || markdown.len() > MAX_DOCUMENT || assets.len() + retained.len() > MAX_ASSETS { return Err("INVALID_DRAFT".into()); }
    if retained.iter().any(|url| url.is_empty() || url.len() > 1024 || !markdown.contains(url.as_str())) { return Err("INVALID_ASSET".into()); }
    let _guard = DRAFT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    #[cfg(target_os = "macos")]
    return write_at_macos(root, draft_id, name, target_path, base_disk_revision, markdown, assets, retained);
    #[cfg(not(target_os = "macos"))]
    {
    fs::create_dir_all(root).map_err(|_| "IO_ERROR")?;
    let folder = root.join(draft_id);
    if folder.exists() && fs::symlink_metadata(&folder).map_err(|_| "OUT_OF_SCOPE")?.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
    fs::create_dir_all(&folder).map_err(|_| "IO_ERROR")?;
    let mut assets = assets;
    if !retained.is_empty() {
        let (_, _, prior) = latest(&folder).map_err(|_| "DRAFT_ASSET_MISSING")?;
        for url in retained {
            let asset = prior.iter().find(|item| &item.url == url).ok_or("DRAFT_ASSET_MISSING")?;
            assets.push(DraftAsset { url: asset.url.clone(), mime: asset.mime.clone(), bytes: asset.bytes.clone() });
        }
    }
    let existing: Vec<String> = fs::read_dir(&folder).map_err(|_| "IO_ERROR")?.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
    let snapshot_id = format!("{:020}-{:010}", next_sequence(existing.iter().map(String::as_str), now_millis()?), NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed));
    let staging = folder.join(format!(".staging-{snapshot_id}"));
    fs::create_dir(&staging).map_err(|_| "IO_ERROR")?;
    let result = (|| {
        let assets_dir = staging.join("assets");
        fs::create_dir(&assets_dir).map_err(|_| "IO_ERROR")?;
        let mut records = Vec::new();
        for (index, asset) in assets.iter().enumerate() {
            if !storable(asset, markdown) { return Err("INVALID_ASSET".into()); }
            let sha256 = hash(&asset.bytes);
            let filename = format!("asset-{index:03}-{}.bin", &sha256[..24]);
            write_sync(&assets_dir.join(&filename), &asset.bytes)?;
            records.push(AssetRecord { url: asset.url.clone(), mime: asset.mime.clone(), filename, sha256 });
        }
        write_sync(&staging.join("document.md"), markdown.as_bytes())?;
        let manifest = Manifest { schema_version: 1, draft_id: draft_id.into(), name: name.into(), target_path, base_disk_revision, body_revision: hash(markdown.as_bytes()), assets: records };
        write_sync(&staging.join("manifest.json"), &serde_json::to_vec(&manifest).map_err(|_| "IO_ERROR")?)?;
        sync_dir(&assets_dir)?;
        sync_dir(&staging)?;
        fs::rename(&staging, folder.join(format!("snapshot-{snapshot_id}"))).map_err(|_| "IO_ERROR")?;
        sync_dir(&folder)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&staging); }
    else { for old in snapshots(&folder).into_iter().skip(KEEP_SNAPSHOTS) { let _ = fs::remove_dir_all(old); } }
    result
    }
}

#[cfg(target_os = "macos")]
#[allow(clippy::too_many_arguments)]
fn write_at_macos(root: &Path, draft_id: &str, name: &str, target_path: Option<String>, base_disk_revision: Option<String>, markdown: &str, assets: Vec<DraftAsset>, retained: &[String]) -> Result<(), String> {
    use std::{ffi::{CString, OsStr}, os::fd::AsRawFd};
    use macos_tree::{name as entry, same_entry as identity};
    fn make_dir(parent: &File, name: &CString) -> Result<File, String> {
        crate::fs::ensure_directory_at(parent, name, 0o700).map_err(|_| "IO_ERROR")?;
        crate::fs::open_directory_at(parent, name).map_err(|_| "OUT_OF_SCOPE".into())
    }
    fn write_file(parent: &File, name: &CString, bytes: &[u8]) -> Result<(), String> {
        let mut file = crate::fs::create_file_at(parent, name, libc::O_WRONLY, 0o600).map_err(|_| "IO_ERROR")?;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "IO_ERROR".into())
    }
    let mut records = Vec::with_capacity(assets.len() + retained.len());
    for (index, asset) in assets.iter().enumerate() {
        if !storable(asset, markdown) { return Err("INVALID_ASSET".into()); }
        let sha256 = hash(&asset.bytes);
        records.push(AssetRecord { url: asset.url.clone(), mime: asset.mime.clone(), filename: format!("asset-{index:03}-{}.bin", &sha256[..24]), sha256 });
    }
    let root_parent = root.parent().ok_or("INVALID_PATH")?;
    let app_data = crate::fs::open_canonical_directory(root_parent, "OUT_OF_SCOPE")?;
    let root_name = entry(root.file_name().ok_or("INVALID_PATH")?)?;
    let root_dir = make_dir(&app_data, &root_name)?;
    let draft_name = entry(OsStr::new(draft_id))?;
    let folder = make_dir(&root_dir, &draft_name)?;
    // Unchanged images are hard-linked from the latest snapshot instead of being resent and rewritten.
    let mut links = Vec::with_capacity(retained.len());
    let prior_assets = if retained.is_empty() { None } else {
        let (snapshot_dir, prior) = macos_read::latest_manifest(&folder).map_err(|_| "DRAFT_ASSET_MISSING")?;
        for url in retained {
            let record = prior.assets.iter().find(|item| &item.url == url).ok_or("DRAFT_ASSET_MISSING")?;
            if record.filename.contains('/') || !record.filename.starts_with("asset-") { return Err("DRAFT_ASSET_MISSING".into()); }
            let index = records.len();
            let filename = format!("asset-{index:03}-{}.bin", &record.sha256[..24.min(record.sha256.len())]);
            links.push((entry(OsStr::new(&record.filename))?, entry(OsStr::new(&filename))?));
            records.push(AssetRecord { url: url.clone(), mime: record.mime.clone(), filename, sha256: record.sha256.clone() });
        }
        Some(macos_read::assets_dir(&snapshot_dir).map_err(|_| "DRAFT_ASSET_MISSING")?)
    };
    let manifest = Manifest { schema_version: 1, draft_id: draft_id.into(), name: name.into(), target_path, base_disk_revision, body_revision: hash(markdown.as_bytes()), assets: records };
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|_| "IO_ERROR")?;
    let existing = macos_tree::entries(&folder)?;
    let sequence = next_sequence(existing.iter().filter_map(|name| name.to_str()), now_millis()?);
    let snapshot_id = format!("{:020}-{:010}", sequence, NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed));
    let staging_name = entry(OsStr::new(&format!(".staging-{snapshot_id}")))?;
    let published_name = entry(OsStr::new(&format!("snapshot-{snapshot_id}")))?;
    crate::fs::make_directory_at(&folder, &staging_name, 0o700).map_err(|_| "IO_ERROR")?;
    let staging = crate::fs::open_directory_at(&folder, &staging_name).map_err(|_| "OUT_OF_SCOPE")?;
    let asset_dir = make_dir(&staging, &entry(OsStr::new("assets"))?)?;
    for (asset, record) in assets.iter().zip(&manifest.assets) { write_file(&asset_dir, &entry(OsStr::new(&record.filename))?, &asset.bytes)?; }
    if let Some(prior) = &prior_assets {
        for (from, to) in &links {
            if unsafe { libc::linkat(prior.as_raw_fd(), from.as_ptr(), asset_dir.as_raw_fd(), to.as_ptr(), 0) } < 0 { return Err("DRAFT_ASSET_MISSING".into()); }
        }
    }
    write_file(&staging, &entry(OsStr::new("document.md"))?, markdown.as_bytes())?;
    write_file(&staging, &entry(OsStr::new("manifest.json"))?, &manifest_bytes)?;
    asset_dir.sync_all().map_err(|_| "IO_ERROR")?;
    staging.sync_all().map_err(|_| "IO_ERROR")?;
    identity(&folder, &staging_name, &staging)?;
    identity(&root_dir, &draft_name, &folder)?;
    identity(&app_data, &root_name, &root_dir)?;
    let moved = unsafe { libc::renameatx_np(folder.as_raw_fd(), staging_name.as_ptr(), folder.as_raw_fd(), published_name.as_ptr(), libc::RENAME_EXCL) };
    if moved < 0 { return Err("IO_ERROR".into()); }
    folder.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    identity(&folder, &published_name, &staging)?;
    identity(&root_dir, &draft_name, &folder)?;
    identity(&app_data, &root_name, &root_dir)?;
    crate::fs::still_at(root_parent, &app_data, "COMMIT_UNCERTAIN")?;
    // The new snapshot is durable; failing to trim older ones must not fail the write.
    let _ = macos_tree::prune(&folder, KEEP_SNAPSHOTS);
    Ok(())
}

/// Which window's tab writes each draft. A draft belongs to one tab: recovering it a second time, or recovering
/// the draft of a document that is still open, would give two tabs one draft, each overwriting the other's.
#[derive(Default)]
pub struct DraftClaims(Mutex<HashMap<String, String>>);

impl DraftClaims {
    /// Gives draft `id` to window `label`, unless another window that is still open has it.
    fn claim(&self, id: &str, label: &str, alive: impl Fn(&str) -> bool) -> Result<(), String> {
        let mut claims = self.0.lock().map_err(|_| "IO_ERROR")?;
        if claims.get(id).is_some_and(|holder| holder != label && alive(holder)) { return Err("DRAFT_IN_USE".into()); }
        claims.insert(id.to_owned(), label.to_owned());
        Ok(())
    }
    fn in_use(&self, id: &str, alive: impl Fn(&str) -> bool) -> bool {
        self.0.lock().is_ok_and(|claims| claims.get(id).is_some_and(|holder| alive(holder)))
    }
    fn release(&self, id: &str) { if let Ok(mut claims) = self.0.lock() { claims.remove(id); } }
    /// Moves draft `id` along with its tab to a new window.
    pub(crate) fn hand_over(&self, id: &str, label: &str) { if let Ok(mut claims) = self.0.lock() { claims.insert(id.to_owned(), label.to_owned()); } }
    pub(crate) fn release_window(&self, label: &str) { if let Ok(mut claims) = self.0.lock() { claims.retain(|_, holder| holder != label); } }
}

fn window_alive(app: &AppHandle) -> impl Fn(&str) -> bool + '_ { |label| app.get_webview_window(label).is_some() }

/// The images on disk beside the file that a draft also keeps, after the ones pasted or already kept: as many as
/// fit in the count and the byte limit. The others are still beside the file; the text is protected regardless.
fn disk_copies(mut read: impl FnMut(&DiskAsset) -> Option<DraftAsset>, disk_assets: Vec<DiskAsset>, mut room: usize, mut bytes: usize) -> Vec<DraftAsset> {
    let mut copies = Vec::new();
    for asset in disk_assets {
        if room == 0 || bytes >= MAX_DISK_ASSET_BYTES { break; }
        // A missing attachment must not stop the text from being protected.
        let Some(copy) = read(&asset) else { continue };
        if bytes + copy.bytes.len() > MAX_DISK_ASSET_BYTES { continue; }
        bytes += copy.bytes.len();
        room -= 1;
        copies.push(copy);
    }
    copies
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn write_draft(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, staging: State<'_, StagingStore>, claims: State<'_, DraftClaims>, draft_id: String, name: String, token: Option<String>, base_disk_revision: Option<String>, markdown: String, assets: Vec<StagedAsset>, disk_assets: Vec<DiskAsset>, retained: Vec<String>) -> Result<Vec<String>, String> {
    crate::require_workspace_window(&window)?;
    if !valid_id(&draft_id) { return Err("INVALID_DRAFT".into()); }
    claims.claim(&draft_id, window.label(), window_alive(&app))?;
    let mut uploads = staging.take_all(assets)?;
    if let Some(token) = &token {
        let room = MAX_ASSETS.saturating_sub(uploads.len() + retained.len());
        let held = uploads.iter().map(|asset| asset.bytes.len()).sum();
        let read = |asset: &DiskAsset| Some(DraftAsset { url: asset.url.clone(), mime: asset_mime(&asset.relative)?.into(), bytes: read_granted_asset(&store, token, &asset.relative).ok()? });
        uploads.extend(disk_copies(read, disk_assets, room, held));
    }
    let target = match token { Some(token) => Some(draft_target(&store, &token)?), None => None };
    let stored = retained.iter().cloned().chain(uploads.iter().map(|asset| asset.url.clone())).collect();
    write_retaining(&root(&app)?, &draft_id, &name, target, base_disk_revision, &markdown, uploads, &retained)?;
    Ok(stored)
}
#[tauri::command(async)]
pub fn list_drafts(app: AppHandle, window: WebviewWindow, claims: State<'_, DraftClaims>) -> Result<Vec<DraftSummary>, String> {
    crate::require_workspace_window(&window)?;
    let mut found = list_all(&root(&app)?)?;
    // A draft a tab is still writing is not offered for recovery.
    found.retain(|draft| !claims.in_use(&draft.draft_id, window_alive(&app)));
    Ok(found)
}

fn list_all(root: &Path) -> Result<Vec<DraftSummary>, String> {
    #[cfg(target_os = "macos")]
    return macos_read::list(root);
    #[cfg(not(target_os = "macos"))]
    {
    let Ok(entries) = fs::read_dir(root) else { return Ok(vec![]) };
    let mut output = Vec::new();
    for entry in entries.flatten() {
        let folder = entry.path();
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) || !fs::symlink_metadata(&folder).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) { continue; }
        if let Some(manifest) = snapshots(&folder).iter().find_map(|path| read_no_follow(&path.join("manifest.json"), MANIFEST_LIMIT).ok().and_then(|bytes| serde_json::from_slice::<Manifest>(&bytes).ok())) {
            if manifest.draft_id != id { continue; }
            output.push(DraftSummary { draft_id: id, name: manifest.name, target_status: target_status(manifest.target_path.as_deref(), manifest.base_disk_revision.as_deref()), target_path: manifest.target_path, snapshots: snapshots(&folder).len() });
        }
    }
    output.sort_by(|a,b| a.name.cmp(&b.name));
    Ok(output)
    }
}
#[tauri::command(async)]
pub fn read_draft(app: AppHandle, window: WebviewWindow, staging: State<'_, StagingStore>, claims: State<'_, DraftClaims>, draft_id: String, include_assets: bool) -> Result<DraftContent, String> {
    crate::require_workspace_window(&window)?;
    if !valid_id(&draft_id) { return Err("INVALID_DRAFT".into()); }
    // Reading it with its images is recovering it: the recovering tab writes it from now on.
    if include_assets { claims.claim(&draft_id, window.label(), window_alive(&app))?; }
    #[cfg(target_os = "macos")]
    let (manifest, markdown, assets) = macos_read::latest(&root(&app)?, &draft_id, include_assets)?;
    #[cfg(not(target_os = "macos"))]
    let (manifest, markdown, assets) = latest(&root(&app)?.join(&draft_id))?;
    if manifest.draft_id != draft_id { return Err("CORRUPT_DRAFT".into()); }
    // A preview shows the text and how many images there are; it does not read them (T100).
    let asset_count = manifest.assets.len();
    let assets = if include_assets { staging.put_all(assets)? } else { vec![] };
    Ok(DraftContent { draft_id, name: manifest.name, target_status: target_status(manifest.target_path.as_deref(), manifest.base_disk_revision.as_deref()), target_path: manifest.target_path, markdown, assets, asset_count })
}

#[cfg(target_os = "macos")]
mod macos_read {
    use super::*;
    use std::{ffi::{CString, OsStr, OsString}, io::Read, os::unix::ffi::OsStrExt};

    fn name(value: &OsStr) -> Result<CString, String> { CString::new(value.as_bytes()).map_err(|_| "CORRUPT_DRAFT".into()) }
    fn open_dir(parent: &File, entry: &CString) -> Result<File, String> {
        crate::fs::open_directory_at(parent, entry).map_err(|_| "CORRUPT_DRAFT".into())
    }
    fn root_dir(root: &Path) -> Result<File, String> {
        let parent = root.parent().ok_or("INVALID_PATH")?;
        let app_data = crate::fs::open_canonical_directory(parent, "OUT_OF_SCOPE")?;
        open_dir(&app_data, &name(root.file_name().ok_or("INVALID_PATH")?)?)
    }
    fn entries(folder: &File) -> Result<Vec<OsString>, String> {
        crate::fs::directory_entries(folder).map_err(|_| "CORRUPT_DRAFT".into())
    }
    fn read_file(parent: &File, entry: &CString, limit: u64) -> Result<Vec<u8>, String> {
        let mut file = crate::fs::open_file_at(parent, entry, 0).map_err(|_| "CORRUPT_DRAFT")?;
        let before = file.metadata().map_err(|_| "CORRUPT_DRAFT")?;
        if !before.is_file() || before.len() > limit { return Err("CORRUPT_DRAFT".into()); }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file).take(limit + 1).read_to_end(&mut bytes).map_err(|_| "CORRUPT_DRAFT")?;
        if bytes.len() as u64 > limit || file.metadata().map_err(|_| "CORRUPT_DRAFT")?.len() > limit { return Err("CORRUPT_DRAFT".into()); }
        Ok(bytes)
    }
    /// `with_assets` false reads and checks the text only: the caller wants a preview, and a restore reads the
    /// images, and checks each against its hash, when it happens.
    fn snapshot(snapshot: &File, with_assets: bool) -> Result<(Manifest, String, Vec<DraftAsset>), String> {
        let manifest = manifest_of(snapshot)?;
        let body = read_file(snapshot, &name(OsStr::new("document.md"))?, MAX_DOCUMENT as u64)?;
        if hash(&body) != manifest.body_revision { return Err("CORRUPT_DRAFT".into()); }
        let markdown = String::from_utf8(body).map_err(|_| "CORRUPT_DRAFT")?;
        let mut assets = Vec::new();
        if with_assets && !manifest.assets.is_empty() {
            // The text is what a draft protects. An image that is missing or damaged is left out, and the caller
            // tells the user, rather than giving up this snapshot for an older one with older text.
            let asset_dir = open_dir(snapshot, &name(OsStr::new("assets"))?).ok();
            for asset in &manifest.assets {
                if !asset.filename.starts_with("asset-") || asset.filename.contains('/') || asset.filename.contains('\\') || !markdown.contains(&asset.url) { continue; }
                let Some(asset_dir) = &asset_dir else { break };
                let Ok(bytes) = read_file(asset_dir, &name(OsStr::new(&asset.filename))?, MAX_IMAGE as u64) else { continue };
                if hash(&bytes) != asset.sha256 { continue; }
                assets.push(DraftAsset { url: asset.url.clone(), mime: asset.mime.clone(), bytes });
            }
        }
        Ok((manifest, markdown, assets))
    }
    fn latest_in(folder: &File, with_assets: bool) -> Result<(Manifest, String, Vec<DraftAsset>, usize), String> {
        let names = snapshot_names(folder)?;
        let count = names.len();
        for entry in names { if let Ok(dir) = open_dir(folder, &name(&entry)?) { if let Ok(record) = snapshot(&dir, with_assets) { return Ok((record.0, record.1, record.2, count)); } } }
        Err("CORRUPT_DRAFT".into())
    }
    fn manifest_of(snapshot: &File) -> Result<Manifest, String> {
        let bytes = read_file(snapshot, &name(OsStr::new("manifest.json"))?, MANIFEST_LIMIT)?;
        let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| "CORRUPT_DRAFT")?;
        if manifest.schema_version != 1 || !valid_id(&manifest.draft_id) || manifest.assets.len() > MAX_ASSETS { return Err("CORRUPT_DRAFT".into()); }
        Ok(manifest)
    }
    fn snapshot_names(folder: &File) -> Result<Vec<OsString>, String> {
        let mut names: Vec<_> = entries(folder)?.into_iter().filter(|name| name.to_str().is_some_and(|s| s.starts_with("snapshot-"))).collect();
        names.sort_by(|a,b| b.cmp(a));
        Ok(names)
    }
    /// Newest snapshot whose manifest parses. Bodies and images stay unread; `read_draft` verifies them.
    pub(super) fn latest_manifest(folder: &File) -> Result<(File, Manifest), String> {
        for entry in snapshot_names(folder)? {
            if let Ok(dir) = open_dir(folder, &name(&entry)?) { if let Ok(manifest) = manifest_of(&dir) { return Ok((dir, manifest)); } }
        }
        Err("CORRUPT_DRAFT".into())
    }
    pub(super) fn assets_dir(snapshot: &File) -> Result<File, String> { open_dir(snapshot, &name(OsStr::new("assets"))?) }
    pub(super) fn latest(root: &Path, id: &str, with_assets: bool) -> Result<(Manifest, String, Vec<DraftAsset>), String> {
        let root = root_dir(root)?;
        let folder = open_dir(&root, &name(OsStr::new(id))?)?;
        let (manifest, markdown, assets, _) = latest_in(&folder, with_assets)?;
        Ok((manifest, markdown, assets))
    }
    pub(super) fn list(root: &Path) -> Result<Vec<DraftSummary>, String> {
        let root = match root_dir(root) { Ok(dir) => dir, Err(code) if code == "CORRUPT_DRAFT" => return Ok(vec![]), Err(code) => return Err(code) };
        let mut output = Vec::new();
        for id in entries(&root)? {
            let Some(id) = id.to_str() else { continue };
            if !valid_id(id) { continue; }
            let Ok(folder) = open_dir(&root, &name(OsStr::new(id))?) else { continue };
            let count = snapshot_names(&folder).map(|names| names.len()).unwrap_or(0);
            if let Ok((_, manifest)) = latest_manifest(&folder) {
                if manifest.draft_id != id { continue; }
                output.push(DraftSummary { draft_id: id.into(), name: manifest.name, target_status: target_status(manifest.target_path.as_deref(), manifest.base_disk_revision.as_deref()), target_path: manifest.target_path, snapshots: count });
            }
        }
        output.sort_by(|a,b| a.name.cmp(&b.name));
        Ok(output)
    }
}
#[tauri::command(async)]
pub fn discard_draft(app: AppHandle, window: WebviewWindow, claims: State<'_, DraftClaims>, draft_id: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    if !valid_id(&draft_id) { return Err("INVALID_DRAFT".into()); }
    let _guard = DRAFT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    discard_at(&root(&app)?, &draft_id)?;
    claims.release(&draft_id);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos_tree {
    use super::*;
    use std::{ffi::{CString, OsStr, OsString}, os::{fd::AsRawFd, unix::ffi::OsStrExt}};
    /// A file name as the system calls take it.
    pub(super) fn name(value: &OsStr) -> Result<CString, String> { CString::new(value.as_bytes()).map_err(|_| "OUT_OF_SCOPE".into()) }
    fn open_dir(parent: &File, entry: &CString) -> Result<File, String> {
        crate::fs::open_directory_at(parent, entry).map_err(|_| "OUT_OF_SCOPE".into())
    }
    /// Whether `entry` of `parent` is still the directory that was opened, and not something put in its place since.
    pub(super) fn same_entry(parent: &File, entry: &CString, opened: &File) -> Result<(), String> {
        crate::fs::still_entry(parent, entry, opened, "COMMIT_UNCERTAIN")
    }
    pub(super) fn entries(folder: &File) -> Result<Vec<OsString>, String> {
        crate::fs::directory_entries(folder).map_err(|_| "IO_ERROR".into())
    }
    pub(super) fn remove_tree(folder: &File) -> Result<(), String> {
        for item in entries(folder)? {
            let entry = name(&item)?;
            let mut status: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::fstatat(folder.as_raw_fd(), entry.as_ptr(), &mut status, libc::AT_SYMLINK_NOFOLLOW) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
            if status.st_mode & libc::S_IFMT == libc::S_IFDIR {
                let child = open_dir(folder, &entry)?;
                remove_tree(&child)?;
                same_entry(folder, &entry, &child)?;
                if unsafe { libc::unlinkat(folder.as_raw_fd(), entry.as_ptr(), libc::AT_REMOVEDIR) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
            } else if unsafe { libc::unlinkat(folder.as_raw_fd(), entry.as_ptr(), 0) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
        }
        Ok(())
    }
    /// Keeps the newest `keep` snapshots and clears staging folders orphaned by a crash. Caller holds DRAFT_LOCK.
    pub(super) fn prune(folder: &File, keep: usize) -> Result<(), String> {
        let all = entries(folder)?;
        let mut snapshots: Vec<_> = all.iter().filter(|item| item.to_str().is_some_and(|text| text.starts_with("snapshot-"))).collect();
        snapshots.sort_by(|a, b| b.cmp(a));
        let stale = snapshots.into_iter().skip(keep).chain(all.iter().filter(|item| item.to_str().is_some_and(|text| text.starts_with(".staging-"))));
        for item in stale {
            let entry = name(item)?;
            let child = open_dir(folder, &entry)?;
            remove_tree(&child)?;
            same_entry(folder, &entry, &child)?;
            if unsafe { libc::unlinkat(folder.as_raw_fd(), entry.as_ptr(), libc::AT_REMOVEDIR) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
fn discard_at(root: &Path, draft_id: &str) -> Result<(), String> {
    let folder = root.join(draft_id);
    if !folder.exists() { return Ok(()); }
    if !fs::symlink_metadata(&folder).map_err(|_| "IO_ERROR")?.is_dir() { return Err("OUT_OF_SCOPE".into()); }
    fs::remove_dir_all(folder).map_err(|_| "IO_ERROR".into())
}

#[cfg(target_os = "macos")]
fn discard_at(root: &Path, draft_id: &str) -> Result<(), String> {
    use std::{ffi::{CString, OsStr}, os::fd::AsRawFd};
    use macos_tree::{name, same_entry};
    fn open_dir(parent: &File, entry: &CString) -> Result<File, String> {
        crate::fs::open_directory_at(parent, entry).map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "OUT_OF_SCOPE" }.into())
    }
    if !valid_id(draft_id) { return Err("INVALID_DRAFT".into()); }
    let parent = root.parent().ok_or("INVALID_PATH")?;
    let app_data = crate::fs::open_canonical_directory(parent, "OUT_OF_SCOPE")?;
    let root_name = name(root.file_name().ok_or("INVALID_PATH")?)?;
    let drafts = match open_dir(&app_data, &root_name) { Ok(dir) => dir, Err(code) if code == "NOT_FOUND" => return Ok(()), Err(code) => return Err(code) };
    let draft_name = name(OsStr::new(draft_id))?;
    let folder = match open_dir(&drafts, &draft_name) { Ok(dir) => dir, Err(code) if code == "NOT_FOUND" => return Ok(()), Err(code) => return Err(code) };
    macos_tree::remove_tree(&folder)?;
    same_entry(&drafts, &draft_name, &folder)?;
    same_entry(&app_data, &root_name, &drafts)?;
    crate::fs::still_at(parent, &app_data, "COMMIT_UNCERTAIN")?;
    if unsafe { libc::unlinkat(drafts.as_raw_fd(), draft_name.as_ptr(), libc::AT_REMOVEDIR) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
    drafts.sync_all().map_err(|_| "COMMIT_UNCERTAIN".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf { crate::fs::test_dir("draft") }
    #[test]
    fn recovers_previous_complete_snapshot_after_corruption() {
        let root = temp(); let id = "draft-12345678";
        let asset = DraftAsset { url: "blob:sample".into(), mime: "image/png".into(), bytes: b"image bytes".to_vec() };
        write_at(&root,id,"note",None,None,"one ![](blob:sample)",vec![asset.clone()]).unwrap();
        write_at(&root,id,"note",None,None,"two ![](blob:sample)",vec![asset]).unwrap();
        let newest = snapshots(&root.join(id))[0].clone();
        fs::write(newest.join("manifest.json"), b"broken").unwrap();
        let (_, body, assets) = latest(&root.join(id)).unwrap();
        assert_eq!(body, "one ![](blob:sample)"); assert_eq!(assets[0].bytes, b"image bytes");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_newest_snapshots_are_kept_and_staging_is_cleared() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root,id,"note",None,None,"first",vec![]).unwrap();
        fs::create_dir(root.join(id).join(".staging-interrupted")).unwrap();
        for index in 0..6 { write_at(&root,id,"note",None,None,&format!("body {index}"),vec![]).unwrap(); }
        assert_eq!(snapshots(&root.join(id)).len(), KEEP_SNAPSHOTS);
        assert!(!root.join(id).join(".staging-interrupted").exists());
        assert_eq!(latest(&root.join(id)).unwrap().1,"body 5");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn a_clock_set_back_never_makes_the_newest_snapshot_the_one_pruned() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root,id,"note",None,None,"first",vec![]).unwrap();
        // Snapshots written while the clock was far ahead, as when it is later set back.
        let ahead = snapshots(&root.join(id))[0].clone();
        for (index, name) in ["snapshot-09000000000000000001-0000000001", "snapshot-09000000000000000002-0000000001", "snapshot-09000000000000000003-0000000001"].iter().enumerate() {
            if index == 0 { fs::rename(&ahead, root.join(id).join(name)).unwrap(); } else { copy_dir(&root.join(id).join("snapshot-09000000000000000001-0000000001"), &root.join(id).join(name)); }
        }
        write_at(&root,id,"note",None,None,"after the clock went back",vec![]).unwrap();
        assert_eq!(snapshots(&root.join(id)).len(), KEEP_SNAPSHOTS);
        assert_eq!(latest(&root.join(id)).unwrap().1, "after the clock went back");
        #[cfg(target_os = "macos")]
        assert_eq!(macos_read::latest(&root, id, false).unwrap().1, "after the clock went back");
        assert_eq!(next_sequence(["snapshot-00000000000000000005-0000000001", ".staging-00000000000000000009-0000000002", "other"].into_iter(), 3), 10);
        assert_eq!(next_sequence(["snapshot-00000000000000000005-0000000001"].into_iter(), 50), 50);
        fs::remove_dir_all(root).unwrap();
    }
    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir(to).unwrap();
        for entry in fs::read_dir(from).unwrap().flatten() {
            if entry.file_type().unwrap().is_dir() { copy_dir(&entry.path(), &to.join(entry.file_name())); } else { fs::copy(entry.path(), to.join(entry.file_name())).unwrap(); }
        }
    }
    #[test]
    fn retained_images_are_reused_without_upload_and_survive_pruning() {
        let root = temp(); let id = "draft-12345678";
        let asset = DraftAsset { url: "blob:keep".into(), mime: "image/png".into(), bytes: b"image bytes".to_vec() };
        write_at(&root,id,"note",None,None,"v0 ![](blob:keep)",vec![asset]).unwrap();
        for index in 1..6 { write_retaining(&root,id,"note",None,None,&format!("v{index} ![](blob:keep)"),vec![],&["blob:keep".to_owned()]).unwrap(); }
        let (_, body, assets) = latest(&root.join(id)).unwrap();
        assert_eq!(body,"v5 ![](blob:keep)");
        assert_eq!((assets.len(), assets[0].bytes.as_slice(), assets[0].url.as_str()), (1, b"image bytes".as_slice(), "blob:keep"));
        assert_eq!(snapshots(&root.join(id)).len(), KEEP_SNAPSHOTS);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn retaining_an_unknown_image_asks_for_a_full_upload() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root,id,"note",None,None,"text ![](blob:new)",vec![]).unwrap();
        let result = write_retaining(&root,id,"note",None,None,"text ![](blob:new)",vec![],&["blob:new".to_owned()]);
        assert_eq!(result.err().as_deref(),Some("DRAFT_ASSET_MISSING"));
        assert_eq!(snapshots(&root.join(id)).len(),1);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn a_draft_keeps_only_as_many_disk_images_as_fit() {
        let disk = |count: usize| (0..count).map(|index| DiskAsset { url: format!("u{index}"), relative: format!("assets/{index}.png") }).collect::<Vec<_>>();
        let read = |len: usize| move |asset: &DiskAsset| Some(DraftAsset { url: asset.url.clone(), mime: "image/png".into(), bytes: vec![0; len] });
        // Many images: the draft is still written, with as many as the count allows.
        assert_eq!(disk_copies(read(10), disk(100), MAX_ASSETS - 4, 0).len(), MAX_ASSETS - 4);
        // Large images: no more than the byte limit, so restoring always fits in staging.
        let big = disk_copies(read(MAX_IMAGE), disk(30), MAX_ASSETS, 0);
        assert_eq!(big.len(), MAX_DISK_ASSET_BYTES / MAX_IMAGE);
        // One that cannot be read is skipped, not fatal.
        assert_eq!(disk_copies(|asset: &DiskAsset| (asset.url != "u1").then(|| DraftAsset { url: asset.url.clone(), mime: "image/png".into(), bytes: vec![1] }), disk(3), 64, 0).len(), 2);
    }

    #[test]
    fn a_draft_belongs_to_one_open_window() {
        let claims = DraftClaims::default();
        let alive = |label: &str| label != "gone";
        claims.claim("draft-0001", "main", alive).unwrap();
        claims.claim("draft-0001", "main", alive).unwrap();
        assert_eq!(claims.claim("draft-0001", "workspace-2", alive).err().as_deref(), Some("DRAFT_IN_USE"));
        assert!(claims.in_use("draft-0001", alive));
        claims.hand_over("draft-0001", "gone");
        assert!(!claims.in_use("draft-0001", alive), "a window that closed holds nothing");
        claims.claim("draft-0001", "workspace-2", alive).unwrap();
        claims.release_window("workspace-2");
        assert!(!claims.in_use("draft-0001", |_| true));
    }

    #[test]
    fn listing_reads_manifests_without_touching_bodies_or_images() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root,id,"note",None,None,"body",vec![]).unwrap();
        fs::write(snapshots(&root.join(id))[0].join("document.md"), b"corrupted body").unwrap();
        let listed = macos_read::list(&root).unwrap();
        assert_eq!((listed.len(), listed[0].snapshots), (1, 1));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn incomplete_staging_is_ignored_and_old_draft_survives() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root,id,"note",None,None,"original",vec![]).unwrap();
        fs::create_dir(root.join(id).join(".staging-interrupted")).unwrap();
        assert_eq!(latest(&root.join(id)).unwrap().1,"original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn external_new_version_is_detected_and_bad_ids_rejected() {
        let root = temp(); let target = root.join("file.md"); fs::write(&target,b"first").unwrap();
        let base = hash(b"first");
        assert_eq!(target_status(target.to_str(),Some(&base)),"same");
        fs::write(&target,b"second").unwrap();
        assert_eq!(target_status(target.to_str(),Some(&base)),"changed");
        assert!(!valid_id("../escape"));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn snapshot_reader_rejects_replaced_manifest_and_oversized_body() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root, id, "note", None, None, "safe", vec![]).unwrap();
        let snapshot = snapshots(&root.join(id)).remove(0);
        let manifest = snapshot.join("manifest.json");
        fs::rename(&manifest, root.join("outside.json")).unwrap();
        std::os::unix::fs::symlink(root.join("outside.json"), &manifest).unwrap();
        assert_eq!(read_snapshot(&snapshot).err().as_deref(), Some("CORRUPT_DRAFT"));
        fs::remove_file(manifest).unwrap();
        fs::rename(root.join("outside.json"), snapshot.join("manifest.json")).unwrap();
        fs::File::options().write(true).open(snapshot.join("document.md")).unwrap().set_len(MAX_DOCUMENT as u64 + 1).unwrap();
        assert_eq!(read_snapshot(&snapshot).err().as_deref(), Some("CORRUPT_DRAFT"));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn draft_writer_rejects_replaced_folder_without_touching_outside_or_old_snapshot() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root, id, "note", None, None, "old", vec![]).unwrap();
        let moved = root.join("old-folder");
        fs::rename(root.join(id), &moved).unwrap();
        let outside = root.join("outside");
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join(id)).unwrap();
        assert_eq!(write_at(&root, id, "note", None, None, "new", vec![]), Err("OUT_OF_SCOPE".into()));
        assert_eq!(latest(&moved).unwrap().1, "old");
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn discard_removes_only_selected_draft_and_rejects_linked_folder() {
        let root = temp(); let id = "draft-12345678";
        let outside = root.join("outside"); fs::create_dir(&outside).unwrap();
        fs::write(outside.join("keep.md"), b"keep").unwrap();
        write_at(&root, id, "note", None, None, "body", vec![]).unwrap();
        discard_at(&root, id).unwrap();
        assert!(!root.join(id).exists());
        assert_eq!(fs::read(outside.join("keep.md")).unwrap(), b"keep");
        std::os::unix::fs::symlink(&outside, root.join(id)).unwrap();
        assert_eq!(discard_at(&root, id), Err("OUT_OF_SCOPE".into()));
        assert_eq!(fs::read(outside.join("keep.md")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn a_preview_reads_the_text_without_the_images_and_a_restore_still_checks_them() {
        let root = temp(); let id = "draft-12345678";
        let asset = DraftAsset { url: "blob:sample".into(), mime: "image/png".into(), bytes: b"image bytes".to_vec() };
        write_at(&root, id, "note", None, None, "text ![](blob:sample)", vec![asset]).unwrap();
        let (manifest, body, assets) = macos_read::latest(&root, id, true).unwrap();
        assert_eq!((manifest.assets.len(), body.as_str(), assets.len()), (1, "text ![](blob:sample)", 1));
        assert_eq!(assets[0].bytes, b"image bytes");
        // With the image file damaged, the preview still shows the text and the count: it never opened the file.
        let stored = snapshots(&root.join(id))[0].join("assets").join(&manifest.assets[0].filename);
        fs::write(&stored, b"damaged").unwrap();
        let (manifest, body, assets) = macos_read::latest(&root, id, false).unwrap();
        assert_eq!((manifest.assets.len(), body.as_str(), assets.len()), (1, "text ![](blob:sample)", 0));
        // A restore checks every image against its hash and leaves the damaged one out, keeping the newest text
        // rather than falling back to an older snapshot; the count tells the caller one is missing.
        let (manifest, body, assets) = macos_read::latest(&root, id, true).unwrap();
        assert_eq!((manifest.assets.len(), body.as_str(), assets.len()), (1, "text ![](blob:sample)", 0));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn anchored_reader_skips_linked_snapshot_and_rejects_linked_draft_folder() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root, id, "note", None, None, "old", vec![]).unwrap();
        write_at(&root, id, "note", None, None, "new", vec![]).unwrap();
        let newest = snapshots(&root.join(id)).remove(0);
        let moved = root.join("moved-snapshot"); fs::rename(&newest, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &newest).unwrap();
        assert_eq!(macos_read::latest(&root, id, true).unwrap().1, "old");
        let folder = root.join(id); let moved_folder = root.join("moved-folder");
        fs::rename(&folder, &moved_folder).unwrap();
        std::os::unix::fs::symlink(&moved_folder, &folder).unwrap();
        assert!(macos_read::latest(&root, id, true).is_err());
        assert!(macos_read::list(&root).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
