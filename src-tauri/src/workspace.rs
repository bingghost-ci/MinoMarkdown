use crate::documents::{DocumentStore, OpenDocument, grants_within, moved_path, open_granted_path, relocating, removing, forget_grants, carry_assets};
use crate::file_kinds::{self, DocumentKind};
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex}};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

static NEXT_ENTRY: AtomicU64 = AtomicU64::new(1);
const PAGE_SIZE: usize = 200;
const MAX_SEARCH_HITS: usize = 500;
const MAX_HITS_PER_FILE: usize = 5;
const MAX_SEARCH_DOCUMENT: u64 = 20 * 1024 * 1024;
const MAX_SEARCH_QUERY_CHARS: usize = 256;
const SNIPPET_CHARS: usize = 120;

#[derive(Clone)]
struct EntryGrant { workspace: String, root: PathBuf, path: PathBuf, directory: bool }
#[derive(Default)]
pub struct WorkspaceStore(Mutex<HashMap<String, EntryGrant>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRoot { token: String, name: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry { token: String, name: String, directory: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildrenPage { entries: Vec<WorkspaceEntry>, next_offset: Option<usize> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit { token: String, name: String, path: String, line: usize, snippet: String, occurrence: usize }
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults { hits: Vec<SearchHit>, truncated: bool, skipped: usize }
/// One counter per window: starting a search makes that window's earlier search stop.
#[derive(Default)]
pub struct SearchState(Mutex<HashMap<String, Arc<AtomicU64>>>);

/// Files the sidebar lists: every kind the app opens (T81).
fn is_document(path: &Path) -> bool { DocumentKind::of(path).is_some() }
fn ignored(name: &str) -> bool { name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist" | "build" | "assets" | "venv" | "__pycache__") }
fn valid_name(name: &str, directory: bool) -> bool {
    !name.is_empty() && name.len() <= 200 && name == name.trim() && !ignored(name) && !name.contains(['/', '\\', ':']) && !name.chars().any(char::is_control) && (directory || file_kinds::is_text_path(Path::new(name)))
}
/// A file keeps its kind when renamed, so a document that is open stays what it was opened as. A PDF may be
/// renamed, though one cannot be created.
pub(crate) fn valid_rename(current: &Path, name: &str, directory: bool) -> bool {
    if directory { return valid_name(name, true); }
    let kind = DocumentKind::of(Path::new(name));
    if kind.is_none() || kind != DocumentKind::of(current) { return false; }
    // The name rules are those of a text file; only the extension differs for a PDF.
    if kind == Some(DocumentKind::Pdf) { valid_name(&Path::new(name).with_extension("md").to_string_lossy(), false) && name == name.trim() } else { valid_name(name, false) }
}

#[cfg(target_os = "macos")]
fn directory_handle(parent: &Path) -> Result<fs::File, String> {
    if fs::canonicalize(parent).map_err(|_| "OUT_OF_SCOPE")? != parent { return Err("OUT_OF_SCOPE".into()); }
    crate::fs::open_directory(parent)
}

#[cfg(target_os = "macos")]
fn entry_name(name: &std::ffi::OsStr) -> Result<std::ffi::CString, String> {
    use std::os::unix::ffi::OsStrExt;
    let mut parts = Path::new(name).components();
    if !matches!(parts.next(), Some(std::path::Component::Normal(_))) || parts.next().is_some() { return Err("OUT_OF_SCOPE".into()); }
    std::ffi::CString::new(name.as_bytes()).map_err(|_| "OUT_OF_SCOPE".into())
}

#[cfg(target_os = "macos")]
fn entry_stat(directory: &fs::File, name: &std::ffi::CString) -> Result<Option<libc::stat>, String> {
    use std::os::fd::AsRawFd;
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstatat(directory.as_raw_fd(), name.as_ptr(), &mut stat, libc::AT_SYMLINK_NOFOLLOW) } == 0 { return Ok(Some(stat)); }
    if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { Ok(None) } else { Err("OUT_OF_SCOPE".into()) }
}

#[cfg(target_os = "macos")]
fn same_directory(parent: &Path, directory: &fs::File) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let actual = fs::symlink_metadata(parent).map_err(|_| "COMMIT_UNCERTAIN")?;
    let held = directory.metadata().map_err(|_| "COMMIT_UNCERTAIN")?;
    if !actual.is_dir() || actual.dev() != held.dev() || actual.ino() != held.ino() { return Err("COMMIT_UNCERTAIN".into()); }
    Ok(())
}

#[cfg(target_os = "macos")]
fn create_entry_at(parent: &Path, name: &str, directory: bool) -> Result<(), String> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let held = directory_handle(parent)?;
    let entry = entry_name(std::ffi::OsStr::new(name))?;
    if directory {
        if unsafe { libc::mkdirat(held.as_raw_fd(), entry.as_ptr(), 0o755) } < 0 {
            return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists { "TARGET_EXISTS" } else { "IO_ERROR" }.into());
        }
    } else {
        let fd = unsafe { libc::openat(held.as_raw_fd(), entry.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW, 0o644) };
        if fd < 0 { return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists { "TARGET_EXISTS" } else { "IO_ERROR" }.into()); }
        unsafe { fs::File::from_raw_fd(fd) }.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    }
    held.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    same_directory(parent, &held)
}

#[cfg(not(target_os = "macos"))]
fn create_entry_at(_parent: &Path, _name: &str, _directory: bool) -> Result<(), String> { Err("UNSUPPORTED_PLATFORM".into()) }

#[cfg(target_os = "macos")]
pub(crate) fn rename_entry_at(source: &Path, new_name: &str, directory: bool) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    let parent = source.parent().ok_or("INVALID_PATH")?;
    let held = directory_handle(parent)?;
    let from = entry_name(source.file_name().ok_or("INVALID_PATH")?)?;
    let to = entry_name(std::ffi::OsStr::new(new_name))?;
    let target = parent.join(new_name);
    if from == to { return Ok(target); }
    let before = entry_stat(&held, &from)?.ok_or("NOT_FOUND")?;
    if before.st_mode & libc::S_IFMT != if directory { libc::S_IFDIR } else { libc::S_IFREG } { return Err("OUT_OF_SCOPE".into()); }
    let existing = entry_stat(&held, &to)?;
    let case_only = source.file_name().ok_or("INVALID_PATH")?.to_string_lossy().eq_ignore_ascii_case(new_name);
    if let Some(target_stat) = existing {
        if !case_only || target_stat.st_dev != before.st_dev || target_stat.st_ino != before.st_ino { return Err("TARGET_EXISTS".into()); }
    }
    let rename = |from: &std::ffi::CString, to: &std::ffi::CString| unsafe {
        libc::renameatx_np(held.as_raw_fd(), from.as_ptr(), held.as_raw_fd(), to.as_ptr(), libc::RENAME_EXCL)
    };
    if existing.is_some() {
        let staging = entry_name(std::ffi::OsStr::new(&format!(".mino-rename-{}-{}", std::process::id(), NEXT_ENTRY.fetch_add(1, Ordering::Relaxed))))?;
        if rename(&from, &staging) < 0 { return Err("IO_ERROR".into()); }
        if rename(&staging, &to) < 0 {
            if rename(&staging, &from) < 0 { return Err("COMMIT_UNCERTAIN".into()); }
            return Err("TARGET_EXISTS".into());
        }
    } else if rename(&from, &to) < 0 {
        return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists { "TARGET_EXISTS" } else { "IO_ERROR" }.into());
    }
    held.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    same_directory(parent, &held)?;
    let after = entry_stat(&held, &to)?.ok_or("COMMIT_UNCERTAIN")?;
    if after.st_dev != before.st_dev || after.st_ino != before.st_ino { return Err("COMMIT_UNCERTAIN".into()); }
    Ok(target)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn rename_entry_at(_source: &Path, _new_name: &str, _directory: bool) -> Result<PathBuf, String> { Err("UNSUPPORTED_PLATFORM".into()) }

