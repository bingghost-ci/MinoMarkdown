use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use image::{ImageFormat, ImageReader};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex},
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
use crate::fs::atomic_write;
use crate::fs::asset_directory::{AssetDirectory, PutResult};
use crate::markdown_images;
use crate::staging::{StagedAsset, StagingStore};
use crate::file_kinds::{self, DocumentKind};
use crate::text_encoding::{self, TextEncoding};

const MAX_DOCUMENT: u64 = file_kinds::MAX_TEXT_BYTES;
/// The most one `read_document_range` call returns.
const MAX_RANGE: u64 = 8 * 1024 * 1024;
const MAX_IMAGE: usize = 20 * 1024 * 1024;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileStamp { modified: Option<std::time::SystemTime>, len: u64, inode: u64 }

impl FileStamp {
    fn of(meta: &fs::Metadata) -> Self {
        #[cfg(unix)]
        let inode = std::os::unix::fs::MetadataExt::ino(meta);
        #[cfg(not(unix))]
        let inode = 0;
        Self { modified: meta.modified().ok(), len: meta.len(), inode }
    }
}

#[derive(Clone)]
struct Grant {
    path: PathBuf,
    revision: String,
    /// Unguessable capability for `mino-asset:` URLs; document text can't derive it from a token.
    asset_key: String,
    /// Stat taken before the bytes behind `revision` were read; an unchanged stamp skips re-hashing.
    stamp: Option<FileStamp>,
    /// The last content found on disk that differs from `revision`, with its stat. While a tab holds unsaved
    /// edits it keeps asking, and the changed file is not read and hashed again until it changes once more (T100).
    observed: Option<(FileStamp, String)>,
    kind: DocumentKind,
    /// How the text was stored, so a save writes it back the same way (T82).
    encoding: TextEncoding,
}

fn random_key() -> Result<String, String> {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    fs::File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)).map_err(|_| "IO_ERROR")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn stamp_of(path: &Path) -> Option<FileStamp> { fs::symlink_metadata(path).ok().map(|meta| FileStamp::of(&meta)) }

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

