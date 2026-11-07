use crate::documents::{DocumentStore, draft_target};
use crate::fs::bounded_file::read_no_follow;
use crate::fs::app_data::ensure_dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const MAX_DOCUMENT: usize = 20 * 1024 * 1024;
const MAX_IMAGE: usize = 20 * 1024 * 1024;
const MAX_ASSETS: usize = 64;
static NEXT_SNAPSHOT: AtomicU64 = AtomicU64::new(1);
static DRAFT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftAsset { pub url: String, pub mime: String, pub bytes: Vec<u8> }
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
pub struct DraftContent { draft_id: String, name: String, markdown: String, assets: Vec<DraftAssetOut>, target_path: Option<String>, target_status: &'static str }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftAssetOut { url: String, mime: String, bytes: Vec<u8> }

fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn valid_id(id: &str) -> bool { id.len() >= 8 && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') }
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|_| "IO_ERROR")?;
    let path = ensure_dir(&app_data)?.join("drafts");
    if let Ok(meta) = fs::symlink_metadata(&path) { if meta.file_type().is_symlink() || !meta.is_dir() { return Err("OUT_OF_SCOPE".into()); } }
    Ok(path)
}
fn require_main(window: &WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("OUT_OF_SCOPE".into()) } }
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
fn read_snapshot(path: &Path) -> Result<(Manifest, String, Vec<DraftAssetOut>), String> {
    let manifest_bytes = read_no_follow(&path.join("manifest.json"), 64 * 1024).map_err(|_| "CORRUPT_DRAFT")?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|_| "CORRUPT_DRAFT")?;
    if manifest.schema_version != 1 || !valid_id(&manifest.draft_id) || manifest.assets.len() > MAX_ASSETS { return Err("CORRUPT_DRAFT".into()); }
    let body = read_no_follow(&path.join("document.md"), MAX_DOCUMENT as u64).map_err(|_| "CORRUPT_DRAFT")?;
    if hash(&body) != manifest.body_revision { return Err("CORRUPT_DRAFT".into()); }
    let markdown = String::from_utf8(body).map_err(|_| "CORRUPT_DRAFT")?;
    let mut assets = Vec::new();
    for asset in &manifest.assets {
        if !asset.filename.starts_with("asset-") || asset.filename.contains('/') || asset.filename.contains('\\') || !markdown.contains(&asset.url) { return Err("CORRUPT_DRAFT".into()); }
        let bytes = read_no_follow(&path.join("assets").join(&asset.filename), MAX_IMAGE as u64).map_err(|_| "CORRUPT_DRAFT")?;
        if hash(&bytes) != asset.sha256 { return Err("CORRUPT_DRAFT".into()); }
        assets.push(DraftAssetOut { url: asset.url.clone(), mime: asset.mime.clone(), bytes });
    }
    Ok((manifest, markdown, assets))
}
#[cfg(any(test, not(target_os = "macos")))]
fn latest(folder: &Path) -> Result<(Manifest, String, Vec<DraftAssetOut>), String> {
    for snapshot in snapshots(folder) { if let Ok(record) = read_snapshot(&snapshot) { return Ok(record); } }
    Err("CORRUPT_DRAFT".into())
}
fn write_at(root: &Path, draft_id: &str, name: &str, target_path: Option<String>, base_disk_revision: Option<String>, markdown: &str, assets: Vec<DraftAsset>) -> Result<(), String> {
    if !valid_id(draft_id) || name.len() > 256 || markdown.len() > MAX_DOCUMENT || assets.len() > MAX_ASSETS { return Err("INVALID_DRAFT".into()); }
    let _guard = DRAFT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    #[cfg(target_os = "macos")]
    return write_at_macos(root, draft_id, name, target_path, base_disk_revision, markdown, assets);
    #[cfg(not(target_os = "macos"))]
    {
    fs::create_dir_all(root).map_err(|_| "IO_ERROR")?;
    let folder = root.join(draft_id);
    if folder.exists() && fs::symlink_metadata(&folder).map_err(|_| "OUT_OF_SCOPE")?.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
    fs::create_dir_all(&folder).map_err(|_| "IO_ERROR")?;
    let snapshot_id = format!("{:020}-{:010}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "IO_ERROR")?.as_millis(), NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed));
    let staging = folder.join(format!(".staging-{snapshot_id}"));
    fs::create_dir(&staging).map_err(|_| "IO_ERROR")?;
    let result = (|| {
        let assets_dir = staging.join("assets");
        fs::create_dir(&assets_dir).map_err(|_| "IO_ERROR")?;
        let mut records = Vec::new();
        for (index, asset) in assets.iter().enumerate() {
            if asset.url.len() > 1024 || asset.url.is_empty() || !markdown.contains(&asset.url) || asset.bytes.is_empty() || asset.bytes.len() > MAX_IMAGE || !matches!(asset.mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp") { return Err("INVALID_ASSET".into()); }
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
    result
    }
}

#[cfg(target_os = "macos")]
fn write_at_macos(root: &Path, draft_id: &str, name: &str, target_path: Option<String>, base_disk_revision: Option<String>, markdown: &str, assets: Vec<DraftAsset>) -> Result<(), String> {
    use std::{ffi::{CString, OsStr}, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::{MetadataExt, OpenOptionsExt}}}};
    fn entry(name: &OsStr) -> Result<CString, String> { CString::new(name.as_bytes()).map_err(|_| "OUT_OF_SCOPE".into()) }
    fn make_dir(parent: &File, name: &CString) -> Result<File, String> {
        let made = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
        if made < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists { return Err("IO_ERROR".into()); }
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
        if fd < 0 { return Err("OUT_OF_SCOPE".into()); }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    fn write_file(parent: &File, name: &CString, bytes: &[u8]) -> Result<(), String> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
        if fd < 0 { return Err("IO_ERROR".into()); }
        let mut file = unsafe { File::from_raw_fd(fd) };
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "IO_ERROR".into())
    }
    fn identity(parent: &File, name: &CString, opened: &File) -> Result<(), String> {
        let mut current: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe { libc::fstatat(parent.as_raw_fd(), name.as_ptr(), &mut current, libc::AT_SYMLINK_NOFOLLOW) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
        let held = opened.metadata().map_err(|_| "COMMIT_UNCERTAIN")?;
        if current.st_dev as u64 != held.dev() || current.st_ino as u64 != held.ino() { return Err("COMMIT_UNCERTAIN".into()); }
        Ok(())
    }
    let mut records = Vec::with_capacity(assets.len());
    for (index, asset) in assets.iter().enumerate() {
        if asset.url.len() > 1024 || asset.url.is_empty() || !markdown.contains(&asset.url) || asset.bytes.is_empty() || asset.bytes.len() > MAX_IMAGE || !matches!(asset.mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp") { return Err("INVALID_ASSET".into()); }
        let sha256 = hash(&asset.bytes);
        records.push(AssetRecord { url: asset.url.clone(), mime: asset.mime.clone(), filename: format!("asset-{index:03}-{}.bin", &sha256[..24]), sha256 });
    }
    let manifest = Manifest { schema_version: 1, draft_id: draft_id.into(), name: name.into(), target_path, base_disk_revision, body_revision: hash(markdown.as_bytes()), assets: records };
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|_| "IO_ERROR")?;
    let root_parent = root.parent().ok_or("INVALID_PATH")?;
    if fs::canonicalize(root_parent).map_err(|_| "OUT_OF_SCOPE")? != root_parent { return Err("OUT_OF_SCOPE".into()); }
    let app_data = OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(root_parent).map_err(|_| "OUT_OF_SCOPE")?;
    let root_name = entry(root.file_name().ok_or("INVALID_PATH")?)?;
    let root_dir = make_dir(&app_data, &root_name)?;
    let draft_name = entry(OsStr::new(draft_id))?;
    let folder = make_dir(&root_dir, &draft_name)?;
    let snapshot_id = format!("{:020}-{:010}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "IO_ERROR")?.as_millis(), NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed));
    let staging_name = entry(OsStr::new(&format!(".staging-{snapshot_id}")))?;
    let published_name = entry(OsStr::new(&format!("snapshot-{snapshot_id}")))?;
    if unsafe { libc::mkdirat(folder.as_raw_fd(), staging_name.as_ptr(), 0o700) } < 0 { return Err("IO_ERROR".into()); }
    let staging_fd = unsafe { libc::openat(folder.as_raw_fd(), staging_name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
    if staging_fd < 0 { return Err("OUT_OF_SCOPE".into()); }
    let staging = unsafe { File::from_raw_fd(staging_fd) };
    let asset_dir = make_dir(&staging, &entry(OsStr::new("assets"))?)?;
    for (asset, record) in assets.iter().zip(&manifest.assets) { write_file(&asset_dir, &entry(OsStr::new(&record.filename))?, &asset.bytes)?; }
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
    let root_parent_meta = fs::symlink_metadata(root_parent).map_err(|_| "COMMIT_UNCERTAIN")?;
    let app_data_meta = app_data.metadata().map_err(|_| "COMMIT_UNCERTAIN")?;
    if !root_parent_meta.is_dir() || root_parent_meta.dev() != app_data_meta.dev() || root_parent_meta.ino() != app_data_meta.ino() { return Err("COMMIT_UNCERTAIN".into()); }
    Ok(())
}

#[tauri::command]
pub fn write_draft(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, draft_id: String, name: String, token: Option<String>, base_disk_revision: Option<String>, markdown: String, assets: Vec<DraftAsset>) -> Result<(), String> {
    require_main(&window)?;
    let target = match token { Some(token) => Some(draft_target(&store, &token)?), None => None };
    write_at(&root(&app)?, &draft_id, &name, target, base_disk_revision, &markdown, assets)
}
#[tauri::command]
pub fn list_drafts(app: AppHandle, window: WebviewWindow) -> Result<Vec<DraftSummary>, String> {
    require_main(&window)?;
    let root = root(&app)?;
    #[cfg(target_os = "macos")]
    return macos_read::list(&root);
    #[cfg(not(target_os = "macos"))]
    {
    let Ok(entries) = fs::read_dir(root) else { return Ok(vec![]) };
    let mut output = Vec::new();
    for entry in entries.flatten() {
        let folder = entry.path();
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) || !fs::symlink_metadata(&folder).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) { continue; }
        if let Ok((manifest, _, _)) = latest(&folder) {
            if manifest.draft_id != id { continue; }
            output.push(DraftSummary { draft_id: id, name: manifest.name, target_status: target_status(manifest.target_path.as_deref(), manifest.base_disk_revision.as_deref()), target_path: manifest.target_path, snapshots: snapshots(&folder).len() });
        }
    }
    output.sort_by(|a,b| a.name.cmp(&b.name));
    Ok(output)
    }
}
#[tauri::command]
pub fn read_draft(app: AppHandle, window: WebviewWindow, draft_id: String) -> Result<DraftContent, String> {
    require_main(&window)?;
    if !valid_id(&draft_id) { return Err("INVALID_DRAFT".into()); }
    #[cfg(target_os = "macos")]
    let (manifest, markdown, assets) = macos_read::latest(&root(&app)?, &draft_id)?;
    #[cfg(not(target_os = "macos"))]
    let (manifest, markdown, assets) = latest(&root(&app)?.join(&draft_id))?;
    if manifest.draft_id != draft_id { return Err("CORRUPT_DRAFT".into()); }
    Ok(DraftContent { draft_id, name: manifest.name, target_status: target_status(manifest.target_path.as_deref(), manifest.base_disk_revision.as_deref()), target_path: manifest.target_path, markdown, assets })
}

#[cfg(target_os = "macos")]
mod macos_read {
    use super::*;
    use std::{ffi::{CStr, CString, OsStr, OsString}, io::Read, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::{OsStrExt, OsStringExt}, fs::OpenOptionsExt}}};

    fn name(value: &OsStr) -> Result<CString, String> { CString::new(value.as_bytes()).map_err(|_| "CORRUPT_DRAFT".into()) }
    fn open_dir(parent: &File, entry: &CString) -> Result<File, String> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), entry.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
        if fd < 0 { return Err("CORRUPT_DRAFT".into()); }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    fn root_dir(root: &Path) -> Result<File, String> {
        let parent = root.parent().ok_or("INVALID_PATH")?;
        if fs::canonicalize(parent).map_err(|_| "OUT_OF_SCOPE")? != parent { return Err("OUT_OF_SCOPE".into()); }
        let app_data = OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(parent).map_err(|_| "OUT_OF_SCOPE")?;
        open_dir(&app_data, &name(root.file_name().ok_or("INVALID_PATH")?)?)
    }
    fn entries(folder: &File) -> Result<Vec<OsString>, String> {
        let duplicate = unsafe { libc::dup(folder.as_raw_fd()) };
        if duplicate < 0 { return Err("CORRUPT_DRAFT".into()); }
        let stream = unsafe { libc::fdopendir(duplicate) };
        if stream.is_null() { unsafe { libc::close(duplicate); } return Err("CORRUPT_DRAFT".into()); }
        let mut names = Vec::new();
        loop {
            unsafe { *libc::__error() = 0; }
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                let failed = unsafe { *libc::__error() != 0 };
                unsafe { libc::closedir(stream); }
                return if failed { Err("CORRUPT_DRAFT".into()) } else { Ok(names) };
            }
            let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
            if bytes != b"." && bytes != b".." { names.push(OsString::from_vec(bytes.to_vec())); }
        }
    }
    fn read_file(parent: &File, entry: &CString, limit: u64) -> Result<Vec<u8>, String> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), entry.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
        if fd < 0 { return Err("CORRUPT_DRAFT".into()); }
        let mut file = unsafe { File::from_raw_fd(fd) };
        let before = file.metadata().map_err(|_| "CORRUPT_DRAFT")?;
        if !before.is_file() || before.len() > limit { return Err("CORRUPT_DRAFT".into()); }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file).take(limit + 1).read_to_end(&mut bytes).map_err(|_| "CORRUPT_DRAFT")?;
        if bytes.len() as u64 > limit || file.metadata().map_err(|_| "CORRUPT_DRAFT")?.len() > limit { return Err("CORRUPT_DRAFT".into()); }
        Ok(bytes)
    }
    fn snapshot(snapshot: &File) -> Result<(Manifest, String, Vec<DraftAssetOut>), String> {
        let manifest_bytes = read_file(snapshot, &name(OsStr::new("manifest.json"))?, 64 * 1024)?;
        let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|_| "CORRUPT_DRAFT")?;
        if manifest.schema_version != 1 || !valid_id(&manifest.draft_id) || manifest.assets.len() > MAX_ASSETS { return Err("CORRUPT_DRAFT".into()); }
        let body = read_file(snapshot, &name(OsStr::new("document.md"))?, MAX_DOCUMENT as u64)?;
        if hash(&body) != manifest.body_revision { return Err("CORRUPT_DRAFT".into()); }
        let markdown = String::from_utf8(body).map_err(|_| "CORRUPT_DRAFT")?;
        let mut assets = Vec::new();
        if !manifest.assets.is_empty() {
            let asset_dir = open_dir(snapshot, &name(OsStr::new("assets"))?)?;
            for asset in &manifest.assets {
                if !asset.filename.starts_with("asset-") || asset.filename.contains('/') || asset.filename.contains('\\') || !markdown.contains(&asset.url) { return Err("CORRUPT_DRAFT".into()); }
                let bytes = read_file(&asset_dir, &name(OsStr::new(&asset.filename))?, MAX_IMAGE as u64)?;
                if hash(&bytes) != asset.sha256 { return Err("CORRUPT_DRAFT".into()); }
                assets.push(DraftAssetOut { url: asset.url.clone(), mime: asset.mime.clone(), bytes });
            }
        }
        Ok((manifest, markdown, assets))
    }
    fn latest_in(folder: &File) -> Result<(Manifest, String, Vec<DraftAssetOut>, usize), String> {
        let mut names: Vec<_> = entries(folder)?.into_iter().filter(|name| name.to_str().is_some_and(|s| s.starts_with("snapshot-"))).collect();
        names.sort_by(|a,b| b.cmp(a));
        let count = names.len();
        for entry in names { if let Ok(dir) = open_dir(folder, &name(&entry)?) { if let Ok(record) = snapshot(&dir) { return Ok((record.0, record.1, record.2, count)); } } }
        Err("CORRUPT_DRAFT".into())
    }
    pub(super) fn latest(root: &Path, id: &str) -> Result<(Manifest, String, Vec<DraftAssetOut>), String> {
        let root = root_dir(root)?;
        let folder = open_dir(&root, &name(OsStr::new(id))?)?;
        let (manifest, markdown, assets, _) = latest_in(&folder)?;
        Ok((manifest, markdown, assets))
    }
    pub(super) fn list(root: &Path) -> Result<Vec<DraftSummary>, String> {
        let root = match root_dir(root) { Ok(dir) => dir, Err(code) if code == "CORRUPT_DRAFT" => return Ok(vec![]), Err(code) => return Err(code) };
        let mut output = Vec::new();
        for id in entries(&root)? {
            let Some(id) = id.to_str() else { continue };
            if !valid_id(id) { continue; }
            let Ok(folder) = open_dir(&root, &name(OsStr::new(id))?) else { continue };
            if let Ok((manifest, _, _, count)) = latest_in(&folder) {
                if manifest.draft_id != id { continue; }
                output.push(DraftSummary { draft_id: id.into(), name: manifest.name, target_status: target_status(manifest.target_path.as_deref(), manifest.base_disk_revision.as_deref()), target_path: manifest.target_path, snapshots: count });
            }
        }
        output.sort_by(|a,b| a.name.cmp(&b.name));
        Ok(output)
    }
}
#[tauri::command]
pub fn discard_draft(app: AppHandle, window: WebviewWindow, draft_id: String) -> Result<(), String> {
    require_main(&window)?;
    if !valid_id(&draft_id) { return Err("INVALID_DRAFT".into()); }
    let _guard = DRAFT_LOCK.lock().map_err(|_| "IO_ERROR")?;
    discard_at(&root(&app)?, &draft_id)
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
    use std::{ffi::{CStr, CString, OsStr, OsString}, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::{OsStrExt, OsStringExt}, fs::{MetadataExt, OpenOptionsExt}}}};
    fn name(value: &OsStr) -> Result<CString, String> { CString::new(value.as_bytes()).map_err(|_| "OUT_OF_SCOPE".into()) }
    fn open_dir(parent: &File, entry: &CString) -> Result<File, String> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), entry.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
        if fd < 0 { return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "OUT_OF_SCOPE" }.into()); }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    fn same_entry(parent: &File, entry: &CString, opened: &File) -> Result<(), String> {
        let mut current: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe { libc::fstatat(parent.as_raw_fd(), entry.as_ptr(), &mut current, libc::AT_SYMLINK_NOFOLLOW) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
        let held = opened.metadata().map_err(|_| "COMMIT_UNCERTAIN")?;
        if current.st_dev as u64 != held.dev() || current.st_ino as u64 != held.ino() { return Err("COMMIT_UNCERTAIN".into()); }
        Ok(())
    }
    fn entries(folder: &File) -> Result<Vec<OsString>, String> {
        let duplicate = unsafe { libc::dup(folder.as_raw_fd()) };
        if duplicate < 0 { return Err("IO_ERROR".into()); }
        let stream = unsafe { libc::fdopendir(duplicate) };
        if stream.is_null() { unsafe { libc::close(duplicate); } return Err("IO_ERROR".into()); }
        let mut names = Vec::new();
        loop {
            unsafe { *libc::__error() = 0; }
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                let failed = unsafe { *libc::__error() != 0 };
                unsafe { libc::closedir(stream); }
                return if failed { Err("IO_ERROR".into()) } else { Ok(names) };
            }
            let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
            if bytes != b"." && bytes != b".." { names.push(OsString::from_vec(bytes.to_vec())); }
        }
    }
    fn remove_tree(folder: &File) -> Result<(), String> {
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
    if !valid_id(draft_id) { return Err("INVALID_DRAFT".into()); }
    let parent = root.parent().ok_or("INVALID_PATH")?;
    if fs::canonicalize(parent).map_err(|_| "OUT_OF_SCOPE")? != parent { return Err("OUT_OF_SCOPE".into()); }
    let app_data = OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(parent).map_err(|_| "OUT_OF_SCOPE")?;
    let root_name = name(root.file_name().ok_or("INVALID_PATH")?)?;
    let drafts = match open_dir(&app_data, &root_name) { Ok(dir) => dir, Err(code) if code == "NOT_FOUND" => return Ok(()), Err(code) => return Err(code) };
    let draft_name = name(OsStr::new(draft_id))?;
    let folder = match open_dir(&drafts, &draft_name) { Ok(dir) => dir, Err(code) if code == "NOT_FOUND" => return Ok(()), Err(code) => return Err(code) };
    remove_tree(&folder)?;
    same_entry(&drafts, &draft_name, &folder)?;
    same_entry(&app_data, &root_name, &drafts)?;
    let held = app_data.metadata().map_err(|_| "COMMIT_UNCERTAIN")?;
    let current = fs::symlink_metadata(parent).map_err(|_| "COMMIT_UNCERTAIN")?;
    if held.dev() != current.dev() || held.ino() != current.ino() { return Err("COMMIT_UNCERTAIN".into()); }
    if unsafe { libc::unlinkat(drafts.as_raw_fd(), draft_name.as_ptr(), libc::AT_REMOVEDIR) } < 0 { return Err("COMMIT_UNCERTAIN".into()); }
    drafts.sync_all().map_err(|_| "COMMIT_UNCERTAIN".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf { let p = std::env::temp_dir().join(format!("mino-draft-{}-{}", std::process::id(), NEXT_SNAPSHOT.fetch_add(1, Ordering::Relaxed))); fs::create_dir(&p).unwrap(); fs::canonicalize(p).unwrap() }
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
    fn anchored_reader_skips_linked_snapshot_and_rejects_linked_draft_folder() {
        let root = temp(); let id = "draft-12345678";
        write_at(&root, id, "note", None, None, "old", vec![]).unwrap();
        write_at(&root, id, "note", None, None, "new", vec![]).unwrap();
        let newest = snapshots(&root.join(id)).remove(0);
        let moved = root.join("moved-snapshot"); fs::rename(&newest, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &newest).unwrap();
        assert_eq!(macos_read::latest(&root, id).unwrap().1, "old");
        let folder = root.join(id); let moved_folder = root.join("moved-folder");
        fs::rename(&folder, &moved_folder).unwrap();
        std::os::unix::fs::symlink(&moved_folder, &folder).unwrap();
        assert!(macos_read::latest(&root, id).is_err());
        assert!(macos_read::list(&root).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