/// Moves `source` into the folder `target_parent` under the same name, never replacing an entry there.
/// Both folders are held open and checked again afterwards, as in `rename_entry_at`.
#[cfg(target_os = "macos")]
fn move_entry_at(source: &Path, target_parent: &Path, directory: bool) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    let parent = source.parent().ok_or("INVALID_PATH")?;
    let from_dir = directory_handle(parent)?;
    let to_dir = directory_handle(target_parent)?;
    let name = entry_name(source.file_name().ok_or("INVALID_PATH")?)?;
    let before = entry_stat(&from_dir, &name)?.ok_or("NOT_FOUND")?;
    if before.st_mode & libc::S_IFMT != if directory { libc::S_IFDIR } else { libc::S_IFREG } { return Err("OUT_OF_SCOPE".into()); }
    if entry_stat(&to_dir, &name)?.is_some() { return Err("TARGET_EXISTS".into()); }
    if unsafe { libc::renameatx_np(from_dir.as_raw_fd(), name.as_ptr(), to_dir.as_raw_fd(), name.as_ptr(), libc::RENAME_EXCL) } < 0 {
        let error = std::io::Error::last_os_error();
        return Err(match error.raw_os_error() {
            Some(libc::EEXIST) => "TARGET_EXISTS",
            Some(libc::EXDEV) => "CROSS_DEVICE",
            Some(libc::EINVAL) => "INVALID_TARGET",
            _ => "IO_ERROR",
        }.into());
    }
    from_dir.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    to_dir.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    same_directory(parent, &from_dir)?;
    same_directory(target_parent, &to_dir)?;
    let after = entry_stat(&to_dir, &name)?.ok_or("COMMIT_UNCERTAIN")?;
    if after.st_dev != before.st_dev || after.st_ino != before.st_ino { return Err("COMMIT_UNCERTAIN".into()); }
    Ok(target_parent.join(source.file_name().ok_or("INVALID_PATH")?))
}

#[cfg(not(target_os = "macos"))]
fn move_entry_at(_source: &Path, _target_parent: &Path, _directory: bool) -> Result<PathBuf, String> { Err("UNSUPPORTED_PLATFORM".into()) }
fn checked_path(grant: &EntryGrant) -> Result<PathBuf, String> {
    let meta = fs::symlink_metadata(&grant.path).map_err(|_| "NOT_FOUND")?;
    if meta.file_type().is_symlink() || (grant.directory && !meta.is_dir()) || (!grant.directory && !meta.is_file()) { return Err("OUT_OF_SCOPE".into()); }
    let canonical = fs::canonicalize(&grant.path).map_err(|_| "NOT_FOUND")?;
    if !canonical.starts_with(&grant.root) { return Err("OUT_OF_SCOPE".into()); }
    Ok(canonical)
}
fn list_at(store: &WorkspaceStore, token: &str, offset: usize) -> Result<ChildrenPage, String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(token).cloned().ok_or("OUT_OF_SCOPE")?;
    if !grant.directory { return Err("OUT_OF_SCOPE".into()); }
    let directory = checked_path(&grant)?;
    let mut children = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|_| "PERMISSION_DENIED")? {
        let entry = entry.map_err(|_| "IO_ERROR")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if ignored(&name) { continue; }
        let path = entry.path();
        // The type comes with the directory entry and, like `lstat`, describes a link itself, never its target.
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() || !(kind.is_dir() || kind.is_file() && is_document(&path)) { continue; }
        children.push((name, path, kind.is_dir()));
    }
    // Folders first, then by name without regard to case; the lowercase names are made once, not for every comparison (T100).
    children.sort_by_cached_key(|(name, _, directory)| (!*directory, name.to_lowercase(), name.clone()));
    let total = children.len();
    let current_paths: HashSet<_> = children.iter().map(|(_, path, directory)| (path.clone(), *directory)).collect();
    let page = children.into_iter().skip(offset).take(PAGE_SIZE).collect::<Vec<_>>();
    let mut entries = Vec::with_capacity(page.len());
    let mut map = store.0.lock().map_err(|_| "IO_ERROR")?;
    let stale_directories = map.values().filter(|entry| {
        entry.workspace == grant.workspace && entry.directory && entry.path.parent() == Some(directory.as_path()) && !current_paths.contains(&(entry.path.clone(), true))
    }).map(|entry| entry.path.clone()).collect::<Vec<_>>();
    map.retain(|_, entry| {
        if entry.workspace != grant.workspace { return true; }
        if stale_directories.iter().any(|path| entry.path.starts_with(path)) { return false; }
        entry.path.parent() != Some(directory.as_path()) || current_paths.contains(&(entry.path.clone(), entry.directory))
    });
    let mut existing = HashMap::new();
    for (token, entry) in map.iter() {
        if entry.workspace == grant.workspace {
            existing.insert((entry.path.clone(), entry.directory), token.clone());
        }
    }
    for (name, path, directory) in page {
        let token = existing.get(&(path.clone(), directory)).cloned().unwrap_or_else(|| format!("entry-{}", NEXT_ENTRY.fetch_add(1, Ordering::Relaxed)));
        map.insert(token.clone(), EntryGrant { workspace: grant.workspace.clone(), root: grant.root.clone(), path, directory });
        entries.push(WorkspaceEntry { token, name, directory });
    }
    let next_offset = if offset + entries.len() < total { Some(offset + entries.len()) } else { None };
    Ok(ChildrenPage { entries, next_offset })
}

#[tauri::command]
pub async fn choose_workspace(app: AppHandle, window: WebviewWindow, store: State<'_, WorkspaceStore>) -> Result<Option<WorkspaceRoot>, String> {
    crate::require_workspace_window(&window)?;
    let Some(selected) = app.dialog().file().blocking_pick_folder() else { return Ok(None); };
    let path = fs::canonicalize(selected.into_path().map_err(|_| "INVALID_PATH")?).map_err(|_| "NOT_FOUND")?;
    if !fs::metadata(&path).map_err(|_| "NOT_FOUND")?.is_dir() { return Err("INVALID_PATH".into()); }
    Ok(Some(register_workspace(&store, path)?))
}

pub(crate) fn register_workspace(store: &WorkspaceStore, path: PathBuf) -> Result<WorkspaceRoot, String> {
    let path = fs::canonicalize(path).map_err(|_| "NOT_FOUND")?;
    if !fs::metadata(&path).map_err(|_| "NOT_FOUND")?.is_dir() { return Err("INVALID_PATH".into()); }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    let mut map = store.0.lock().map_err(|_| "IO_ERROR")?;
    // Several folders can be open at once (T79); opening one again returns its existing grant.
    if let Some(token) = map.iter().find(|(token, entry)| entry.workspace == **token && entry.path == path).map(|(token, _)| token.clone()) { return Ok(WorkspaceRoot { token, name }); }
    let token = format!("workspace-{}", NEXT_ENTRY.fetch_add(1, Ordering::Relaxed));
    map.insert(token.clone(), EntryGrant { workspace: token.clone(), root: path.clone(), path, directory: true });
    Ok(WorkspaceRoot { token, name })
}