/// Whether two granted paths are one file: the same path, or the same inode reached by another spelling
/// (APFS ignores case, so `Notes.md` and `notes.md` can be one file).
fn same_file(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    if a == b { return true; }
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// Which of `candidates` (the tokens of the window's tabs) holds the same file as `token`, which was just
/// opened, so opening a file a tab already shows brings that tab to the front instead of a second copy.
#[tauri::command(async)]
pub fn find_open_document(window: WebviewWindow, store: State<'_, DocumentStore>, token: String, candidates: Vec<String>) -> Result<Option<String>, String> {
    crate::require_workspace_window(&window)?;
    let target = store.grant(&token)?.path;
    Ok(candidates.into_iter().find(|candidate| *candidate != token && store.grant(candidate).is_ok_and(|grant| same_file(&grant.path, &target))))
}

pub(crate) fn draft_target(store: &DocumentStore, token: &str) -> Result<String, String> {
    Ok(store.grant(token)?.path.to_string_lossy().into_owned())
}

/// The file behind a token and what it was opened as, for records kept per file.
pub(crate) fn document_identity(store: &DocumentStore, token: &str) -> Result<(PathBuf, DocumentKind), String> {
    let grant = store.grant(token)?;
    Ok((grant.path, grant.kind))
}

/// Where `path` is after `old` was renamed to `new`: itself, or a file inside a renamed folder. `None` when it is elsewhere.
pub(crate) fn moved_path(path: &Path, old: &Path, new: &Path) -> Option<PathBuf> {
    path.strip_prefix(old).ok().map(|rest| if rest.as_os_str().is_empty() { new.to_path_buf() } else { new.join(rest) })
}

/// Held for reading while an open document is saved and for writing while files are renamed, moved or removed, so
/// a save never writes to a path that is changing under it.
pub(crate) static PATHS: std::sync::RwLock<()> = std::sync::RwLock::new(());

/// Renames or moves `old` with `change`, which returns where it went, and points the grant of the file, or of every
/// file inside a folder, to the new place (T105, T109). The grants stay locked from before the change on disk until
/// they are updated, so a disk check or a read of an open document never sees the file missing in between.
pub(crate) fn relocating(store: &DocumentStore, old: &Path, change: impl FnOnce() -> Result<PathBuf, String>) -> Result<PathBuf, String> {
    let _paths = PATHS.write().map_err(|_| "IO_ERROR")?;
    let mut grants = store.0.lock().map_err(|_| "IO_ERROR")?;
    let new = change()?;
    for grant in grants.values_mut() { if let Some(moved) = moved_path(&grant.path, old, &new) { grant.path = moved; } }
    Ok(new)
}

/// The file a document token was granted, checked to still be that regular file and not a link (T105).
pub(crate) fn granted_file(store: &DocumentStore, token: &str) -> Result<PathBuf, String> {
    let path = store.grant(token)?.path;
    if validate_selected_file(&path)? != path { return Err("OUT_OF_SCOPE".into()); }
    Ok(path)
}

/// Removes `path` with `change` (to the Trash) and ends the grants at or inside it, while no save runs (T109).
pub(crate) fn removing(store: &DocumentStore, path: &Path, change: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let _paths = PATHS.write().map_err(|_| "IO_ERROR")?;
    change()?;
    forget_grants(store, path)
}

/// Ends the grants of `path` and, when it is a folder, of every file inside it.
pub(crate) fn forget_grants(store: &DocumentStore, path: &Path) -> Result<(), String> {
    store.0.lock().map_err(|_| "IO_ERROR")?.retain(|_, grant| !grant.path.starts_with(path));
    Ok(())
}

/// The document tokens granted for `path` or for a file inside it: the tabs a folder's removal affects.
pub(crate) fn grants_within(store: &DocumentStore, path: &Path) -> Result<Vec<String>, String> {
    Ok(store.0.lock().map_err(|_| "IO_ERROR")?.iter().filter(|(_, grant)| grant.path.starts_with(path)).map(|(token, _)| token.clone()).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocument {
    token: String,
    name: String,
    markdown: String,
    revision: String,
    asset_key: String,
    /// `markdown`, `text`, `code` or `pdf`. A PDF has no text here; its bytes are read in ranges.
    kind: &'static str,
    encoding: String,
    size: u64,
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
    /// The text as written, when saving changed it: pasted images now point at their files. Otherwise it is
    /// the text the window sent, and sending megabytes of it back with every save would be wasted (T100).
    #[serde(skip_serializing_if = "Option::is_none")]
    markdown: Option<String>,
    asset_paths: HashMap<String, String>,
    asset_relocations: HashMap<String, String>,
    asset_key: String,
    kind: &'static str,
    encoding: String,
}

fn staged_uploads(staging: &StagingStore, assets: Vec<StagedAsset>) -> Result<Vec<AssetUpload>, String> {
    assets.into_iter().map(|asset| Ok(AssetUpload { bytes: staging.take(&asset.staged)?, url: asset.url, mime: asset.mime })).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStatus {
    kind: &'static str,
    revision: Option<String>,
}

fn digest(bytes: &[u8]) -> String {
    crate::fs::sha256_hex(bytes)
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
    if fs::canonicalize(parent).map_err(|_| "NOT_FOUND")? != parent { return Err("OUT_OF_SCOPE".into()); }
    crate::fs::open_directory(parent)
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

/// Opens a granted file for reading without following a link at its last component.
fn open_no_follow(path: &Path) -> Result<fs::File, String> {
    let parent = path.parent().ok_or("INVALID_PATH")?;
    #[cfg(target_os = "macos")]
    {
        let directory = open_parent_directory(parent)?;
        open_child(&directory, path.file_name().ok_or("INVALID_PATH")?, 0)
    }
    #[cfg(not(target_os = "macos"))]
    {
        if fs::canonicalize(parent).map_err(|_| "NOT_FOUND")? != parent { return Err("OUT_OF_SCOPE".into()); }
        let meta = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
        if meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
        fs::File::open(path).map_err(|_| "IO_ERROR".into())
    }
}

/// SHA-256 of a file read in pieces, with its length and its first bytes. A file longer than `limit` is refused.
fn digest_stream(mut file: impl std::io::Read, limit: u64) -> Result<(String, u64, Vec<u8>), String> {
    let mut hasher = Sha256::new();
    let mut head = Vec::new();
    let mut total = 0u64;
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "IO_ERROR")?;
        if count == 0 { break; }
        total += count as u64;
        if total > limit { return Err("DOCUMENT_TOO_LARGE".into()); }
        if head.len() < 1024 { head.extend_from_slice(&buffer[..count.min(1024 - head.len())]); }
        hasher.update(&buffer[..count]);
    }
    Ok((crate::fs::hex(&hasher.finalize()), total, head))
}

struct Loaded { text: String, revision: String, stamp: Option<FileStamp>, kind: DocumentKind, encoding: TextEncoding, size: u64 }

fn read_markdown(path: &Path) -> Result<(String, String), String> {
    read_document(path).map(|loaded| (loaded.text, loaded.revision))
}

/// Reads a supported file as what its extension says it is, and checks that the content agrees (T81).
fn read_document(path: &Path) -> Result<Loaded, String> {
    use std::io::Read;
    let kind = DocumentKind::of(path).ok_or("UNSUPPORTED_FILE_TYPE")?;
    let limit = kind.max_bytes();
    let file = open_no_follow(path)?;
    let meta = file.metadata().map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.len() > limit { return Err("DOCUMENT_TOO_LARGE".into()); }
    let stamp = Some(FileStamp::of(&meta));
    if kind == DocumentKind::Pdf {
        let (revision, size, head) = digest_stream(file, limit)?;
        if !file_kinds::looks_like_pdf(&head) { return Err("UNSUPPORTED_FORMAT".into()); }
        return Ok(Loaded { text: String::new(), revision, stamp, kind, encoding: TextEncoding::UTF8, size });
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    if bytes.len() as u64 > limit { return Err("DOCUMENT_TOO_LARGE".into()); }
    let revision = digest(&bytes);
    let size = bytes.len() as u64;
    let decoded = text_encoding::decode(&bytes)?;
    Ok(Loaded { text: decoded.text, revision, stamp, kind, encoding: decoded.encoding, size })
}

/// The revision of the file as it is on disk now, without decoding it.
fn disk_revision(path: &Path, kind: DocumentKind) -> Result<String, String> {
    let file = open_no_follow(path)?;
    let meta = file.metadata().map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() { return Err("OUT_OF_SCOPE".into()); }
    Ok(digest_stream(file, kind.max_bytes())?.0)
}

fn opened(token: String, path: &Path, loaded: Loaded, asset_key: String) -> OpenDocument {
    OpenDocument { token, name: filename(path), markdown: loaded.text, revision: loaded.revision, asset_key, kind: loaded.kind.as_str(), encoding: loaded.encoding.label(), size: loaded.size }
}

pub(crate) fn open_granted_path(store: &DocumentStore, path: &Path) -> Result<OpenDocument, String> {
    let loaded = read_document(path)?;
    let token = format!("doc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let asset_key = random_key()?;
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), Grant { observed: None, path: path.to_path_buf(), revision: loaded.revision.clone(), stamp: loaded.stamp, asset_key: asset_key.clone(), kind: loaded.kind, encoding: loaded.encoding });
    Ok(opened(token, path, loaded, asset_key))
}

/// One piece of a granted PDF (T86). The grant, the file's identity and the range are checked on every call,
/// so the webview never holds a path and never reads a file that replaced the one the user opened.
fn read_range(grant: &Grant, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    if grant.kind != DocumentKind::Pdf { return Err("OUT_OF_SCOPE".into()); }
    if length == 0 || length > MAX_RANGE { return Err("INVALID_RANGE".into()); }
    let file = open_no_follow(&grant.path)?;
    let meta = file.metadata().map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() { return Err("OUT_OF_SCOPE".into()); }
    if grant.stamp.is_some_and(|stamp| stamp != FileStamp::of(&meta)) { return Err("CHANGED".into()); }
    if offset >= meta.len() { return Err("INVALID_RANGE".into()); }
    let mut bytes = vec![0u8; length.min(meta.len() - offset) as usize];
    std::os::unix::fs::FileExt::read_exact_at(&file, &mut bytes, offset).map_err(|_| "IO_ERROR")?;
    Ok(bytes)
}

#[tauri::command(async)]
pub fn read_document_range(window: WebviewWindow, store: State<'_, DocumentStore>, token: String, offset: u64, length: u64) -> Result<tauri::ipc::Response, String> {
    crate::require_workspace_window(&window)?;
    read_range(&store.grant(&token)?, offset, length).map(tauri::ipc::Response::new)
}

/// File types offered when saving: a text or source file keeps its extension or becomes Markdown.
fn save_dialog(app: &AppHandle, kind: DocumentKind, original: Option<&Path>, markdown_extensions: &[&str]) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    match (kind, original.and_then(file_kinds::extension)) {
        (DocumentKind::Text, Some(extension)) => dialog.add_filter("Text", &[extension.as_str()]).add_filter("Markdown", &["md"]),
        (DocumentKind::Code, Some(extension)) => dialog.add_filter("Source", &[extension.as_str()]).add_filter("Markdown", &["md"]),
        _ => dialog.add_filter("Markdown", markdown_extensions),
    }
}

/// What a file saved from a document of `source` kind may be: the same kind, or Markdown.
fn target_kind(path: &Path, source: DocumentKind) -> Result<DocumentKind, String> {
    let kind = DocumentKind::of(path).filter(|kind| kind.is_text()).ok_or("UNSUPPORTED_FILE_TYPE")?;
    if kind == source || kind == DocumentKind::Markdown { Ok(kind) } else { Err("UNSUPPORTED_FILE_TYPE".into()) }
}

/// A file name the frontend may suggest for a first save: one supported text file name, no path.
fn text_file_name(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= 120 && !name.starts_with('.') && file_kinds::is_text_path(Path::new(name))
        && !name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
}

#[tauri::command]
pub async fn choose_unsaved_action(app: AppHandle, window: WebviewWindow) -> Result<&'static str, String> {
    crate::require_workspace_window(&window)?;
    let english = crate::settings::initial_language(&app) == "en-US";
    let result = app.dialog().message(if english { "This document has unsaved changes." } else { "当前文档有未保存修改。" })
        .title(if english { "Close or Switch Document" } else { "关闭或切换文档" })
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            if english { "Save" } else { "保存" }.into(),
            if english { "Discard Changes" } else { "放弃修改" }.into(),
            if english { "Cancel" } else { "取消" }.into(),
        ))
        .blocking_show_with_result();
    Ok(match result {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(ref label) if label == "保存" => "save",
        MessageDialogResult::Custom(ref label) if label == "Save" => "save",
        MessageDialogResult::Custom(ref label) if label == "放弃修改" => "discard",
        MessageDialogResult::Custom(ref label) if label == "Discard Changes" => "discard",
        _ => "cancel",
    })
}

