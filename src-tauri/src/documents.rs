use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use image::{ImageFormat, ImageReader};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    path::{Component, Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use crate::fs::atomic_write;
use crate::fs::asset_directory::{AssetDirectory, PutResult};
use crate::markdown_images;

const MAX_DOCUMENT: u64 = 20 * 1024 * 1024;
const MAX_IMAGE: usize = 20 * 1024 * 1024;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
struct Grant {
    path: PathBuf,
    revision: String,
}

#[derive(Default)]
pub struct DocumentStore(Mutex<HashMap<String, Grant>>);

impl DocumentStore {
    fn grant(&self, token: &str) -> Result<Grant, String> {
        self.0.lock().map_err(|_| "IO_ERROR")?.get(token).cloned().ok_or("OUT_OF_SCOPE".into())
    }

    fn release(&self, token: &str) -> Result<(), String> {
        self.0.lock().map_err(|_| "IO_ERROR")?.remove(token);
        Ok(())
    }
}

pub(crate) fn draft_target(store: &DocumentStore, token: &str) -> Result<String, String> {
    Ok(store.grant(token)?.path.to_string_lossy().into_owned())
}

pub(crate) fn relocate_grants(store: &DocumentStore, old: &Path, new: &Path) -> Result<(), String> {
    let mut grants = store.0.lock().map_err(|_| "IO_ERROR")?;
    for grant in grants.values_mut() { if grant.path == old { grant.path = new.to_path_buf(); } }
    Ok(())
}

pub(crate) fn forget_grants(store: &DocumentStore, path: &Path) -> Result<(), String> {
    store.0.lock().map_err(|_| "IO_ERROR")?.retain(|_, grant| grant.path != path);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocument {
    token: String,
    name: String,
    markdown: String,
    revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUpload {
    url: String,
    bytes: Vec<u8>,
    mime: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    token: String,
    name: String,
    revision: String,
    markdown: String,
    asset_paths: HashMap<String, String>,
    asset_relocations: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStatus {
    kind: &'static str,
    revision: Option<String>,
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    require_main(window.label())
}

fn require_main(label: &str) -> Result<(), String> {
    if label == "main" { Ok(()) } else { Err("OUT_OF_SCOPE".into()) }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn filename(path: &Path) -> String {
    path.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_else(|| "未命名.md".into())
}

fn markdown_path(path: &Path) -> bool {
    path.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("md") || v.eq_ignore_ascii_case("markdown"))
}

pub(crate) fn validate_selected_file(path: &Path) -> Result<PathBuf, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "NOT_FOUND")?;
    let selected = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    let meta = fs::symlink_metadata(&selected).map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
    Ok(selected)
}

pub(crate) fn read_selected_image_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let path = validate_selected_file(path)?;
    #[cfg(target_os = "macos")]
    {
        use std::io::Read;
        let directory = open_parent_directory(path.parent().ok_or("INVALID_PATH")?)?;
        let image = open_child(&directory, path.file_name().ok_or("INVALID_PATH")?, 0)?;
        let meta = image.metadata().map_err(|_| "NOT_FOUND")?;
        if !meta.is_file() || meta.len() > MAX_IMAGE as u64 { return Err("IMAGE_TOO_LARGE".into()); }
        let mut bytes = Vec::new();
        image.take(MAX_IMAGE as u64 + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
        if bytes.len() > MAX_IMAGE { return Err("IMAGE_TOO_LARGE".into()); }
        Ok(bytes)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let meta = fs::symlink_metadata(&path).map_err(|_| "NOT_FOUND")?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_IMAGE as u64 { return Err("IMAGE_TOO_LARGE".into()); }
        fs::read(path).map_err(|_| "IO_ERROR".into())
    }
}

#[cfg(target_os = "macos")]
fn open_parent_directory(parent: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    if fs::canonicalize(parent).map_err(|_| "NOT_FOUND")? != parent { return Err("OUT_OF_SCOPE".into()); }
    OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(parent).map_err(|_| "OUT_OF_SCOPE".into())
}

#[cfg(target_os = "macos")]
fn open_child(directory: &fs::File, name: &std::ffi::OsStr, flags: libc::c_int) -> Result<fs::File, String> {
    use std::{ffi::CString, os::{fd::{AsRawFd, FromRawFd}, unix::ffi::OsStrExt}};
    let name = CString::new(name.as_bytes()).map_err(|_| "OUT_OF_SCOPE")?;
    let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | flags) };
    if fd < 0 {
        return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "OUT_OF_SCOPE" }.into());
    }
    Ok(unsafe { fs::File::from_raw_fd(fd) })
}