/// The checked path of any sidebar entry, file or folder, and whether it is a folder (T105).
pub(crate) fn entry_path(store: &WorkspaceStore, token: &str) -> Result<(PathBuf, bool), String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(token).cloned().ok_or("OUT_OF_SCOPE")?;
    Ok((checked_path(&grant)?, grant.directory))
}

/// Follows a rename or move, made in the sidebar or from a tab: the entry and, for a folder, every entry below it
/// keep their tokens. An open folder inside a moved one moves with it, so roots are rewritten too. An entry that
/// lands outside its open folder belongs from then on to `adopt`, the open folder it was moved under.
fn relocate_entries_into(store: &WorkspaceStore, old: &Path, new: &Path, adopt: Option<(&str, &Path)>) -> Result<(), String> {
    for entry in store.0.lock().map_err(|_| "IO_ERROR")?.values_mut() {
        if let Some(root) = moved_path(&entry.root, old, new) { entry.root = root; }
        let Some(path) = moved_path(&entry.path, old, new) else { continue };
        entry.path = path;
        if let Some((workspace, root)) = adopt {
            if !entry.path.starts_with(&entry.root) { entry.workspace = workspace.to_string(); entry.root = root.to_path_buf(); }
        }
    }
    Ok(())
}

pub(crate) fn relocate_entries(store: &WorkspaceStore, old: &Path, new: &Path) -> Result<(), String> { relocate_entries_into(store, old, new, None) }

pub(crate) fn forget_entries(store: &WorkspaceStore, path: &Path) -> Result<(), String> {
    store.0.lock().map_err(|_| "IO_ERROR")?.retain(|_, entry| entry.directory || entry.path != path);
    Ok(())
}

pub(crate) fn workspace_path(store: &WorkspaceStore, token: &str) -> Result<PathBuf, String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.workspace != token { return Err("OUT_OF_SCOPE".into()); }
    checked_path(&grant)
}
#[tauri::command(async)]
pub fn list_children(window: WebviewWindow, store: State<'_, WorkspaceStore>, directory_token: String, offset: usize) -> Result<ChildrenPage, String> {
    crate::require_workspace_window(&window)?;
    list_at(&store, &directory_token, offset)
}
#[tauri::command(async)]
pub fn open_workspace_document(window: WebviewWindow, workspace: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String) -> Result<OpenDocument, String> {
    crate::require_workspace_window(&window)?;
    let grant = workspace.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.directory { return Err("OUT_OF_SCOPE".into()); }
    let path = checked_path(&grant)?;
    open_granted_path(&documents, &path)
}
#[tauri::command]
pub fn release_workspace(window: WebviewWindow, store: State<'_, WorkspaceStore>, token: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let mut map = store.0.lock().map_err(|_| "IO_ERROR")?;
    if !map.get(&token).is_some_and(|entry| entry.workspace == token) { return Err("OUT_OF_SCOPE".into()); }
    map.retain(|_, entry| entry.workspace != token);
    Ok(())
}

#[tauri::command(async)]
pub fn create_workspace_entry(window: WebviewWindow, store: State<'_, WorkspaceStore>, parent_token: String, name: String, directory: bool) -> Result<WorkspaceEntry, String> {
    crate::require_workspace_window(&window)?;
    if !valid_name(&name, directory) { return Err("INVALID_NAME".into()); }
    let parent_grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(&parent_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if !parent_grant.directory { return Err("OUT_OF_SCOPE".into()); }
    let parent = checked_path(&parent_grant)?;
    let path = parent.join(&name);
    create_entry_at(&parent, &name, directory)?;
    let token = format!("entry-{}", NEXT_ENTRY.fetch_add(1, Ordering::Relaxed));
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), EntryGrant { workspace: parent_grant.workspace, root: parent_grant.root, path, directory });
    Ok(WorkspaceEntry { token, name, directory })
}

#[tauri::command(async)]
pub fn rename_workspace_entry(app: AppHandle, window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String, new_name: String) -> Result<WorkspaceEntry, String> {
    crate::require_workspace_window(&window)?;
    let (entry, source, target) = rename_entry(&store, &documents, entry_token, new_name)?;
    crate::positions::relocate(&app, &source, &target);
    Ok(entry)
}

fn rename_entry(store: &WorkspaceStore, documents: &DocumentStore, entry_token: String, new_name: String) -> Result<(WorkspaceEntry, PathBuf, PathBuf), String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.path == grant.root || !valid_rename(&grant.path, &new_name, grant.directory) { return Err("INVALID_NAME".into()); }
    let source = checked_path(&grant)?;
    // A folder is renamed with everything in it; open files inside it and expanded subfolders follow it.
    let target = relocating(documents, &source, || rename_entry_at(&source, &new_name, grant.directory))?;
    relocate_entries(store, &source, &target)?;
    Ok((WorkspaceEntry { token: entry_token, name: new_name, directory: grant.directory }, source, target))
}

/// Drags a file, or a folder with everything in it, into another folder of the sidebar (T109), possibly one
/// under another open folder. The entry, the entries below it and the open documents inside keep their tokens.
#[tauri::command(async)]
pub fn move_workspace_entry(app: AppHandle, window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String, target_token: String) -> Result<WorkspaceEntry, String> {
    crate::require_workspace_window(&window)?;
    let (entry, moved) = move_entry(&store, &documents, &entry_token, &target_token)?;
    if let Some((source, target)) = moved { crate::positions::relocate(&app, &source, &target); }
    Ok(entry)
}

/// The entry, and where it was moved from and to; `None` when it was already in the target folder.
fn move_entry(store: &WorkspaceStore, documents: &DocumentStore, entry_token: &str, target_token: &str) -> Result<(WorkspaceEntry, Option<(PathBuf, PathBuf)>), String> {
    let (grant, target_grant) = {
        let map = store.0.lock().map_err(|_| "IO_ERROR")?;
        (map.get(entry_token).cloned().ok_or("OUT_OF_SCOPE")?, map.get(target_token).cloned().ok_or("OUT_OF_SCOPE")?)
    };
    // An open folder is not moved; it is closed instead.
    if grant.path == grant.root || !target_grant.directory { return Err("OUT_OF_SCOPE".into()); }
    let source = checked_path(&grant)?;
    let target = checked_path(&target_grant)?;
    let name = source.file_name().ok_or("INVALID_PATH")?.to_string_lossy().into_owned();
    let entry = WorkspaceEntry { token: entry_token.to_string(), name, directory: grant.directory };
    if source.parent() == Some(target.as_path()) { return Ok((entry, None)); }
    // A folder cannot go into itself or into a folder inside it.
    if target.starts_with(&source) { return Err("INVALID_TARGET".into()); }
    let moved = relocating(documents, &source, || {
        // A Markdown file takes the images it shows along; a folder already holds its own `assets/`.
        let carried = if grant.directory { None } else { carry_assets(&source, &target)? };
        let moved = move_entry_at(&source, &target, grant.directory);
        if let Some(carried) = carried { if moved.is_ok() { carried.release() } else { carried.undo() } }
        moved
    })?;
    relocate_entries_into(store, &source, &moved, Some((&target_grant.workspace, &target_grant.root)))?;
    Ok((entry, Some((source, moved))))
}