#[tauri::command]
pub async fn open_document(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>) -> Result<Option<OpenDocument>, String> {
    crate::require_workspace_window(&window)?;
    // Every supported kind first, so the panel shows them all at once; the narrower filters follow.
    let all: Vec<&str> = [file_kinds::MARKDOWN_EXTENSIONS, file_kinds::TEXT_EXTENSIONS, file_kinds::CODE_EXTENSIONS, file_kinds::PDF_EXTENSIONS].concat();
    let english = crate::settings::initial_language(&app) == "en-US";
    let selected = app.dialog().file()
        .add_filter(if english { "All Supported Documents" } else { "所有支持的文档" }, &all)
        .add_filter("Markdown", file_kinds::MARKDOWN_EXTENSIONS)
        .add_filter(if english { "Plain Text" } else { "纯文本" }, file_kinds::TEXT_EXTENSIONS)
        .add_filter("PDF", file_kinds::PDF_EXTENSIONS)
        .blocking_pick_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = validate_selected_file(&selected.into_path().map_err(|_| "INVALID_PATH")?)?;
    Ok(Some(open_granted_path(&store, &path)?))
}

#[tauri::command]
pub fn release_document(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    store.release(&token)
}

#[tauri::command(async)]
pub fn check_document_revision(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<DiskStatus, String> {
    crate::require_workspace_window(&window)?;
    let grant = store.grant(&token)?;
    let (status, stamp) = disk_status(&grant)?;
    // A touched-but-identical file must not be re-hashed on every poll.
    if status.kind == "same" && stamp != grant.stamp {
        if let Some(current) = store.0.lock().map_err(|_| "IO_ERROR")?.get_mut(&token) {
            if current.revision == grant.revision { current.stamp = stamp; }
        }
    }
    // Nor a changed one. This only answers the next poll; a save still reads and compares the file itself.
    let seen = match (status.kind, &status.revision, stamp) { ("changed", Some(revision), Some(stamp)) => Some((stamp, revision.clone())), _ => None };
    if seen != grant.observed {
        if let Some(current) = store.0.lock().map_err(|_| "IO_ERROR")?.get_mut(&token) {
            if current.revision == grant.revision { current.observed = seen; }
        }
    }
    Ok(status)
}

fn disk_status(grant: &Grant) -> Result<(DiskStatus, Option<FileStamp>), String> {
    if fs::canonicalize(grant.path.parent().ok_or("INVALID_PATH")?).map_err(|_| "OUT_OF_SCOPE")? != grant.path.parent().ok_or("INVALID_PATH")? { return Err("OUT_OF_SCOPE".into()); }
    let meta = match fs::symlink_metadata(&grant.path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((DiskStatus { kind: "deleted", revision: None }, None)),
        Err(_) => return Err("IO_ERROR".into()),
    };
    let stamp = Some(FileStamp::of(&meta));
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > grant.kind.max_bytes() { return Ok((DiskStatus { kind: "changed", revision: None }, stamp)); }
    if grant.stamp.is_some() && stamp == grant.stamp { return Ok((DiskStatus { kind: "same", revision: Some(grant.revision.clone()) }, stamp)); }
    if let Some((seen, revision)) = &grant.observed {
        if stamp.as_ref() == Some(seen) { return Ok((DiskStatus { kind: "changed", revision: Some(revision.clone()) }, stamp)); }
    }
    let file = match fs::File::open(&grant.path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((DiskStatus { kind: "deleted", revision: None }, None)),
        Err(_) => return Err("IO_ERROR".into()),
    };
    let revision = match digest_stream(file, grant.kind.max_bytes()) {
        Ok((revision, _, _)) => revision,
        Err(code) if code == "DOCUMENT_TOO_LARGE" => return Ok((DiskStatus { kind: "changed", revision: None }, stamp)),
        Err(code) => return Err(code),
    };
    Ok((DiskStatus { kind: if revision == grant.revision { "same" } else { "changed" }, revision: Some(revision) }, stamp))
}

#[tauri::command(async)]
pub fn read_disk_version(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<String, String> {
    crate::require_workspace_window(&window)?;
    let grant = store.grant(&token)?;
    if !grant.kind.is_text() { return Err("READ_ONLY".into()); }
    read_markdown(&grant.path).map(|(markdown, _)| markdown)
}

#[tauri::command(async)]
pub fn reload_document(window: WebviewWindow, store: State<'_, DocumentStore>, token: String) -> Result<OpenDocument, String> {
    crate::require_workspace_window(&window)?;
    let grant = store.grant(&token)?;
    let loaded = read_document(&grant.path)?;
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), Grant { observed: None, path: grant.path.clone(), revision: loaded.revision.clone(), stamp: loaded.stamp, asset_key: grant.asset_key.clone(), kind: loaded.kind, encoding: loaded.encoding });
    Ok(opened(token, &grant.path, loaded, grant.asset_key))
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

/// The images a Markdown file took along when it was moved to another folder (T109).
pub(crate) struct CarriedAssets { source: AssetDirectory, target: AssetDirectory, source_parent: PathBuf, names: Vec<OsString>, created: Vec<OsString> }

/// How many Markdown files beside a moved one are read to see whether they still use its images.
const SIBLING_LIMIT: usize = 2_000;

/// Copies the `assets/` images a Markdown file references into `assets/` of the folder it is moving to, so they
/// still show after the move. The document is not rewritten: a name the target already holds with other bytes
/// stops the move (`ASSET_CONFLICT`) before anything is written. A reference that was already broken is skipped.
pub(crate) fn carry_assets(document: &Path, target_parent: &Path) -> Result<Option<CarriedAssets>, String> {
    if DocumentKind::of(document) != Some(DocumentKind::Markdown) { return Ok(None); }
    let references = markdown_images::referenced_assets(&read_document(document)?.text);
    if references.is_empty() { return Ok(None); }
    let source_parent = document.parent().ok_or("INVALID_PATH")?;
    let source = match AssetDirectory::open(source_parent, false) { Err(code) if code == "ASSET_NOT_FOUND" => return Ok(None), other => other? };
    let mut images = Vec::new();
    for relative in references {
        let path = markdown_images::local_asset_path(&relative).ok_or("OUT_OF_SCOPE")?;
        let name = path.file_name().ok_or("OUT_OF_SCOPE")?.to_os_string();
        if let Some(bytes) = source.read(&name)? { images.push((name, bytes)); }
    }
    if images.is_empty() { return Ok(None); }
    match AssetDirectory::open(target_parent, false) {
        Ok(existing) => for (name, bytes) in &images {
            if existing.read(name)?.is_some_and(|other| &other != bytes) { return Err("ASSET_CONFLICT".into()); }
        },
        Err(code) if code == "ASSET_NOT_FOUND" => {}
        Err(code) => return Err(code),
    }
    let target = AssetDirectory::open(target_parent, true)?;
    let mut carried = CarriedAssets { source, target, source_parent: source_parent.to_path_buf(), names: Vec::new(), created: Vec::new() };
    for (name, bytes) in images {
        let put = carried.target.put(&name, &bytes);
        match put {
            Ok(PutResult::Created) => carried.created.push(name.clone()),
            Ok(PutResult::ExistingSame) => {}
            Ok(PutResult::ExistingDifferent) | Err(_) => { carried.undo(); return Err(put.err().unwrap_or_else(|| "ASSET_CONFLICT".into())); }
        }
        carried.names.push(name);
    }
    if let Err(code) = carried.source.verify_location().and_then(|_| carried.target.verify_location()) { carried.undo(); return Err(code); }
    Ok(Some(carried))
}

impl CarriedAssets {
    /// The move failed: the copies made for it are removed again.
    pub(crate) fn undo(&self) { for name in &self.created { let _ = self.target.remove(name); } }

    /// The move succeeded: an image no other Markdown file left in the old folder uses goes to the Trash, so the
    /// images moved rather than doubled, and can still be put back; so does the `assets/` folder once it is empty.
    /// When in doubt an image stays.
    pub(crate) fn release(&self) {
        let Some(used) = images_used_in(&self.source_parent) else { return };
        for name in &self.names {
            if used.contains(name.to_string_lossy().as_ref()) { continue; }
            if let Ok(path) = self.source.path_of(name) { let _ = crate::workspace::move_to_trash(&path); }
        }
        // An `assets/` folder left empty (Finder's `.DS_Store` aside) goes to the Trash too; anything else in it keeps it.
        let folder = self.source_parent.join("assets");
        let Ok(entries) = fs::read_dir(&folder) else { return };
        let mut entries = entries.map(|entry| entry.map(|entry| entry.file_name()));
        if entries.all(|name| name.is_ok_and(|name| name == ".DS_Store")) && self.source.verify_location().is_ok() {
            let _ = crate::workspace::move_to_trash(&folder);
        }
    }
}

/// The names of the `assets/` images the Markdown files in `folder` reference, or `None` when a file could not be
/// read or there are too many to read.
fn images_used_in(folder: &Path) -> Option<HashSet<String>> {
    let mut used = HashSet::new();
    for (index, entry) in fs::read_dir(folder).ok()?.enumerate() {
        if index >= SIBLING_LIMIT { return None; }
        let path = entry.ok()?.path();
        let meta = fs::symlink_metadata(&path).ok()?;
        if !meta.is_file() || DocumentKind::of(&path) != Some(DocumentKind::Markdown) { continue; }
        for relative in markdown_images::referenced_assets(&read_document(&path).ok()?.text) {
            if let Some(name) = markdown_images::local_asset_path(&relative).and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned())) { used.insert(name); }
        }
    }
    Some(used)
}