fn read_markdown(path: &Path) -> Result<(String, String), String> {
    if !markdown_path(path) { return Err("UNSUPPORTED_FILE_TYPE".into()); }
    let parent = path.parent().ok_or("INVALID_PATH")?;
    #[cfg(target_os = "macos")]
    let bytes = {
        use std::io::Read;
        let directory = open_parent_directory(parent)?;
        let file = open_child(&directory, path.file_name().ok_or("INVALID_PATH")?, 0)?;
        let meta = file.metadata().map_err(|_| "NOT_FOUND")?;
        if !meta.is_file() || meta.len() > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
        let mut bytes = Vec::new();
        file.take(MAX_DOCUMENT + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
        if bytes.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
        bytes
    };
    #[cfg(not(target_os = "macos"))]
    let bytes = {
    if fs::canonicalize(parent).map_err(|_| "NOT_FOUND")? != parent { return Err("OUT_OF_SCOPE".into()); }
    let meta = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
    if meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
    if !meta.is_file() || meta.len() > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    fs::read(path).map_err(|_| "IO_ERROR")?
    };
    let revision = digest(&bytes);
    let markdown = String::from_utf8(bytes).map_err(|_| "INVALID_ENCODING")?;
    Ok((markdown, revision))
}

pub(crate) fn open_granted_path(store: &DocumentStore, path: &Path) -> Result<OpenDocument, String> {
    let (markdown, revision) = read_markdown(path)?;
    let token = format!("doc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), Grant { path: path.to_path_buf(), revision: revision.clone() });
    Ok(OpenDocument { token, name: filename(path), markdown, revision })
}

#[tauri::command]
pub async fn choose_unsaved_action(app: AppHandle, window: WebviewWindow) -> Result<&'static str, String> {
    main_window(&window)?;
    let result = app.dialog().message("当前文档有未保存修改。")
        .title("关闭或切换文档")
        .buttons(MessageDialogButtons::YesNoCancelCustom("保存".into(), "放弃修改".into(), "取消".into()))
        .blocking_show_with_result();
    Ok(match result {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(ref label) if label == "保存" => "save",
        MessageDialogResult::Custom(ref label) if label == "放弃修改" => "discard",
        _ => "cancel",
    })
}

#[tauri::command]
pub async fn open_document(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>) -> Result<Option<OpenDocument>, String> {
    main_window(&window)?;
    let selected = app.dialog().file().add_filter("Markdown", &["md", "markdown"]).blocking_pick_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = validate_selected_file(&selected.into_path().map_err(|_| "INVALID_PATH")?)?;
    Ok(Some(open_granted_path(&store, &path)?))
}

#[tauri::command]
pub fn release_document(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<(), String> {
    main_window(&window)?;
    store.release(&token)
}

#[tauri::command]
pub fn check_document_revision(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<DiskStatus, String> {
    main_window(&window)?;
    let grant = store.grant(&token)?;
    disk_status(&grant)
}

fn disk_status(grant: &Grant) -> Result<DiskStatus, String> {
    if fs::canonicalize(grant.path.parent().ok_or("INVALID_PATH")?).map_err(|_| "OUT_OF_SCOPE")? != grant.path.parent().ok_or("INVALID_PATH")? { return Err("OUT_OF_SCOPE".into()); }
    let meta = match fs::symlink_metadata(&grant.path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(DiskStatus { kind: "deleted", revision: None }),
        Err(_) => return Err("IO_ERROR".into()),
    };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_DOCUMENT { return Ok(DiskStatus { kind: "changed", revision: None }); }
    let bytes = match fs::read(&grant.path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(DiskStatus { kind: "deleted", revision: None }),
        Err(_) => return Err("IO_ERROR".into()),
    };
    let revision = digest(&bytes);
    Ok(DiskStatus { kind: if revision == grant.revision { "same" } else { "changed" }, revision: Some(revision) })
}

#[tauri::command]
pub fn read_disk_version(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<String, String> {
    main_window(&window)?;
    let grant = store.grant(&token)?;
    read_markdown(&grant.path).map(|(markdown, _)| markdown)
}

#[tauri::command]
pub fn reload_document(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<OpenDocument, String> {
    main_window(&window)?;
    let grant = store.grant(&token)?;
    let (markdown, revision) = read_markdown(&grant.path)?;
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), Grant { path: grant.path.clone(), revision: revision.clone() });
    Ok(OpenDocument { token, name: filename(&grant.path), markdown, revision })
}

fn copy_assets_for_copy(source: &Path, target: &Path, markdown: &str) -> Result<(String, HashMap<String, String>), String> {
    let references = markdown_images::referenced_assets(markdown);
    if references.is_empty() { return Ok((markdown.into(), HashMap::new())); }
    let source_parent = source.parent().ok_or("INVALID_PATH")?;
    let target_parent = target.parent().ok_or("INVALID_PATH")?;
    let source_assets = AssetDirectory::open(source_parent, false)?;
    if source_parent == target_parent {
        for relative in &references {
            let path = markdown_images::local_asset_path(relative).ok_or("OUT_OF_SCOPE")?;
            source_assets.read(path.file_name().ok_or("OUT_OF_SCOPE")?)?.ok_or("ASSET_NOT_FOUND")?;
        }
        source_assets.verify_location()?;
        return Ok((markdown.into(), HashMap::new()));
    }
    let target_assets = AssetDirectory::open(target_parent, true)?;
    let mut replacements = HashMap::new();
    for relative in references {
        let path = markdown_images::local_asset_path(&relative).ok_or("OUT_OF_SCOPE")?;
        let name = path.file_name().ok_or("OUT_OF_SCOPE")?;
        let bytes = source_assets.read(name)?.ok_or("ASSET_NOT_FOUND")?;
        if target_assets.put(name, &bytes)? == PutResult::ExistingDifferent {
            let extension = Path::new(name).extension().and_then(|v| v.to_str()).unwrap_or("bin");
            let hash = digest(&bytes);
            let mut selected = None;
            for attempt in 0..100 {
                let filename = if attempt == 0 { format!("image-{}.{}", &hash[..24], extension) } else { format!("image-{}-{}.{}", &hash[..24], attempt, extension) };
                if target_assets.put(std::ffi::OsStr::new(&filename), &bytes)? != PutResult::ExistingDifferent {
                    selected = Some(filename); break;
                }
            }
            let filename = selected.ok_or("ASSET_WRITE_FAILED")?;
            replacements.insert(relative, format!("assets/{filename}"));
        }
    }
    source_assets.verify_location()?;
    target_assets.verify_location()?;
    Ok((markdown_images::rewrite_image_urls(markdown, &replacements)?, replacements))
}

#[tauri::command]
pub async fn save_conflict_copy(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, token: String, markdown: String, assets: Vec<AssetUpload>) -> Result<Option<String>, String> {
    main_window(&window)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    let grant = store.grant(&token)?;
    let selected = app.dialog().file().add_filter("Markdown", &["md"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "INVALID_PATH")?;
    if !markdown_path(&path) { return Err("UNSUPPORTED_FILE_TYPE".into()); }
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    if path == grant.path || path.exists() { return Err("TARGET_EXISTS".into()); }
    let (copied_markdown, _) = copy_assets_for_copy(&grant.path, &path, &markdown)?;
    let (persisted, _) = save_assets(&parent, &copied_markdown, assets)?;
    atomic_write::commit(&path, persisted.as_bytes(), None)?;
    Ok(Some(filename(&path)))
}

#[tauri::command]
pub async fn save_as_document(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, token: String, markdown: String, assets: Vec<AssetUpload>) -> Result<Option<SaveResult>, String> {
    main_window(&window)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    let grant = store.grant(&token)?;
    let selected = app.dialog().file().add_filter("Markdown", &["md", "markdown"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let selected = selected.into_path().map_err(|_| "INVALID_PATH")?;
    if !markdown_path(&selected) { return Err("UNSUPPORTED_FILE_TYPE".into()); }
    let parent = fs::canonicalize(selected.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(selected.file_name().ok_or("INVALID_PATH")?);
    if path == grant.path || path.exists() { return Err("TARGET_EXISTS".into()); }
    let _write_guard = SAVE_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let (copied_markdown, asset_relocations) = copy_assets_for_copy(&grant.path, &path, &markdown)?;
    let (persisted, asset_paths) = save_assets(&parent, &copied_markdown, assets)?;
    let revision = atomic_write::commit(&path, persisted.as_bytes(), None)?;
    let new_token = format!("doc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(new_token.clone(), Grant { path: path.clone(), revision: revision.clone() });
    Ok(Some(SaveResult { token: new_token, name: filename(&path), revision, markdown: persisted, asset_paths, asset_relocations }))
}

fn image_extension(bytes: &[u8], mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) => Some("png"),
        "image/jpeg" if bytes.starts_with(&[255, 216, 255]) => Some("jpg"),
        "image/gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => Some("gif"),
        "image/webp" if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" => Some("webp"),
        _ => None,
    }
}

pub(crate) fn validate_image(bytes: &[u8], mime: &str) -> Result<&'static str, String> {
    let extension = image_extension(bytes, mime).ok_or("INVALID_IMAGE")?;
    let format = match extension { "png" => ImageFormat::Png, "jpg" => ImageFormat::Jpeg, "gif" => ImageFormat::Gif, "webp" => ImageFormat::WebP, _ => return Err("INVALID_IMAGE".into()) };
    let dimensions = ImageReader::with_format(std::io::Cursor::new(bytes), format).into_dimensions().map_err(|_| "INVALID_IMAGE")?;
    if dimensions.0 == 0 || dimensions.1 == 0 || u64::from(dimensions.0) * u64::from(dimensions.1) > 40_000_000 { return Err("IMAGE_TOO_LARGE".into()); }
    ImageReader::with_format(std::io::Cursor::new(bytes), format).decode().map_err(|_| "INVALID_IMAGE")?;
    Ok(extension)
}

fn save_assets(parent: &Path, markdown: &str, assets: Vec<AssetUpload>) -> Result<(String, HashMap<String, String>), String> {
    let mut paths = HashMap::new();
    if assets.is_empty() { return Ok((markdown.to_owned(), paths)); }
    let mut prepared = Vec::new();
    for asset in assets {
        if !asset.url.starts_with("blob:") { return Err("INVALID_ASSET".into()); }
        if asset.bytes.is_empty() || asset.bytes.len() > MAX_IMAGE { return Err("IMAGE_TOO_LARGE".into()); }
        let ext = validate_image(&asset.bytes, &asset.mime)?;
        let hash = digest(&asset.bytes);
        let name = format!("image-{}.{}", &hash[..24], ext);
        let relative = format!("assets/{name}");
        paths.insert(asset.url.clone(), relative.clone());
        prepared.push((asset, name));
    }
    let output = markdown_images::rewrite_image_urls(markdown, &paths)?;
    let directory = AssetDirectory::open(parent, true)?;
    for (asset, name) in prepared {
        if directory.put(std::ffi::OsStr::new(&name), &asset.bytes)? == PutResult::ExistingDifferent {
            return Err("ASSET_WRITE_FAILED".into());
        }
    }
    directory.verify_location()?;
    Ok((output, paths))
}

#[tauri::command]
pub async fn save_document(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, DocumentStore>,
    token: Option<String>,
    expected_revision: Option<String>,
    markdown: String,
    assets: Vec<AssetUpload>,
) -> Result<Option<SaveResult>, String> {
    main_window(&window)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    let grant = match token.as_ref() {
        Some(id) => Some(store.grant(id)?),
        None => None,
    };
    let path = if let Some(grant) = &grant {
        grant.path.clone()
    } else {
        let selected = app.dialog().file().add_filter("Markdown", &["md"]).blocking_save_file();
        let Some(selected) = selected else { return Ok(None); };
        selected.into_path().map_err(|_| "INVALID_PATH")?
    };
    if !markdown_path(&path) { return Err("UNSUPPORTED_FILE_TYPE".into()); }
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    if let Some(grant) = &grant { if parent != grant.path.parent().ok_or("INVALID_PATH")? { return Err("OUT_OF_SCOPE".into()); } }
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    let _write_guard = SAVE_LOCK.lock().map_err(|_| "IO_ERROR")?;
    match &grant {
        Some(grant) => {
            if expected_revision.as_deref() != Some(grant.revision.as_str()) { return Err("STALE_OPERATION".into()); }
            let (_, disk_revision) = read_markdown(&path)?;
            if disk_revision != grant.revision { return Err("CONFLICT".into()); }
        }
        None if path.exists() => return Err("TARGET_EXISTS".into()),
        _ => {}
    }
    let (persisted, asset_paths) = save_assets(&parent, &markdown, assets)?;
    let bytes = persisted.as_bytes();
    let revision = atomic_write::commit(&path, bytes, grant.as_ref().map(|item| item.revision.as_str()))?;
    let token = token.unwrap_or_else(|| format!("doc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), Grant { path: path.clone(), revision: revision.clone() });
    Ok(Some(SaveResult { token, name: filename(&path), revision, markdown: persisted, asset_paths, asset_relocations: HashMap::new() }))
}

#[tauri::command]
pub fn read_asset(window: WebviewWindow, store: State<'_, DocumentStore>, token: String, relative: String) -> Result<Vec<u8>, String> {
    main_window(&window)?;
    let grant = store.grant(&token)?;
    read_scoped_asset(&grant, &relative)
}

fn read_scoped_asset(grant: &Grant, relative: &str) -> Result<Vec<u8>, String> {
    let relative = Path::new(relative);
    let mut parts = relative.components();
    if !matches!(parts.next(), Some(Component::Normal(v)) if v == "assets") { return Err("OUT_OF_SCOPE".into()); }
    let Some(Component::Normal(name)) = parts.next() else { return Err("OUT_OF_SCOPE".into()); };
    if parts.next().is_some() { return Err("OUT_OF_SCOPE".into()); }
    let parent = grant.path.parent().ok_or("INVALID_PATH")?;
    #[cfg(target_os = "macos")]
    return read_asset_from_directory(parent, name);
    #[cfg(not(target_os = "macos"))]
    {
    let root = fs::canonicalize(parent.join("assets")).map_err(|_| "NOT_FOUND")?;
    if !root.starts_with(parent) { return Err("OUT_OF_SCOPE".into()); }
    let target = fs::canonicalize(parent.join(relative)).map_err(|_| "NOT_FOUND")?;
    if !target.starts_with(&root) { return Err("OUT_OF_SCOPE".into()); }
    let meta = fs::metadata(&target).map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.len() as usize > MAX_IMAGE { return Err("IMAGE_TOO_LARGE".into()); }
    fs::read(target).map_err(|_| "IO_ERROR".into())
    }
}

#[cfg(target_os = "macos")]
fn read_asset_from_directory(parent: &Path, name: &std::ffi::OsStr) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let directory = open_parent_directory(parent)?;
    let assets = open_child(&directory, std::ffi::OsStr::new("assets"), libc::O_DIRECTORY)?;
    let image = open_child(&assets, name, 0)?;
    let meta = image.metadata().map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.len() > MAX_IMAGE as u64 { return Err("IMAGE_TOO_LARGE".into()); }
    let mut bytes = Vec::new();
    image.take(MAX_IMAGE as u64 + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    if bytes.len() > MAX_IMAGE { return Err("IMAGE_TOO_LARGE".into()); }
    Ok(bytes)
}

#[tauri::command]
pub async fn export_html(app: AppHandle, window: WebviewWindow, html: String) -> Result<Option<String>, String> {
    main_window(&window)?;
    if html.len() > 100 * 1024 * 1024 { return Err("EXPORT_TOO_LARGE".into()); }
    let selected = app.dialog().file().add_filter("HTML", &["html"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "INVALID_PATH")?;
    if !path.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("html")) {
        return Err("UNSUPPORTED_FILE_TYPE".into());
    }
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    if path.exists() { return Err("TARGET_EXISTS".into()); }
    atomic_write::commit(&path, html.as_bytes(), None)?;
    Ok(Some(filename(&path)))
}

#[tauri::command]
pub async fn export_source_markdown(app: AppHandle, window: WebviewWindow, markdown: String) -> Result<Option<String>, String> {
    main_window(&window)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    let selected = app.dialog().file().add_filter("Markdown", &["md"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "INVALID_PATH")?;
    if !markdown_path(&path) { return Err("UNSUPPORTED_FILE_TYPE".into()); }
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    if path.exists() { return Err("TARGET_EXISTS".into()); }
    atomic_write::commit(&path, markdown.as_bytes(), None)?;
    Ok(Some(filename(&path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mino-doc-test-{}-{}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn image_is_written_as_separate_asset_and_reference_is_replaced() {
        let dir = sample_dir();
        let png = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png").to_vec();
        let (markdown, paths) = save_assets(&dir, "before ![shot](blob:temporary) after", vec![AssetUpload {
            url: "blob:temporary".into(), mime: "image/png".into(), bytes: png.clone(),
        }]).unwrap();
        assert!(!markdown.contains("blob:"));
        let relative = paths.get("blob:temporary").unwrap();
        assert_eq!(fs::read(dir.join(relative)).unwrap(), png);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_image_never_produces_a_reference() {
        let dir = sample_dir();
        let result = save_assets(&dir, "![shot](blob:temporary)", vec![AssetUpload {
            url: "blob:temporary".into(), mime: "image/png".into(), bytes: b"not a PNG".to_vec(),
        }]);
        assert!(result.is_err());
        assert!(!dir.join("assets").exists() || fs::read_dir(dir.join("assets")).unwrap().next().is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_forged_document_token_and_non_main_window_are_rejected() {
        let store = DocumentStore::default();
        assert!(matches!(store.grant("forged"), Err(code) if code == "OUT_OF_SCOPE"));
        assert!(require_main("main").is_ok());
        assert!(matches!(require_main("print"), Err(code) if code == "OUT_OF_SCOPE"));
    }

    #[test]
    fn external_change_and_delete_are_detected_from_content() {
        let dir = sample_dir();
        let path = dir.join("entry.md");
        fs::write(&path, b"first").unwrap();
        let grant = Grant { path: path.clone(), revision: digest(b"first") };
        assert_eq!(disk_status(&grant).unwrap().kind, "same");
        fs::write(&path, b"second").unwrap();
        assert_eq!(disk_status(&grant).unwrap().kind, "changed");
        fs::remove_file(&path).unwrap();
        assert_eq!(disk_status(&grant).unwrap().kind, "deleted");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_as_assets_are_copied_before_new_markdown_is_committed() {
        let dir = sample_dir();
        let source_dir = dir.join("source");
        let target_dir = dir.join("target");
        fs::create_dir_all(source_dir.join("assets")).unwrap();
        fs::create_dir(&target_dir).unwrap();
        let png = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png");
        fs::write(source_dir.join("assets/image.png"), png).unwrap();
        let source = source_dir.join("note.md");
        fs::write(&source, b"![shot](assets/image.png)").unwrap();
        let target = target_dir.join("copy.md");
        copy_assets_for_copy(&source, &target, "![shot](assets/image.png)").unwrap();
        assert_eq!(fs::read(target_dir.join("assets/image.png")).unwrap(), png);
        atomic_write::commit(&target, b"![shot](assets/image.png)", None).unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"![shot](assets/image.png)");
        assert_eq!(fs::read(&target).unwrap(), b"![shot](assets/image.png)");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_as_renames_colliding_asset_without_changing_code_text() {
        let dir = sample_dir();
        let source_dir = dir.join("source"); let target_dir = dir.join("target");
        fs::create_dir_all(source_dir.join("assets")).unwrap();
        fs::create_dir_all(target_dir.join("assets")).unwrap();
        let source = source_dir.join("note.md"); let target = target_dir.join("copy.md");
        let png = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png");
        fs::write(source_dir.join("assets/image.png"), png).unwrap();
        fs::write(target_dir.join("assets/image.png"), b"other bytes").unwrap();
        let (result, _) = copy_assets_for_copy(&source, &target, "`assets/image.png` ![x](assets/image.png)").unwrap();
        assert!(result.starts_with("`assets/image.png` ![x](assets/image-"));
        assert_eq!(fs::read(target_dir.join("assets/image.png")).unwrap(), b"other bytes");
        let new_path = markdown_images::referenced_assets(&result).pop().unwrap();
        assert_eq!(fs::read(target_dir.join(new_path)).unwrap(), png);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_as_copies_encoded_reference_image_and_rewrites_its_definition_on_collision() {
        let dir = sample_dir();
        let source_dir = dir.join("source"); let target_dir = dir.join("target");
        fs::create_dir_all(source_dir.join("assets")).unwrap();
        fs::create_dir_all(target_dir.join("assets")).unwrap();
        let original_name = "中文 图片#%(a).png";
        let png = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png");
        fs::write(source_dir.join("assets").join(original_name), png).unwrap();
        fs::write(target_dir.join("assets").join(original_name), b"different image").unwrap();
        let markdown = "[link][ref] ![图][pic]\n\n[ref]: https://example.org/path\n[pic]: ./assets/中文%20图片%23%25%28a%29.png \"标题\"";
        let (copied, moved) = copy_assets_for_copy(&source_dir.join("note.md"), &target_dir.join("copy.md"), markdown).unwrap();
        assert!(copied.contains("[ref]: https://example.org/path"));
        assert!(copied.contains("[pic]: assets/image-"));
        let destination = moved.get("./assets/中文%20图片%23%25%28a%29.png").unwrap();
        assert_eq!(fs::read(target_dir.join(destination)).unwrap(), png);
        assert_eq!(fs::read(target_dir.join("assets").join(original_name)).unwrap(), b"different image");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn symlinked_document_or_parent_is_out_of_scope() {
        let dir = sample_dir();
        let real = dir.join("real"); fs::create_dir(&real).unwrap();
        fs::write(real.join("note.md"), b"safe").unwrap();
        std::os::unix::fs::symlink(real.join("note.md"), dir.join("link.md")).unwrap();
        assert_eq!(validate_selected_file(&real.join("note.md")).unwrap(), fs::canonicalize(real.join("note.md")).unwrap());
        assert_eq!(validate_selected_file(&dir.join("link.md")).err().as_deref(), Some("OUT_OF_SCOPE"));
        assert_eq!(read_markdown(&dir.join("link.md")).err().as_deref(), Some("OUT_OF_SCOPE"));
        std::os::unix::fs::symlink(&real, dir.join("parent-link")).unwrap();
        assert_eq!(validate_selected_file(&dir.join("parent-link/note.md")).unwrap(), fs::canonicalize(real.join("note.md")).unwrap());
        assert_eq!(read_markdown(&dir.join("parent-link/note.md")).err().as_deref(), Some("OUT_OF_SCOPE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn markdown_reader_rejects_oversized_and_invalid_utf8_files() {
        let dir = sample_dir();
        let path = dir.join("note.md");
        fs::write(&path, vec![b'a'; 11 * 1024 * 1024]).unwrap();
        assert_eq!(read_markdown(&path).unwrap().0.len(), 11 * 1024 * 1024);
        let large = fs::File::create(&path).unwrap();
        large.set_len(MAX_DOCUMENT + 1).unwrap();
        assert_eq!(read_markdown(&path).err().as_deref(), Some("DOCUMENT_TOO_LARGE"));
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert_eq!(read_markdown(&path).err().as_deref(), Some("INVALID_ENCODING"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_image_reader_uses_current_regular_file_without_following_links() {
        let dir = sample_dir();
        let image = dir.join("picture.png");
        let png = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png");
        fs::write(&image, png).unwrap();
        assert_eq!(read_selected_image_bytes(&image).unwrap(), png);
        fs::remove_file(&image).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.png"), &image).unwrap();
        assert_eq!(read_selected_image_bytes(&image).err().as_deref(), Some("OUT_OF_SCOPE"));
        fs::remove_file(&image).unwrap();
        let large = fs::File::create(&image).unwrap();
        large.set_len(MAX_IMAGE as u64 + 1).unwrap();
        assert_eq!(read_selected_image_bytes(&image).err().as_deref(), Some("IMAGE_TOO_LARGE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn asset_reader_rejects_traversal_and_symlink_but_reads_local_image() {
        let dir = sample_dir();
        fs::create_dir(dir.join("assets")).unwrap();
        fs::write(dir.join("assets/good.png"), b"safe bytes").unwrap();
        fs::write(dir.join("outside.png"), b"outside").unwrap();
        std::os::unix::fs::symlink(dir.join("outside.png"), dir.join("assets/link.png")).unwrap();
        let grant = Grant { path: dir.join("note.md"), revision: String::new() };
        assert_eq!(read_scoped_asset(&grant,"assets/good.png").unwrap(),b"safe bytes");
        assert_eq!(read_scoped_asset(&grant,"assets/../outside.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        assert_eq!(read_scoped_asset(&grant,"assets/nested/good.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        assert_eq!(read_scoped_asset(&grant,"assets/link.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        let large = fs::File::create(dir.join("assets/large.png")).unwrap();
        large.set_len(MAX_IMAGE as u64 + 1).unwrap();
        assert_eq!(read_scoped_asset(&grant,"assets/large.png").err().as_deref(),Some("IMAGE_TOO_LARGE"));
        fs::rename(dir.join("assets"), dir.join("real-assets")).unwrap();
        std::os::unix::fs::symlink(dir.join("real-assets"), dir.join("assets")).unwrap();
        assert_eq!(read_scoped_asset(&grant,"assets/good.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn released_document_grant_cannot_read_old_path() {
        let dir = sample_dir();
        let path = dir.join("note.md");
        fs::write(&path, b"# note\n").unwrap();
        let store = DocumentStore::default();
        let opened = open_granted_path(&store, &path).unwrap();
        assert_eq!(draft_target(&store, &opened.token).unwrap(), path.to_string_lossy());
        store.release(&opened.token).unwrap();
        assert_eq!(draft_target(&store, &opened.token), Err("OUT_OF_SCOPE".into()));
        fs::remove_dir_all(dir).unwrap();
    }
}