#[cfg(target_os = "macos")]
pub(crate) fn move_to_trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    use std::os::unix::fs::MetadataExt;
    let before = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
    if before.file_type().is_symlink() || !(before.is_file() || before.is_dir()) { return Err("OUT_OF_SCOPE".into()); }
    let parent = path.parent().ok_or("INVALID_PATH")?;
    let held = directory_handle(parent)?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str().ok_or("INVALID_PATH")?));
    let reference = url.fileReferenceURL().ok_or("TRASH_FAILED")?;
    let current_url = reference.filePathURL().ok_or("TRASH_FAILED")?;
    let current_path = current_url.path().ok_or("TRASH_FAILED")?.to_string();
    if fs::canonicalize(&current_path).map_err(|_| "OUT_OF_SCOPE")? != path { return Err("OUT_OF_SCOPE".into()); }
    let current = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
    if current.file_type().is_symlink() || before.dev() != current.dev() || before.ino() != current.ino() { return Err("OUT_OF_SCOPE".into()); }
    same_directory(parent, &held)?;
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&reference, None).map_err(|_| "TRASH_FAILED".into())
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn move_to_trash(_path: &Path) -> Result<(), String> { Err("UNSUPPORTED_PLATFORM".into()) }

/// What removing an entry takes with it: the sidebar entries and the open documents at or inside its path.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EntryContents { entry_tokens: Vec<String>, document_tokens: Vec<String> }

fn contents_at(store: &WorkspaceStore, documents: &DocumentStore, entry_token: &str) -> Result<EntryContents, String> {
    let entries = store.0.lock().map_err(|_| "IO_ERROR")?;
    let path = entries.get(entry_token).ok_or("OUT_OF_SCOPE")?.path.clone();
    let mut entry_tokens: Vec<String> = entries.iter().filter(|(_, item)| item.path.starts_with(&path)).map(|(token, _)| token.clone()).collect();
    drop(entries);
    let mut document_tokens = grants_within(documents, &path)?;
    entry_tokens.sort();
    document_tokens.sort();
    Ok(EntryContents { entry_tokens, document_tokens })
}

/// Lets the frontend close the tabs of files inside a folder before the folder goes to the Trash. It names tokens only, never paths.
#[tauri::command(async)]
pub fn workspace_entry_contents(window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String) -> Result<EntryContents, String> {
    crate::require_workspace_window(&window)?;
    contents_at(&store, &documents, &entry_token)
}

/// Ends the grants of an entry that left the disk and of everything that was inside it.
fn forget_within(store: &WorkspaceStore, documents: &DocumentStore, path: &Path) -> Result<(), String> {
    store.0.lock().map_err(|_| "IO_ERROR")?.retain(|_, item| !item.path.starts_with(path));
    forget_grants(documents, path)
}

/// Moves a file, or a folder with everything in it, to the Trash. The Trash keeps it whole, so it can be put back.
/// The open folder itself is closed rather than trashed.
#[tauri::command(async)]
pub fn trash_workspace_entry(window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.path == grant.root { return Err("OUT_OF_SCOPE".into()); }
    let path = checked_path(&grant)?;
    removing(&documents, &path, || move_to_trash(&path))?;
    forget_within(&store, &documents, &path)
}

fn snippet_around(line: &str, match_char: usize) -> String {
    let start = match_char.saturating_sub(SNIPPET_CHARS / 3);
    line.chars().skip(start).take(SNIPPET_CHARS).collect::<String>().trim().to_owned()
}

struct FileHit { path: PathBuf, relative: String, line: usize, snippet: String, occurrence: usize }

/// Appends this document's matches, at most `MAX_HITS_PER_FILE`. `occurrence` counts every match before the hit.
fn search_text(text: &str, query: &str, path: &Path, relative: &str, hits: &mut Vec<FileHit>) {
    if !text.to_lowercase().contains(query) { return; }
    let mut occurrence = 0;
    let mut found = 0;
    for (index, raw) in text.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        let lower = line.to_lowercase();
        let mut from = 0;
        while let Some(at) = lower[from..].find(query) {
            let start = from + at;
            hits.push(FileHit { path: path.to_owned(), relative: relative.to_owned(), line: index + 1, snippet: snippet_around(line, lower[..start].chars().count()), occurrence });
            occurrence += 1;
            found += 1;
            if found == MAX_HITS_PER_FILE || hits.len() > MAX_SEARCH_HITS { return; }
            from = start + query.len();
        }
    }
}

/// Reads no file outside the granted root: it never follows links and rechecks each directory it enters.
fn search_at(store: &WorkspaceStore, root_token: &str, query: &str, canceled: impl Fn() -> bool) -> Result<SearchResults, String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(root_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.workspace != root_token || !grant.directory { return Err("OUT_OF_SCOPE".into()); }
    let root = checked_path(&grant)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() { return Ok(SearchResults::default()); }
    if query.chars().count() > MAX_SEARCH_QUERY_CHARS { return Err("INVALID_QUERY".into()); }
    let mut pending = vec![root.clone()];
    let mut hits: Vec<FileHit> = Vec::new();
    let mut skipped = 0;
    'walk: while let Some(directory) = pending.pop() {
        if canceled() { return Err("SEARCH_CANCELED".into()); }
        if fs::canonicalize(&directory).ok().as_deref() != Some(directory.as_path()) || !directory.starts_with(&root) { skipped += 1; continue; }
        let Ok(reader) = fs::read_dir(&directory) else { skipped += 1; continue };
        let mut names = reader.flatten().map(|entry| entry.file_name()).collect::<Vec<_>>();
        names.sort();
        let mut directories = Vec::new();
        for name in names {
            if canceled() { return Err("SEARCH_CANCELED".into()); }
            if ignored(&name.to_string_lossy()) { continue; }
            let path = directory.join(&name);
            let Ok(meta) = fs::symlink_metadata(&path) else { continue };
            if meta.file_type().is_symlink() { continue; }
            if meta.is_dir() { directories.push(path); continue; }
            if !meta.is_file() || !file_kinds::is_text_path(&path) { continue; }
            if meta.len() > MAX_SEARCH_DOCUMENT { skipped += 1; continue; }
            let Ok(bytes) = crate::fs::bounded_file::read_no_follow(&path, MAX_SEARCH_DOCUMENT) else { skipped += 1; continue };
            let Ok(text) = crate::text_encoding::decode(&bytes).map(|decoded| decoded.text) else { skipped += 1; continue };
            let relative = path.strip_prefix(&root).map_err(|_| "OUT_OF_SCOPE")?.to_string_lossy().into_owned();
            search_text(text.strip_prefix('\u{feff}').unwrap_or(&text), &query, &path, &relative, &mut hits);
            if hits.len() > MAX_SEARCH_HITS { break 'walk; }
        }
        pending.extend(directories.into_iter().rev());
    }
    let truncated = hits.len() > MAX_SEARCH_HITS;
    hits.truncate(MAX_SEARCH_HITS);
    if canceled() { return Err("SEARCH_CANCELED".into()); }
    let mut map = store.0.lock().map_err(|_| "IO_ERROR")?;
    let mut existing: HashMap<PathBuf, String> = map.iter().filter(|(_, entry)| entry.workspace == grant.workspace && !entry.directory).map(|(token, entry)| (entry.path.clone(), token.clone())).collect();
    let mut results = Vec::with_capacity(hits.len());
    for hit in hits {
        let token = existing.entry(hit.path.clone()).or_insert_with(|| format!("entry-{}", NEXT_ENTRY.fetch_add(1, Ordering::Relaxed))).clone();
        let name = hit.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        map.entry(token.clone()).or_insert_with(|| EntryGrant { workspace: grant.workspace.clone(), root: grant.root.clone(), path: hit.path.clone(), directory: false });
        results.push(SearchHit { token, name, path: hit.relative, line: hit.line, snippet: hit.snippet, occurrence: hit.occurrence });
    }
    Ok(SearchResults { hits: results, truncated, skipped })
}