/// A copy keeps the document's encoding unless it changes kind (a text file saved as Markdown is UTF-8).
fn copy_encoding(grant: &Grant, kind: DocumentKind, force_utf8: Option<bool>) -> TextEncoding {
    if force_utf8 == Some(true) || kind != grant.kind { TextEncoding::UTF8 } else { grant.encoding }
}

#[tauri::command]
pub async fn save_conflict_copy(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, staging: State<'_, StagingStore>, token: String, markdown: String, assets: Vec<StagedAsset>, force_utf8: Option<bool>) -> Result<Option<String>, String> {
    crate::require_workspace_window(&window)?;
    let assets = staged_uploads(&staging, assets)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    let grant = store.grant(&token)?;
    if !grant.kind.is_text() { return Err("READ_ONLY".into()); }
    let selected = save_dialog(&app, grant.kind, Some(&grant.path), &["md"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "INVALID_PATH")?;
    let kind = target_kind(&path, grant.kind)?;
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    if path == grant.path || path.exists() { return Err("TARGET_EXISTS".into()); }
    let encoding = copy_encoding(&grant, kind, force_utf8);
    // Checked before any attachment is copied, so a refused save leaves nothing behind.
    text_encoding::encode(&markdown, encoding)?;
    let (copied_markdown, _) = if grant.kind == DocumentKind::Markdown { copy_assets_for_copy(&grant.path, &path, &markdown)? } else { (markdown, HashMap::new()) };
    let (persisted, _) = save_assets(kind, &parent, &copied_markdown, assets)?;
    atomic_write::commit(&path, &text_encoding::encode(&persisted, encoding)?, None)?;
    Ok(Some(filename(&path)))
}

#[tauri::command]
pub async fn save_as_document(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, staging: State<'_, StagingStore>, token: String, markdown: String, assets: Vec<StagedAsset>, force_utf8: Option<bool>) -> Result<Option<SaveResult>, String> {
    crate::require_workspace_window(&window)?;
    let assets = staged_uploads(&staging, assets)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    let grant = store.grant(&token)?;
    if !grant.kind.is_text() { return Err("READ_ONLY".into()); }
    let selected = save_dialog(&app, grant.kind, Some(&grant.path), &["md", "markdown"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(None); };
    let selected = selected.into_path().map_err(|_| "INVALID_PATH")?;
    let kind = target_kind(&selected, grant.kind)?;
    let parent = fs::canonicalize(selected.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    let path = parent.join(selected.file_name().ok_or("INVALID_PATH")?);
    if path == grant.path || path.exists() { return Err("TARGET_EXISTS".into()); }
    let encoding = copy_encoding(&grant, kind, force_utf8);
    text_encoding::encode(&markdown, encoding)?;
    let _write_guard = SAVE_LOCK.lock().map_err(|_| "IO_ERROR")?;
    let (copied_markdown, asset_relocations) = if grant.kind == DocumentKind::Markdown { copy_assets_for_copy(&grant.path, &path, &markdown)? } else { (markdown, HashMap::new()) };
    let (persisted, asset_paths) = save_assets(kind, &parent, &copied_markdown, assets)?;
    let revision = atomic_write::commit(&path, &text_encoding::encode(&persisted, encoding)?, None)?;
    let new_token = format!("doc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let asset_key = random_key()?;
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(new_token.clone(), Grant { observed: None, stamp: stamp_of(&path), path: path.clone(), revision: revision.clone(), asset_key: asset_key.clone(), kind, encoding });
    Ok(Some(SaveResult { token: new_token, name: filename(&path), revision, markdown: Some(persisted), asset_paths, asset_relocations, asset_key, kind: kind.as_str(), encoding: encoding.label() }))
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

#[cfg(test)]
thread_local! { pub(crate) static IMAGES_VALIDATED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

pub(crate) fn validate_image(bytes: &[u8], mime: &str) -> Result<&'static str, String> {
    #[cfg(test)]
    IMAGES_VALIDATED.with(|count| count.set(count.get() + 1));
    let extension = image_extension(bytes, mime).ok_or("INVALID_IMAGE")?;
    let format = match extension { "png" => ImageFormat::Png, "jpg" => ImageFormat::Jpeg, "gif" => ImageFormat::Gif, "webp" => ImageFormat::WebP, _ => return Err("INVALID_IMAGE".into()) };
    let dimensions = ImageReader::with_format(std::io::Cursor::new(bytes), format).into_dimensions().map_err(|_| "INVALID_IMAGE")?;
    if dimensions.0 == 0 || dimensions.1 == 0 || u64::from(dimensions.0) * u64::from(dimensions.1) > 40_000_000 { return Err("IMAGE_TOO_LARGE".into()); }
    ImageReader::with_format(std::io::Cursor::new(bytes), format).decode().map_err(|_| "INVALID_IMAGE")?;
    Ok(extension)
}

fn save_assets(kind: DocumentKind, parent: &Path, markdown: &str, assets: Vec<AssetUpload>) -> Result<(String, HashMap<String, String>), String> {
    let mut paths = HashMap::new();
    // Only Markdown has images; a text or source file is written exactly as given.
    if kind != DocumentKind::Markdown { return if assets.is_empty() { Ok((markdown.to_owned(), paths)) } else { Err("INVALID_ASSET".into()) }; }
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
    staging: State<'_, StagingStore>,
    token: Option<String>,
    expected_revision: Option<String>,
    markdown: String,
    assets: Vec<StagedAsset>,
    force_utf8: Option<bool>,
    suggested_name: Option<String>,
) -> Result<Option<SaveResult>, String> {
    crate::require_workspace_window(&window)?;
    let assets = staged_uploads(&staging, assets)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    // A rename, move or removal in the sidebar waits for this save, and this save waits for it, so the file is
    // never written back to the place it just left (T109). Saving a new file shows a panel first and takes no lock.
    let _paths = match token { Some(_) => Some(PATHS.read().map_err(|_| "IO_ERROR")?), None => None };
    let grant = match token.as_ref() {
        Some(id) => Some(store.grant(id)?),
        None => None,
    };
    let path = if let Some(grant) = &grant {
        if !grant.kind.is_text() { return Err("READ_ONLY".into()); }
        grant.path.clone()
    } else {
        // A recovered draft of a text file suggests its own name, so it is not saved as Markdown by accident.
        let suggested = suggested_name.filter(|name| text_file_name(name));
        let suggested_kind = suggested.as_deref().and_then(|name| DocumentKind::of(Path::new(name))).unwrap_or(DocumentKind::Markdown);
        let mut dialog = save_dialog(&app, suggested_kind, suggested.as_deref().map(Path::new), &["md"]);
        if let Some(name) = &suggested { dialog = dialog.set_file_name(name); }
        let Some(selected) = dialog.blocking_save_file() else { return Ok(None); };
        selected.into_path().map_err(|_| "INVALID_PATH")?
    };
    let kind = DocumentKind::of(&path).filter(|kind| kind.is_text()).ok_or("UNSUPPORTED_FILE_TYPE")?;
    let encoding = match &grant { Some(grant) if force_utf8 != Some(true) => grant.encoding, _ => TextEncoding::UTF8 };
    // Checked before any attachment is written, so a refused save leaves nothing behind. These are also the
    // bytes to write unless saving the attachments changes the text.
    let encoded = text_encoding::encode(&markdown, encoding)?;
    let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "INVALID_PATH")?;
    if let Some(grant) = &grant { if parent != grant.path.parent().ok_or("INVALID_PATH")? { return Err("OUT_OF_SCOPE".into()); } }
    let path = parent.join(path.file_name().ok_or("INVALID_PATH")?);
    let _write_guard = SAVE_LOCK.lock().map_err(|_| "IO_ERROR")?;
    match &grant {
        Some(grant) => {
            if expected_revision.as_deref() != Some(grant.revision.as_str()) { return Err("STALE_OPERATION".into()); }
            if disk_revision(&path, kind)? != grant.revision { return Err("CONFLICT".into()); }
        }
        None if path.exists() => return Err("TARGET_EXISTS".into()),
        _ => {}
    }
    let (persisted, asset_paths) = save_assets(kind, &parent, &markdown, assets)?;
    let rewritten = persisted != markdown;
    let bytes = if rewritten { text_encoding::encode(&persisted, encoding)? } else { encoded };
    let revision = atomic_write::commit(&path, &bytes, grant.as_ref().map(|item| item.revision.as_str()))?;
    let token = token.unwrap_or_else(|| format!("doc-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));
    let asset_key = match &grant { Some(grant) => grant.asset_key.clone(), None => random_key()? };
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), Grant { observed: None, stamp: stamp_of(&path), path: path.clone(), revision: revision.clone(), asset_key: asset_key.clone(), kind, encoding });
    Ok(Some(SaveResult { token, name: filename(&path), revision, markdown: rewritten.then_some(persisted), asset_paths, asset_relocations: HashMap::new(), asset_key, kind: kind.as_str(), encoding: encoding.label() }))
}

pub(crate) fn asset_mime(relative: &str) -> Option<&'static str> {
    match relative.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"), "gif" => Some("image/gif"), "webp" => Some("image/webp"), _ => None,
    }
}

/// Reads an image next to a granted document, keeping the checks of `read_scoped_asset`.
pub(crate) fn read_granted_asset(store: &DocumentStore, token: &str, relative: &str) -> Result<Vec<u8>, String> {
    read_scoped_asset(&store.grant(token)?, relative)
}

fn parse_asset_path(path: &str) -> Option<(String, String)> {
    let mut parts = path.strip_prefix('/')?.split('/');
    let key = parts.next().filter(|key| key.len() == 32 && key.bytes().all(|byte| byte.is_ascii_hexdigit()))?.to_owned();
    let relative = parts.map(|part| percent_encoding::percent_decode_str(part).decode_utf8().ok().map(|text| text.into_owned())).collect::<Option<Vec<_>>>()?;
    if relative.is_empty() { return None; }
    Some((key, relative.join("/")))
}

fn read_keyed_asset(store: &DocumentStore, path: &str) -> Result<(Vec<u8>, &'static str), String> {
    let (key, relative) = parse_asset_path(path).ok_or("OUT_OF_SCOPE")?;
    let mime = asset_mime(&relative).ok_or("OUT_OF_SCOPE")?;
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.values().find(|grant| grant.asset_key == key).cloned().ok_or("OUT_OF_SCOPE")?;
    Ok((read_scoped_asset(&grant, &relative)?, mime))
}

/// Serves `mino-asset:` image URLs. Only raster images inside a live grant's scope are returned.
pub fn asset_response(app: &AppHandle, label: &str, path: &str) -> tauri::http::Response<Vec<u8>> {
    use tauri::{http::Response, Manager};
    let found = if crate::is_workspace_window(label) { read_keyed_asset(&app.state::<DocumentStore>(), path).ok() } else { None };
    let builder = Response::builder().header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    match found {
        Some((bytes, mime)) => builder.status(200).header("Content-Type", mime).body(bytes),
        None => builder.status(404).body(Vec::new()),
    }.unwrap_or_else(|_| Response::new(Vec::new()))
}

fn read_scoped_asset(grant: &Grant, relative: &str) -> Result<Vec<u8>, String> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.is_empty() || parts.len() > 8 || parts.iter().any(|part| {
        part.is_empty() || *part == "." || *part == ".." || part.contains(['\\', '\0', ':'])
    }) { return Err("OUT_OF_SCOPE".into()); }
    let parent = grant.path.parent().ok_or("INVALID_PATH")?;
    #[cfg(target_os = "macos")]
    return read_asset_from_directory(parent, &parts);
    #[cfg(not(target_os = "macos"))]
    {
    let root = fs::canonicalize(parent).map_err(|_| "NOT_FOUND")?;
    let target = fs::canonicalize(root.join(relative)).map_err(|_| "NOT_FOUND")?;
    if !target.starts_with(&root) { return Err("OUT_OF_SCOPE".into()); }
    let meta = fs::metadata(&target).map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.len() as usize > MAX_IMAGE { return Err("IMAGE_TOO_LARGE".into()); }
    fs::read(target).map_err(|_| "IO_ERROR".into())
    }
}

#[cfg(target_os = "macos")]
fn read_asset_from_directory(parent: &Path, parts: &[&str]) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut directory = open_parent_directory(parent)?;
    for part in &parts[..parts.len() - 1] {
        directory = open_child(&directory, std::ffi::OsStr::new(part), libc::O_DIRECTORY)?;
    }
    let image = open_child(&directory, std::ffi::OsStr::new(parts[parts.len() - 1]), 0)?;
    let meta = image.metadata().map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.len() > MAX_IMAGE as u64 { return Err("IMAGE_TOO_LARGE".into()); }
    let mut bytes = Vec::new();
    image.take(MAX_IMAGE as u64 + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    if bytes.len() > MAX_IMAGE { return Err("IMAGE_TOO_LARGE".into()); }
    Ok(bytes)
}

#[tauri::command]
pub async fn export_html(app: AppHandle, window: WebviewWindow, html: String) -> Result<Option<String>, String> {
    crate::require_workspace_window(&window)?;
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
    crate::fs::write_chosen_file(&path, html.into_bytes(), crate::fs::CHOSEN_FILE_TIMEOUT)?;
    Ok(Some(filename(&path)))
}

/// A name the frontend may suggest for a note: one Markdown file name, no path.
fn note_name(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= 120 && !name.starts_with('.') && name.to_ascii_lowercase().ends_with(".md")
        && !name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
}

/// Saves a note (an AI answer) through a save dialog that starts in the folder of the document it is about,
/// with a suggested name (T80). The user confirms or changes the place, so the path is still one a system
/// dialog granted; an existing file is never replaced.
#[tauri::command]
pub async fn save_note_beside(app: AppHandle, window: WebviewWindow, store: State<'_, DocumentStore>, token: Option<String>, name: String, markdown: String) -> Result<Option<String>, String> {
    crate::require_workspace_window(&window)?;
    if markdown.len() as u64 > MAX_DOCUMENT { return Err("DOCUMENT_TOO_LARGE".into()); }
    if !note_name(&name) { return Err("INVALID_NAME".into()); }
    let mut dialog = app.dialog().file().add_filter("Markdown", &["md"]).set_file_name(&name);
    if let Some(parent) = token.and_then(|token| store.grant(&token).ok()).and_then(|grant| grant.path.parent().map(Path::to_path_buf)) { dialog = dialog.set_directory(parent); }
    let Some(selected) = dialog.blocking_save_file() else { return Ok(None); };
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

    #[test]
    fn note_names_are_single_markdown_file_names() {
        for good in ["读书笔记-AI总结.md", "README-AI总结.MD", "a b.md"] { assert!(note_name(good), "{good}"); }
        for bad in ["", ".hidden.md", "a/b.md", "..\\b.md", "a:b.md", "note.txt", "a\nb.md"] { assert!(!note_name(bad), "{bad:?}"); }
        assert!(!note_name(&format!("{}.md", "长".repeat(120))));
    }

    #[test]
    fn same_file_matches_one_file_under_another_spelling_only() {
        let dir = sample_dir();
        let notes = dir.join("Notes.md");
        let other = dir.join("other.md");
        fs::write(&notes, "a").unwrap();
        fs::write(&other, "a").unwrap();
        assert!(same_file(&notes, &notes));
        assert!(!same_file(&notes, &other));
        assert!(!same_file(&notes, &dir.join("missing.md")));
        // A case-insensitive volume (the APFS default) reaches the same file by another case.
        let lower = dir.join("notes.md");
        if lower.exists() { assert!(same_file(&notes, &lower)); }
        fs::remove_dir_all(dir).unwrap();
    }

    fn sample_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mino-doc-test-{}-{}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn image_is_written_as_separate_asset_and_reference_is_replaced() {
        let dir = sample_dir();
        let png = include_bytes!("../../tests/fixtures/assets/synthetic-2x2.png").to_vec();
        let (markdown, paths) = save_assets(DocumentKind::Markdown, &dir, "before ![shot](blob:temporary) after", vec![AssetUpload {
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
        let result = save_assets(DocumentKind::Markdown, &dir, "![shot](blob:temporary)", vec![AssetUpload {
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
        assert!(crate::require_workspace_label("main").is_ok());
        assert!(matches!(crate::require_workspace_label("print"), Err(code) if code == "OUT_OF_SCOPE"));
    }

    #[test]
    fn asset_urls_need_a_live_key_and_stay_inside_the_grant() {
        let dir = sample_dir();
        fs::create_dir(dir.join("assets")).unwrap();
        fs::write(dir.join("assets/图 1.png"), b"pixels").unwrap();
        fs::write(dir.join("assets/page.html"), b"<script>").unwrap();
        fs::write(dir.join("outside.png"), b"outside").unwrap();
        let store = DocumentStore::default();
        let key = random_key().unwrap();
        store.0.lock().unwrap().insert("doc-1".into(), Grant { observed: None, path: dir.join("note.md"), revision: String::new(), stamp: None, asset_key: key.clone(), kind: DocumentKind::Markdown, encoding: TextEncoding::UTF8 });
        let (bytes, mime) = read_keyed_asset(&store, &format!("/{key}/assets/%E5%9B%BE%201.png")).unwrap();
        assert_eq!((bytes.as_slice(), mime), (b"pixels".as_slice(), "image/png"));
        assert!(read_keyed_asset(&store, &format!("/{key}/assets/page.html")).is_err());
        assert!(read_keyed_asset(&store, &format!("/{key}/assets/../outside.png")).is_err());
        assert!(read_keyed_asset(&store, &format!("/{key}/assets%2F..%2Foutside.png")).is_err());
        assert!(read_keyed_asset(&store, &format!("/{}/assets/%E5%9B%BE%201.png", "0".repeat(32))).is_err());
        assert!(read_keyed_asset(&store, "/doc-1/assets/%E5%9B%BE%201.png").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn unchanged_stat_skips_hashing_and_any_stat_change_rehashes() {
        let dir = sample_dir();
        let path = dir.join("entry.md");
        fs::write(&path, b"first").unwrap();
        // The revision deliberately does not match the bytes: "same" proves the file was not read.
        let grant = Grant { observed: None, path: path.clone(), revision: "recorded".into(), stamp: stamp_of(&path), asset_key: String::new(), kind: DocumentKind::Markdown, encoding: TextEncoding::UTF8 };
        let (status, _) = disk_status(&grant).unwrap();
        assert_eq!((status.kind, status.revision.as_deref()), ("same", Some("recorded")));
        fs::write(&path, b"second, longer").unwrap();
        assert_eq!(disk_status(&grant).unwrap().0.kind, "changed");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn a_save_that_left_the_text_as_sent_does_not_send_it_back() {
        let result = |markdown: Option<String>| serde_json::to_value(SaveResult { token: "doc-1".into(), name: "a.md".into(), revision: "r".into(), markdown, asset_paths: HashMap::new(), asset_relocations: HashMap::new(), asset_key: "k".into(), kind: "markdown", encoding: "UTF-8".into() }).unwrap();
        assert!(result(None).get("markdown").is_none());
        assert_eq!(result(Some("![x](assets/image-1.png)".into()))["markdown"], "![x](assets/image-1.png)");
        // Saving without new images leaves the text as it was given; with one, the reference is rewritten.
        let dir = sample_dir();
        let (kept, paths) = save_assets(DocumentKind::Markdown, &dir, "plain text", vec![]).unwrap();
        assert_eq!((kept.as_str(), paths.len()), ("plain text", 0));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn a_changed_file_is_not_read_again_until_it_changes_again() {
        let dir = sample_dir();
        let path = dir.join("entry.md");
        fs::write(&path, b"changed on disk").unwrap();
        // The remembered revision deliberately does not match the bytes: getting it back proves the file was not read.
        let mut grant = Grant { observed: Some((stamp_of(&path).unwrap(), "seen before".into())), path: path.clone(), revision: digest(b"what the tab opened"), stamp: None, asset_key: String::new(), kind: DocumentKind::Markdown, encoding: TextEncoding::UTF8 };
        let (status, _) = disk_status(&grant).unwrap();
        assert_eq!((status.kind, status.revision.as_deref()), ("changed", Some("seen before")));
        // Another change is read: the stat no longer matches what was remembered.
        fs::write(&path, b"changed once more, and longer").unwrap();
        let (status, stamp) = disk_status(&grant).unwrap();
        assert_eq!((status.kind, status.revision), ("changed", Some(digest(b"changed once more, and longer"))));
        // Changed back to what the tab holds: the same, whatever was remembered.
        fs::write(&path, b"what the tab opened").unwrap();
        grant.observed = Some((stamp.unwrap(), digest(b"changed once more, and longer")));
        assert_eq!(disk_status(&grant).unwrap().0.kind, "same");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn external_change_and_delete_are_detected_from_content() {
        let dir = sample_dir();
        let path = dir.join("entry.md");
        fs::write(&path, b"first").unwrap();
        let grant = Grant { observed: None, path: path.clone(), revision: digest(b"first"), stamp: None, asset_key: String::new(), kind: DocumentKind::Markdown, encoding: TextEncoding::UTF8 };
        assert_eq!(disk_status(&grant).unwrap().0.kind, "same");
        fs::write(&path, b"second").unwrap();
        assert_eq!(disk_status(&grant).unwrap().0.kind, "changed");
        fs::remove_file(&path).unwrap();
        assert_eq!(disk_status(&grant).unwrap().0.kind, "deleted");
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
    fn each_kind_opens_as_what_its_extension_says_and_binary_content_is_refused() {
        let dir = sample_dir();
        let store = DocumentStore::default();
        let (gbk, _, _) = encoding_rs::GB18030.encode("第一章 起点\r\n\r\n这是一个用来检查编码识别的段落，里面有中文、English words 和数字 12345。\r\n");
        fs::write(dir.join("novel.txt"), &gbk).unwrap();
        fs::write(dir.join("config.json"), "{\"name\": \"mino\"}\n").unwrap();
        fs::write(dir.join("manual.pdf"), b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n").unwrap();
        let text = open_granted_path(&store, &dir.join("novel.txt")).unwrap();
        assert_eq!((text.kind, text.encoding.as_str(), text.size), ("text", "GB18030", gbk.len() as u64));
        assert!(text.markdown.starts_with("第一章 起点\r\n"));
        assert_eq!(text.revision, digest(&gbk));
        let code = open_granted_path(&store, &dir.join("config.json")).unwrap();
        assert_eq!((code.kind, code.encoding.as_str()), ("code", "UTF-8"));
        let pdf = open_granted_path(&store, &dir.join("manual.pdf")).unwrap();
        assert_eq!((pdf.kind, pdf.markdown.as_str(), pdf.size), ("pdf", "", 35));
        assert_eq!(pdf.revision, digest(b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"));
        assert_eq!(document_identity(&store, &pdf.token).unwrap().1, DocumentKind::Pdf);
        // The extension is supported but the content is something else.
        fs::write(dir.join("archive.txt"), b"PK\x03\x04\x00\x00\x00\x08\x00binary").unwrap();
        fs::write(dir.join("fake.pdf"), b"this is not a pdf at all").unwrap();
        fs::write(dir.join("video.ts"), [0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01]).unwrap();
        for name in ["archive.txt", "fake.pdf", "video.ts"] { assert_eq!(open_granted_path(&store, &dir.join(name)).err().as_deref(), Some("UNSUPPORTED_FORMAT"), "{name}"); }
        fs::write(dir.join("letter.docx"), b"hello").unwrap();
        assert_eq!(open_granted_path(&store, &dir.join("letter.docx")).err().as_deref(), Some("UNSUPPORTED_FILE_TYPE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn new_kinds_do_not_follow_links_either() {
        let dir = sample_dir();
        let real = dir.join("real"); fs::create_dir(&real).unwrap();
        fs::write(real.join("a.txt"), b"text").unwrap();
        fs::write(real.join("a.pdf"), b"%PDF-1.4\n").unwrap();
        std::os::unix::fs::symlink(real.join("a.txt"), dir.join("link.txt")).unwrap();
        std::os::unix::fs::symlink(real.join("a.pdf"), dir.join("link.pdf")).unwrap();
        std::os::unix::fs::symlink(&real, dir.join("parent-link")).unwrap();
        for name in ["link.txt", "link.pdf", "parent-link/a.txt", "parent-link/a.pdf"] { assert_eq!(read_document(&dir.join(name)).err().as_deref(), Some("OUT_OF_SCOPE"), "{name}"); }
        assert_eq!(validate_selected_file(&dir.join("link.pdf")).err().as_deref(), Some("OUT_OF_SCOPE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pdf_is_read_in_checked_ranges() {
        let dir = sample_dir();
        let path = dir.join("manual.pdf");
        let content: Vec<u8> = b"%PDF-1.4\n".iter().copied().chain((0..5000u32).map(|index| (index % 251) as u8)).collect();
        fs::write(&path, &content).unwrap();
        let store = DocumentStore::default();
        let token = open_granted_path(&store, &path).unwrap().token;
        let grant = store.grant(&token).unwrap();
        assert_eq!(read_range(&grant, 0, 9).unwrap(), b"%PDF-1.4\n");
        assert_eq!(read_range(&grant, 100, 50).unwrap(), &content[100..150]);
        // A range past the end is cut at the end; one that starts there is refused.
        assert_eq!(read_range(&grant, 5000, 1000).unwrap(), &content[5000..]);
        assert_eq!(read_range(&grant, content.len() as u64, 1).err().as_deref(), Some("INVALID_RANGE"));
        assert_eq!(read_range(&grant, 0, 0).err().as_deref(), Some("INVALID_RANGE"));
        assert_eq!(read_range(&grant, 0, MAX_RANGE + 1).err().as_deref(), Some("INVALID_RANGE"));
        // Only a PDF grant can be read this way.
        fs::write(dir.join("note.md"), b"secret").unwrap();
        let note = open_granted_path(&store, &dir.join("note.md")).unwrap().token;
        assert_eq!(read_range(&store.grant(&note).unwrap(), 0, 6).err().as_deref(), Some("OUT_OF_SCOPE"));
        assert_eq!(store.grant("doc-unknown").err().as_deref(), Some("OUT_OF_SCOPE"));
        // The file was replaced after it was opened: nothing of the new file is returned.
        fs::remove_file(&path).unwrap();
        fs::write(&path, b"%PDF-1.4\nanother file entirely").unwrap();
        assert_eq!(read_range(&grant, 0, 9).err().as_deref(), Some("CHANGED"));
        let (status, _) = disk_status(&grant).unwrap();
        assert_eq!(status.kind, "changed");
        #[cfg(unix)]
        {
            fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(dir.join("note.md"), &path).unwrap();
            assert_eq!(read_range(&grant, 0, 6).err().as_deref(), Some("OUT_OF_SCOPE"));
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pdf_over_its_own_limit_is_refused_while_text_keeps_the_smaller_one() {
        let dir = sample_dir();
        let pdf = dir.join("big.pdf");
        fs::File::create(&pdf).unwrap().set_len(file_kinds::MAX_PDF_BYTES + 1).unwrap();
        assert_eq!(read_document(&pdf).err().as_deref(), Some("DOCUMENT_TOO_LARGE"));
        let text = dir.join("big.txt");
        fs::File::create(&text).unwrap().set_len(MAX_DOCUMENT + 1).unwrap();
        assert_eq!(read_document(&text).err().as_deref(), Some("DOCUMENT_TOO_LARGE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saved_copies_keep_the_kind_or_become_markdown() {
        assert_eq!(target_kind(Path::new("/a/b.txt"), DocumentKind::Text), Ok(DocumentKind::Text));
        assert_eq!(target_kind(Path::new("/a/b.md"), DocumentKind::Text), Ok(DocumentKind::Markdown));
        assert_eq!(target_kind(Path::new("/a/b.yaml"), DocumentKind::Code), Ok(DocumentKind::Code));
        assert_eq!(target_kind(Path::new("/a/b.markdown"), DocumentKind::Markdown), Ok(DocumentKind::Markdown));
        for (name, source) in [("/a/b.txt", DocumentKind::Markdown), ("/a/b.json", DocumentKind::Text), ("/a/b.pdf", DocumentKind::Text), ("/a/b.pdf", DocumentKind::Pdf), ("/a/b.docx", DocumentKind::Text), ("/a/b", DocumentKind::Markdown)] {
            assert_eq!(target_kind(Path::new(name), source).err().as_deref(), Some("UNSUPPORTED_FILE_TYPE"), "{name}");
        }
        let big5 = TextEncoding { encoding: encoding_rs::BIG5, bom: false, exact: true };
        let grant = Grant { observed: None, path: "/a/b.txt".into(), revision: String::new(), stamp: None, asset_key: String::new(), kind: DocumentKind::Text, encoding: big5 };
        assert_eq!(copy_encoding(&grant, DocumentKind::Text, None), big5);
        assert_eq!(copy_encoding(&grant, DocumentKind::Text, Some(false)), big5);
        assert_eq!(copy_encoding(&grant, DocumentKind::Text, Some(true)), TextEncoding::UTF8);
        assert_eq!(copy_encoding(&grant, DocumentKind::Markdown, None), TextEncoding::UTF8);
        for good in ["小说.txt", "config.YAML", "notes.md", "a b.log"] { assert!(text_file_name(good), "{good}"); }
        for bad in ["", "book.pdf", ".hidden.txt", "a/b.txt", "..\\b.txt", "a:b.txt", "note", "letter.docx", "a\nb.txt"] { assert!(!text_file_name(bad), "{bad:?}"); }
    }

    #[test]
    fn text_files_are_never_given_image_attachments() {
        let dir = sample_dir();
        let upload = || vec![AssetUpload { url: "blob:temporary".into(), bytes: vec![1, 2, 3], mime: "image/png".into() }];
        assert_eq!(save_assets(DocumentKind::Text, &dir, "![shot](blob:temporary)", upload()).err().as_deref(), Some("INVALID_ASSET"));
        let (text, paths) = save_assets(DocumentKind::Code, &dir, "![shot](assets/x.png) stays as typed", Vec::new()).unwrap();
        assert_eq!(text, "![shot](assets/x.png) stays as typed");
        assert!(paths.is_empty() && !dir.join("assets").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_disk_revision_is_taken_from_bytes_whatever_they_decode_to() {
        let dir = sample_dir();
        let path = dir.join("note.txt");
        fs::write(&path, [0xff, 0xfe, 0x41]).unwrap();
        // Unreadable as text, yet still comparable: a save sees a conflict rather than an encoding error.
        assert_eq!(read_document(&path).err().as_deref(), Some("INVALID_ENCODING"));
        assert_eq!(disk_revision(&path, DocumentKind::Text).unwrap(), digest(&[0xff, 0xfe, 0x41]));
        fs::remove_file(&path).unwrap();
        assert_eq!(disk_revision(&path, DocumentKind::Text).err().as_deref(), Some("NOT_FOUND"));
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
        fs::write(&path, [0xff, 0xfe, 0x41]).unwrap();
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
        let grant = Grant { observed: None, path: dir.join("note.md"), revision: String::new(), stamp: None, asset_key: String::new(), kind: DocumentKind::Markdown, encoding: TextEncoding::UTF8 };
        assert_eq!(read_scoped_asset(&grant,"assets/good.png").unwrap(),b"safe bytes");
        assert_eq!(read_scoped_asset(&grant,"assets/../outside.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        assert_eq!(read_scoped_asset(&grant,"assets/nested/good.png").err().as_deref(),Some("NOT_FOUND"));
        fs::create_dir(dir.join("配图")).unwrap();
        fs::write(dir.join("配图/市场.png"), b"local image").unwrap();
        assert_eq!(read_scoped_asset(&grant,"配图/市场.png").unwrap(),b"local image");
        assert_eq!(read_scoped_asset(&grant,"./配图/市场.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        assert_eq!(read_scoped_asset(&grant,"配图//市场.png").err().as_deref(),Some("OUT_OF_SCOPE"));
        std::os::unix::fs::symlink(dir.join("assets"), dir.join("linked-images")).unwrap();
        assert_eq!(read_scoped_asset(&grant,"linked-images/good.png").err().as_deref(),Some("OUT_OF_SCOPE"));
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