/// An empty query is how the frontend stops a search that is still running.
#[tauri::command(async)]
pub fn search_workspace(window: WebviewWindow, store: State<'_, WorkspaceStore>, searches: State<'_, SearchState>, root_token: String, query: String) -> Result<SearchResults, String> {
    crate::require_workspace_window(&window)?;
    let counter = searches.0.lock().map_err(|_| "IO_ERROR")?.entry(window.label().to_owned()).or_default().clone();
    let current = counter.fetch_add(1, Ordering::SeqCst) + 1;
    search_at(&store, &root_token, &query, || counter.load(Ordering::SeqCst) != current)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn searched(store: &WorkspaceStore, token: &str, query: &str) -> SearchResults { search_at(store, token, query, || false).unwrap() }
    #[test]
    fn search_finds_text_case_insensitively_with_context() {
        let dir = temp();
        fs::create_dir(dir.join("子目录")).unwrap();
        fs::write(dir.join("a.md"), "第一行\r\n这里有 Mino 和 mino\r\n").unwrap();
        fs::write(dir.join("子目录/b.markdown"), "\u{feff}只有 MINO").unwrap();
        fs::write(dir.join("c.docx"), "mino").unwrap();
        fs::write(dir.join("d.pdf"), "%PDF-1.4 mino").unwrap();
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let results = searched(&store, &root.token, "  mInO ");
        let found = results.hits.iter().map(|hit| (hit.path.as_str(), hit.line, hit.occurrence)).collect::<Vec<_>>();
        assert_eq!(found, vec![("a.md", 2, 0), ("a.md", 2, 1), ("子目录/b.markdown", 1, 0)]);
        assert_eq!(results.hits[0].snippet, "这里有 Mino 和 mino");
        assert!(!results.truncated);
        let grant = store.0.lock().unwrap().get(&results.hits[0].token).cloned().unwrap();
        assert!(!grant.directory);
        assert_eq!(results.hits[0].token, results.hits[1].token);
        let again = searched(&store, &root.token, "mino");
        assert_eq!(again.hits[0].token, results.hits[0].token);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn search_skips_ignored_oversized_and_non_utf8_files() {
        let dir = temp();
        for ignored_dir in [".git", "node_modules", "assets", "target"] {
            fs::create_dir(dir.join(ignored_dir)).unwrap();
            fs::write(dir.join(ignored_dir).join("hidden.md"), "needle").unwrap();
        }
        fs::write(dir.join(".secret.md"), "needle").unwrap();
        fs::write(dir.join("binary.md"), [0x00, 0x01, b'n', b'e', b'e', b'd', b'l', b'e']).unwrap();
        let big = fs::File::create(dir.join("big.md")).unwrap();
        big.set_len(MAX_SEARCH_DOCUMENT + 1).unwrap();
        fs::write(dir.join("visible.md"), "needle").unwrap();
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let results = searched(&store, &root.token, "needle");
        assert_eq!(results.hits.iter().map(|hit| hit.path.as_str()).collect::<Vec<_>>(), vec!["visible.md"]);
        assert_eq!(results.skipped, 2);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn search_covers_text_and_source_files_in_their_own_encoding() {
        let dir = temp();
        let (gbk, _, _) = encoding_rs::GB18030.encode("第一章\n这里提到了灯塔和海岸线，还有很多别的内容用来让编码识别更可靠。\n");
        fs::write(dir.join("novel.txt"), &gbk).unwrap();
        fs::write(dir.join("config.yaml"), "name: 灯塔\n").unwrap();
        let utf16: Vec<u8> = [0xff, 0xfe].into_iter().chain("notes about 灯塔\n".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        fs::write(dir.join("notes.log"), utf16).unwrap();
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let results = searched(&store, &root.token, "灯塔");
        assert_eq!(results.hits.iter().map(|hit| (hit.path.as_str(), hit.line)).collect::<Vec<_>>(), vec![("config.yaml", 1), ("notes.log", 1), ("novel.txt", 2)]);
        assert_eq!(results.skipped, 0);
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn search_does_not_follow_links_or_accept_other_roots() {
        let dir = temp();
        let outside = temp();
        fs::write(outside.join("secret.md"), "needle").unwrap();
        fs::write(dir.join("inside.md"), "needle").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), dir.join("link.md")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("linked-dir")).unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        assert_eq!(searched(&store, &root.token, "needle").hits.iter().map(|hit| hit.path.as_str()).collect::<Vec<_>>(), vec!["inside.md"]);
        let child = list_at(&store, &root.token, 0).unwrap().entries.remove(0);
        assert_eq!(search_at(&store, &child.token, "needle", || false).err(), Some("OUT_OF_SCOPE".to_owned()));
        assert_eq!(search_at(&store, "unknown", "needle", || false).err(), Some("OUT_OF_SCOPE".to_owned()));
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
    #[test]
    fn search_stops_at_the_limit_and_when_canceled() {
        let dir = temp();
        for index in 0..110 { fs::write(dir.join(format!("{index:03}.md")), "needle\n".repeat(9)).unwrap(); }
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let results = searched(&store, &root.token, "needle");
        assert_eq!(results.hits.len(), MAX_SEARCH_HITS);
        assert!(results.truncated);
        assert_eq!(results.hits[0].occurrence, 0);
        assert_eq!(results.hits[4].occurrence, 4);
        assert_eq!(results.hits[5].path, "001.md");
        assert_eq!(search_at(&store, &root.token, "needle", || true).err(), Some("SEARCH_CANCELED".to_owned()));
        assert!(searched(&store, &root.token, "   ").hits.is_empty());
        assert_eq!(search_at(&store, &root.token, &"x".repeat(257), || false).err(), Some("INVALID_QUERY".to_owned()));
        fs::remove_dir_all(dir).unwrap();
    }
    /// `MINO_SEARCH_FIXTURES=dist-package/performance-fixtures/directory cargo test --lib search_fixture -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn search_fixture_timing() {
        let dir = fs::canonicalize(std::env::var("MINO_SEARCH_FIXTURES").unwrap()).unwrap();
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir).unwrap();
        for query in ["Synthetic", "不存在的查询内容"] {
            let started = std::time::Instant::now();
            let results = searched(&store, &root.token, query);
            println!("query={query} hits={} truncated={} skipped={} elapsed_ms={}", results.hits.len(), results.truncated, results.skipped, started.elapsed().as_millis());
        }
    }
    /// A folder goes to the Trash with everything in it: the tabs of files anywhere inside it are named so they can
    /// be closed first, and every grant at or below it ends. A sibling whose name starts the same is left alone.
    #[test]
    fn removing_a_folder_covers_everything_inside_it() {
        let dir = fs::canonicalize(temp()).unwrap();
        fs::create_dir_all(dir.join("sub/deep")).unwrap();
        fs::create_dir(dir.join("sub-other")).unwrap();
        for file in ["sub/a.md", "sub/deep/b.md", "c.md", "sub-other/d.md"] { fs::write(dir.join(file), "# x\n").unwrap(); }
        let store = WorkspaceStore::default();
        let documents = DocumentStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let token_of = |name: &str| store.0.lock().unwrap().iter().find(|(_, item)| item.path == dir.join(name)).map(|(token, _)| token.clone());
        list_at(&store, &root.token, 0).unwrap();
        let sub = token_of("sub").unwrap();
        list_at(&store, &sub, 0).unwrap();
        list_at(&store, &token_of("sub/deep").unwrap(), 0).unwrap();
        list_at(&store, &token_of("sub-other").unwrap(), 0).unwrap();
        for file in ["sub/a.md", "sub/deep/b.md", "c.md", "sub-other/d.md"] { open_granted_path(&documents, &dir.join(file)).unwrap(); }

        let contents = contents_at(&store, &documents, &sub).unwrap();
        let mut expected: Vec<String> = ["sub", "sub/a.md", "sub/deep", "sub/deep/b.md"].iter().map(|name| token_of(name).unwrap()).collect();
        expected.sort();
        assert_eq!(contents.entry_tokens, expected);
        let mut inside = [grants_within(&documents, &dir.join("sub/a.md")).unwrap(), grants_within(&documents, &dir.join("sub/deep/b.md")).unwrap()].concat();
        inside.sort();
        assert_eq!(contents.document_tokens, inside);
        assert_eq!(inside.len(), 2);

        forget_within(&store, &documents, &dir.join("sub")).unwrap();
        assert!(store.0.lock().unwrap().values().all(|item| !item.path.starts_with(dir.join("sub"))));
        assert!(token_of("sub-other/d.md").is_some() && token_of("c.md").is_some());
        assert!(grants_within(&documents, &dir.join("sub")).unwrap().is_empty());
        assert_eq!(grants_within(&documents, &dir).unwrap().len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }
    /// A folder with files in it can be renamed: open files inside it, at any depth, keep working at the new
    /// place, sidebar entries below it keep their tokens, and a sibling whose name starts the same is left alone.
    #[cfg(target_os = "macos")]
    #[test]
    fn renaming_a_folder_moves_everything_inside_it() {
        let dir = fs::canonicalize(temp()).unwrap();
        fs::create_dir_all(dir.join("sub/deep")).unwrap();
        fs::create_dir(dir.join("sub-other")).unwrap();
        for file in ["sub/a.md", "sub/deep/b.md", "sub-other/d.md"] { fs::write(dir.join(file), format!("# {file}\n")).unwrap(); }
        let store = WorkspaceStore::default();
        let documents = DocumentStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let token_of = |path: &Path| store.0.lock().unwrap().iter().find(|(_, item)| item.path == path).map(|(token, _)| token.clone());
        list_at(&store, &root.token, 0).unwrap();
        let sub = token_of(&dir.join("sub")).unwrap();
        list_at(&store, &sub, 0).unwrap();
        let deep = token_of(&dir.join("sub/deep")).unwrap();
        list_at(&store, &deep, 0).unwrap();
        list_at(&store, &token_of(&dir.join("sub-other")).unwrap(), 0).unwrap();
        for file in ["sub/a.md", "sub/deep/b.md", "sub-other/d.md"] { open_granted_path(&documents, &dir.join(file)).unwrap(); }
        let opened = grants_within(&documents, &dir.join("sub/deep/b.md")).unwrap().pop().unwrap();

        let renamed = rename_entry(&store, &documents, sub.clone(), "新名字".into()).unwrap().0;
        assert_eq!((renamed.token.as_str(), renamed.name.as_str(), renamed.directory), (sub.as_str(), "新名字", true));
        assert!(!dir.join("sub").exists());
        assert_eq!(fs::read_to_string(dir.join("新名字/deep/b.md")).unwrap(), "# sub/deep/b.md\n");
        // The open file inside the folder is found at its new place, through the same token.
        assert_eq!(crate::documents::granted_file(&documents, &opened).unwrap(), dir.join("新名字/deep/b.md"));
        assert_eq!(grants_within(&documents, &dir.join("新名字")).unwrap().len(), 2);
        assert!(grants_within(&documents, &dir.join("sub")).unwrap().is_empty());
        assert_eq!(token_of(&dir.join("新名字/deep")), Some(deep.clone()));
        assert!(list_at(&store, &deep, 0).is_ok());
        assert!(token_of(&dir.join("sub-other/d.md")).is_some());
        assert_eq!(grants_within(&documents, &dir.join("sub-other")).unwrap().len(), 1);
        // The open folder itself is not renamed from inside.
        assert_eq!(rename_entry(&store, &documents, root.token.clone(), "x".into()).err(), Some("INVALID_NAME".into()));
        fs::remove_dir_all(dir).unwrap();
    }
    /// Files and folders are dragged into other folders, also under another open folder: tokens and open files
    /// follow them, a name already there is not replaced, and a folder cannot go into itself.
    #[cfg(target_os = "macos")]
    /// A Markdown file moved to another folder takes its `assets/` images along: copied into the target's
    /// `assets/` (made when missing), and in the old folder only an image another file there still uses stays; an
    /// emptied `assets/` goes too (T109).
    #[test]
    fn a_moved_markdown_file_takes_its_images_along() {
        let dir = fs::canonicalize(temp()).unwrap();
        fs::create_dir_all(dir.join("assets")).unwrap();
        fs::create_dir_all(dir.join("box/assets")).unwrap();
        fs::create_dir(dir.join("clash")).unwrap();
        fs::create_dir(dir.join("clash/assets")).unwrap();
        fs::write(dir.join("assets/own.png"), b"own").unwrap();
        fs::write(dir.join("assets/shared.png"), b"shared").unwrap();
        fs::write(dir.join("assets/same.png"), b"same").unwrap();
        fs::write(dir.join("box/assets/same.png"), b"same").unwrap();
        fs::write(dir.join("clash/assets/own.png"), b"other").unwrap();
        fs::write(dir.join("a.md"), "![](assets/own.png)\n![](./assets/shared.png)\n![](assets/same.png)\n![](assets/missing.png)\n![](https://example.com/x.png)\n").unwrap();
        fs::write(dir.join("b.md"), "![](assets/shared.png)\n").unwrap();
        let store = WorkspaceStore::default();
        let documents = DocumentStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        list_at(&store, &root.token, 0).unwrap();
        let token_of = |path: &Path| store.0.lock().unwrap().iter().find(|(_, item)| item.path == path).map(|(token, _)| token.clone()).unwrap();
        let (a, boxed, clash) = (token_of(&dir.join("a.md")), token_of(&dir.join("box")), token_of(&dir.join("clash")));

        // An image of the same name with other bytes in the target stops the move before anything is written.
        assert_eq!(move_entry(&store, &documents, &a, &clash).err(), Some("ASSET_CONFLICT".into()));
        assert!(dir.join("a.md").is_file() && !dir.join("clash/a.md").exists());
        assert_eq!(fs::read(dir.join("clash/assets/own.png")).unwrap(), b"other");
        assert!(!dir.join("clash/assets/shared.png").exists());

        move_entry(&store, &documents, &a, &boxed).unwrap();
        assert!(dir.join("box/a.md").is_file());
        for (name, bytes) in [("own.png", &b"own"[..]), ("shared.png", b"shared"), ("same.png", b"same")] { assert_eq!(fs::read(dir.join("box/assets").join(name)).unwrap(), bytes); }
        assert!(!dir.join("box/assets/missing.png").exists());
        // Unused in the old folder now, so moved to the Trash; b.md still shows shared.png.
        assert!(!dir.join("assets/own.png").exists() && !dir.join("assets/same.png").exists());
        assert_eq!(fs::read(dir.join("assets/shared.png")).unwrap(), b"shared");
        // The document itself is unchanged.
        assert!(fs::read_to_string(dir.join("box/a.md")).unwrap().starts_with("![](assets/own.png)\n"));
        assert!(dir.join("assets").is_dir());

        // The only document of a folder: a target without `assets/` gets one, and the emptied old one
        // (Finder's `.DS_Store` aside) goes to the Trash.
        fs::create_dir_all(dir.join("solo/assets")).unwrap();
        fs::create_dir(dir.join("fresh")).unwrap();
        fs::write(dir.join("solo/assets/x.png"), b"x").unwrap();
        fs::write(dir.join("solo/assets/.DS_Store"), b"ds").unwrap();
        fs::write(dir.join("solo/s.md"), "![](assets/x.png)\n").unwrap();
        list_at(&store, &root.token, 0).unwrap();
        list_at(&store, &token_of(&dir.join("solo")), 0).unwrap();
        move_entry(&store, &documents, &token_of(&dir.join("solo/s.md")), &token_of(&dir.join("fresh"))).unwrap();
        assert_eq!(fs::read(dir.join("fresh/assets/x.png")).unwrap(), b"x");
        assert!(!dir.join("solo/assets").exists() && dir.join("solo").is_dir());
        // A folder with something else in it stays.
        fs::create_dir_all(dir.join("keep/assets")).unwrap();
        fs::write(dir.join("keep/assets/y.png"), b"y").unwrap();
        fs::write(dir.join("keep/assets/notes.txt"), b"mine").unwrap();
        fs::write(dir.join("keep/k.md"), "![](assets/y.png)\n").unwrap();
        list_at(&store, &root.token, 0).unwrap();
        list_at(&store, &token_of(&dir.join("keep")), 0).unwrap();
        move_entry(&store, &documents, &token_of(&dir.join("keep/k.md")), &token_of(&dir.join("fresh"))).unwrap();
        assert!(!dir.join("keep/assets/y.png").exists() && dir.join("keep/assets/notes.txt").is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn moving_entries_into_other_folders() {
        let dir = fs::canonicalize(temp()).unwrap();
        let other = fs::canonicalize(temp()).unwrap();
        fs::create_dir_all(dir.join("sub/deep")).unwrap();
        fs::create_dir(dir.join("box")).unwrap();
        fs::create_dir(other.join("inbox")).unwrap();
        for file in ["sub/a.md", "sub/deep/b.md", "c.md", "box/c.md"] { fs::write(dir.join(file), format!("# {file}\n")).unwrap(); }
        let store = WorkspaceStore::default();
        let documents = DocumentStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let second = register_workspace(&store, other.clone()).unwrap();
        let token_of = |path: &Path| store.0.lock().unwrap().iter().find(|(_, item)| item.path == path).map(|(token, _)| token.clone());
        list_at(&store, &root.token, 0).unwrap();
        list_at(&store, &second.token, 0).unwrap();
        let sub = token_of(&dir.join("sub")).unwrap();
        let boxed = token_of(&dir.join("box")).unwrap();
        let inbox = token_of(&other.join("inbox")).unwrap();
        list_at(&store, &sub, 0).unwrap();
        let deep = token_of(&dir.join("sub/deep")).unwrap();
        list_at(&store, &deep, 0).unwrap();
        let a = token_of(&dir.join("sub/a.md")).unwrap();
        let c = token_of(&dir.join("c.md")).unwrap();
        open_granted_path(&documents, &dir.join("sub/deep/b.md")).unwrap();
        let opened = grants_within(&documents, &dir.join("sub/deep/b.md")).unwrap().pop().unwrap();

        // A file into a folder of the same open folder.
        let moved = move_entry(&store, &documents, &a, &boxed).unwrap().0;
        assert_eq!((moved.token.as_str(), moved.name.as_str(), moved.directory), (a.as_str(), "a.md", false));
        assert!(dir.join("box/a.md").is_file() && !dir.join("sub/a.md").exists());
        assert_eq!(token_of(&dir.join("box/a.md")), Some(a.clone()));
        // A name already in the target folder is kept, and the dragged file stays where it was.
        assert_eq!(move_entry(&store, &documents, &c, &boxed).err(), Some("TARGET_EXISTS".into()));
        assert_eq!(fs::read_to_string(dir.join("box/c.md")).unwrap(), "# box/c.md\n");
        assert!(dir.join("c.md").is_file());
        // Into its own folder again it is left alone.
        assert!(move_entry(&store, &documents, &c, &root.token).is_ok());
        assert!(dir.join("c.md").is_file());
        // A folder cannot go into itself or below itself, and the open folder itself is not moved.
        assert_eq!(move_entry(&store, &documents, &sub, &sub).err(), Some("INVALID_TARGET".into()));
        assert_eq!(move_entry(&store, &documents, &sub, &deep).err(), Some("INVALID_TARGET".into()));
        assert_eq!(move_entry(&store, &documents, &root.token, &boxed).err(), Some("OUT_OF_SCOPE".into()));
        // Nothing is moved into a file.
        assert_eq!(move_entry(&store, &documents, &sub, &c).err(), Some("OUT_OF_SCOPE".into()));

        // A folder into a folder of another open folder, with an open file inside it.
        move_entry(&store, &documents, &sub, &inbox).unwrap();
        assert!(!dir.join("sub").exists());
        assert_eq!(fs::read_to_string(other.join("inbox/sub/deep/b.md")).unwrap(), "# sub/deep/b.md\n");
        assert_eq!(crate::documents::granted_file(&documents, &opened).unwrap(), other.join("inbox/sub/deep/b.md"));
        assert_eq!(token_of(&other.join("inbox/sub/deep")), Some(deep.clone()));
        {
            let map = store.0.lock().unwrap();
            assert_eq!((map[&deep].workspace.as_str(), map[&deep].root.as_path()), (second.token.as_str(), other.as_path()));
        }
        assert!(list_at(&store, &deep, 0).is_ok());
        // Closing the first open folder leaves what now belongs to the second.
        store.0.lock().unwrap().retain(|_, entry| entry.workspace != root.token);
        assert!(token_of(&other.join("inbox/sub")).is_some());

        // An open folder inside a moved folder moves with it and keeps working.
        fs::create_dir_all(other.join("outer/opened")).unwrap();
        fs::write(other.join("outer/opened/e.md"), "# e\n").unwrap();
        list_at(&store, &second.token, 0).unwrap();
        let outer = token_of(&other.join("outer")).unwrap();
        let nested = register_workspace(&store, other.join("outer/opened")).unwrap();
        list_at(&store, &nested.token, 0).unwrap();
        let e = token_of(&other.join("outer/opened/e.md")).unwrap();
        move_entry(&store, &documents, &outer, &inbox).unwrap();
        assert_eq!(workspace_path(&store, &nested.token).unwrap(), other.join("inbox/outer/opened"));
        assert!(list_at(&store, &nested.token, 0).is_ok());
        assert_eq!(entry_path(&store, &e).unwrap().0, other.join("inbox/outer/opened/e.md"));
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(other).unwrap();
    }
    fn temp() -> PathBuf { let dir = std::env::temp_dir().join(format!("mino-workspace-test-{}-{}",std::process::id(),NEXT_ENTRY.fetch_add(1,Ordering::Relaxed))); fs::create_dir(&dir).unwrap(); dir }
    #[cfg(target_os = "macos")]
    #[test]
    fn workspace_create_and_rename_do_not_overwrite_existing_entries() {
        let dir = fs::canonicalize(temp()).unwrap();
        create_entry_at(&dir, "first.md", false).unwrap();
        create_entry_at(&dir, "taken.md", false).unwrap();
        fs::write(dir.join("first.md"), b"first").unwrap();
        fs::write(dir.join("taken.md"), b"taken").unwrap();
        assert_eq!(create_entry_at(&dir, "taken.md", false), Err("TARGET_EXISTS".into()));
        assert_eq!(rename_entry_at(&dir.join("first.md"), "taken.md", false), Err("TARGET_EXISTS".into()));
        assert_eq!(fs::read(dir.join("first.md")).unwrap(), b"first");
        assert_eq!(fs::read(dir.join("taken.md")).unwrap(), b"taken");
        let renamed = rename_entry_at(&dir.join("first.md"), "FIRST.md", false).unwrap();
        assert_eq!(renamed, dir.join("FIRST.md"));
        assert_eq!(fs::read(&renamed).unwrap(), b"first");
        create_entry_at(&dir, "folder", true).unwrap();
        assert_eq!(create_entry_at(&dir, "folder", true), Err("TARGET_EXISTS".into()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn workspace_entry_operations_reject_parent_link_and_target_link() {
        let dir = fs::canonicalize(temp()).unwrap();
        create_entry_at(&dir, "first.md", false).unwrap();
        std::os::unix::fs::symlink(dir.join("outside.md"), dir.join("link.md")).unwrap();
        assert_eq!(rename_entry_at(&dir.join("first.md"), "link.md", false), Err("TARGET_EXISTS".into()));
        let alias = dir.with_extension("alias");
        std::os::unix::fs::symlink(&dir, &alias).unwrap();
        assert_eq!(create_entry_at(&alias, "wrong.md", false), Err("OUT_OF_SCOPE".into()));
        assert!(!dir.join("wrong.md").exists());
        fs::remove_file(alias).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn ten_thousand_entries_are_paged_without_following_links_or_hidden_dirs() {
        let dir = temp();
        for i in 0..10_001 { fs::write(dir.join(format!("note-{i:05}.md")),b"x").unwrap(); }
        fs::write(dir.join("skip.docx"),b"x").unwrap();
        fs::create_dir(dir.join(".hidden")).unwrap();
        #[cfg(unix)] std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();
        let store = WorkspaceStore::default();
        let canonical = fs::canonicalize(&dir).unwrap();
        store.0.lock().unwrap().insert("root".into(), EntryGrant { workspace: "root".into(), root: canonical.clone(), path: canonical, directory: true });
        let first = list_at(&store,"root",0).unwrap();
        assert_eq!(first.entries.len(),200);
        assert_eq!(first.next_offset,Some(200));
        assert!(first.entries.iter().all(|e| !e.name.starts_with('.') && e.name != "loop"));
        let last = list_at(&store,"root",10_000).unwrap();
        assert_eq!(last.entries.len(),1);
        assert_eq!(last.next_offset,None);
        let refreshed = list_at(&store,"root",0).unwrap();
        assert_eq!(first.entries.iter().map(|entry| &entry.token).collect::<Vec<_>>(), refreshed.entries.iter().map(|entry| &entry.token).collect::<Vec<_>>());
        assert_eq!(store.0.lock().unwrap().len(), 202);
        fs::remove_file(dir.join("note-00000.md")).unwrap();
        list_at(&store, "root", 0).unwrap();
        assert!(!store.0.lock().unwrap().contains_key(&first.entries[0].token));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn refresh_revokes_deleted_directory_and_descendant_grants() {
        let dir = temp();
        fs::create_dir(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/note.md"), b"note").unwrap();
        let store = WorkspaceStore::default();
        let root = register_workspace(&store, dir.clone()).unwrap();
        let child = list_at(&store, &root.token, 0).unwrap().entries.remove(0);
        let nested = list_at(&store, &child.token, 0).unwrap().entries.remove(0);
        fs::remove_file(dir.join("sub/note.md")).unwrap();
        fs::remove_dir(dir.join("sub")).unwrap();
        list_at(&store, &root.token, 0).unwrap();
        let grants = store.0.lock().unwrap();
        assert!(grants.contains_key(&root.token));
        assert!(!grants.contains_key(&child.token));
        assert!(!grants.contains_key(&nested.token));
        drop(grants);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn several_folders_are_open_at_once_and_each_is_released_alone() {
        let (a, b) = (temp(), temp());
        fs::write(a.join("a.md"), "a").unwrap(); fs::write(b.join("b.md"), "b").unwrap();
        let store = WorkspaceStore::default();
        let first = register_workspace(&store, a.clone()).unwrap();
        let second = register_workspace(&store, b.clone()).unwrap();
        assert_ne!(first.token, second.token);
        assert_eq!(register_workspace(&store, a.clone()).unwrap().token, first.token, "the same folder is not granted twice");
        let in_a = list_at(&store, &first.token, 0).unwrap().entries; let in_b = list_at(&store, &second.token, 0).unwrap().entries;
        assert_eq!((in_a[0].name.as_str(), in_b[0].name.as_str()), ("a.md", "b.md"));
        store.0.lock().unwrap().retain(|_, entry| entry.workspace != first.token);
        assert_eq!(list_at(&store, &first.token, 0).err().as_deref(), Some("OUT_OF_SCOPE"));
        assert_eq!(list_at(&store, &in_a[0].token, 0).err().as_deref(), Some("OUT_OF_SCOPE"));
        assert_eq!(list_at(&store, &second.token, 0).unwrap().entries.len(), 1);
        assert!(workspace_path(&store, &second.token).is_ok());
        fs::remove_dir_all(a).unwrap(); fs::remove_dir_all(b).unwrap();
    }
    #[test]
    fn invalid_names_are_rejected() {
        for name in ["", ".hidden.md", "../bad.md", "a/b.md", "bad:one.md", "note.docx", "book.pdf", "noextension", " trailing.md "] { assert!(!valid_name(name,false), "{name}"); }
        for name in ["中文 文档.md", "note.txt", "config.yaml", "data.CSV", "server.log"] { assert!(valid_name(name,false), "{name}"); }
        assert!(valid_name("子目录",true));
    }
    #[test]
    fn a_rename_keeps_the_kind_of_the_file() {
        let (md, txt, pdf) = (Path::new("/w/a.md"), Path::new("/w/a.txt"), Path::new("/w/a.pdf"));
        assert!(valid_rename(md, "b.md", false) && valid_rename(md, "b.markdown", false) && valid_rename(txt, "b.text", false) && valid_rename(pdf, "手册 v2.pdf", false));
        for (current, name) in [(md, "b.txt"), (txt, "b.md"), (txt, "b.json"), (pdf, "b.txt"), (md, "b.pdf"), (pdf, "../b.pdf"), (pdf, ".b.pdf"), (pdf, "a/b.pdf"), (txt, "b")] { assert!(!valid_rename(current, name, false), "{name}"); }
        assert!(valid_rename(Path::new("/w/dir"), "新目录", true) && !valid_rename(Path::new("/w/dir"), "a/b", true));
    }
}
