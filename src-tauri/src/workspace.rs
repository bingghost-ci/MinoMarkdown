use crate::documents::{DocumentStore, OpenDocument, open_granted_path, relocate_grants, forget_grants};
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

fn require_main(window: &WebviewWindow) -> Result<(), String> { if crate::is_workspace_window(window.label()) { Ok(()) } else { Err("OUT_OF_SCOPE".into()) } }
/// Files the sidebar lists: every kind the app opens (T81).
fn is_document(path: &Path) -> bool { DocumentKind::of(path).is_some() }
fn ignored(name: &str) -> bool { name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist" | "build" | "assets" | "venv" | "__pycache__") }
fn valid_name(name: &str, directory: bool) -> bool {
    !name.is_empty() && name.len() <= 200 && name == name.trim() && !ignored(name) && !name.contains(['/', '\\', ':']) && !name.chars().any(char::is_control) && (directory || file_kinds::is_text_path(Path::new(name)))
}
/// A file keeps its kind when renamed, so a document that is open stays what it was opened as. A PDF may be
/// renamed, though one cannot be created.
fn valid_rename(current: &Path, name: &str, directory: bool) -> bool {
    if directory { return valid_name(name, true); }
    let kind = DocumentKind::of(Path::new(name));
    if kind.is_none() || kind != DocumentKind::of(current) { return false; }
    // The name rules are those of a text file; only the extension differs for a PDF.
    if kind == Some(DocumentKind::Pdf) { valid_name(&Path::new(name).with_extension("md").to_string_lossy(), false) && name == name.trim() } else { valid_name(name, false) }
}

#[cfg(target_os = "macos")]
fn directory_handle(parent: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    if fs::canonicalize(parent).map_err(|_| "OUT_OF_SCOPE")? != parent { return Err("OUT_OF_SCOPE".into()); }
    fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(parent).map_err(|_| "OUT_OF_SCOPE".into())
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
fn rename_entry_at(source: &Path, new_name: &str, directory: bool) -> Result<PathBuf, String> {
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
fn rename_entry_at(_source: &Path, _new_name: &str, _directory: bool) -> Result<PathBuf, String> { Err("UNSUPPORTED_PLATFORM".into()) }
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
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.file_type().is_symlink() || !(meta.is_dir() || meta.is_file() && is_document(&path)) { continue; }
        children.push((name, path, meta.is_dir()));
    }
    children.sort_by(|a,b| b.2.cmp(&a.2).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())).then_with(|| a.0.cmp(&b.0)));
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
    require_main(&window)?;
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

pub(crate) fn workspace_path(store: &WorkspaceStore, token: &str) -> Result<PathBuf, String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.workspace != token { return Err("OUT_OF_SCOPE".into()); }
    checked_path(&grant)
}
#[tauri::command(async)]
pub fn list_children(window: WebviewWindow, store: State<'_, WorkspaceStore>, directory_token: String, offset: usize) -> Result<ChildrenPage, String> {
    require_main(&window)?;
    list_at(&store, &directory_token, offset)
}
#[tauri::command(async)]
pub fn open_workspace_document(window: WebviewWindow, workspace: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String) -> Result<OpenDocument, String> {
    require_main(&window)?;
    let grant = workspace.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.directory { return Err("OUT_OF_SCOPE".into()); }
    let path = checked_path(&grant)?;
    open_granted_path(&documents, &path)
}
#[tauri::command]
pub fn release_workspace(window: WebviewWindow, store: State<'_, WorkspaceStore>, token: String) -> Result<(), String> {
    require_main(&window)?;
    let mut map = store.0.lock().map_err(|_| "IO_ERROR")?;
    if !map.get(&token).is_some_and(|entry| entry.workspace == token) { return Err("OUT_OF_SCOPE".into()); }
    map.retain(|_, entry| entry.workspace != token);
    Ok(())
}

#[tauri::command(async)]
pub fn create_workspace_entry(window: WebviewWindow, store: State<'_, WorkspaceStore>, parent_token: String, name: String, directory: bool) -> Result<WorkspaceEntry, String> {
    require_main(&window)?;
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
pub fn rename_workspace_entry(window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String, new_name: String) -> Result<WorkspaceEntry, String> {
    require_main(&window)?;
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.path == grant.root || !valid_rename(&grant.path, &new_name, grant.directory) { return Err("INVALID_NAME".into()); }
    let source = checked_path(&grant)?;
    if grant.directory && fs::read_dir(&source).map_err(|_| "IO_ERROR")?.next().is_some() { return Err("DIR_NOT_EMPTY".into()); }
    let target = rename_entry_at(&source, &new_name, grant.directory)?;
    store.0.lock().map_err(|_| "IO_ERROR")?.get_mut(&entry_token).ok_or("OUT_OF_SCOPE")?.path = target.clone();
    relocate_grants(&documents, &source, &target)?;
    Ok(WorkspaceEntry { token: entry_token, name: new_name, directory: grant.directory })
}

#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<(), String> {
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
fn move_to_trash(_path: &Path) -> Result<(), String> { Err("UNSUPPORTED_PLATFORM".into()) }

#[tauri::command(async)]
pub fn trash_workspace_entry(window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String) -> Result<(), String> {
    require_main(&window)?;
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.path == grant.root { return Err("OUT_OF_SCOPE".into()); }
    let path = checked_path(&grant)?;
    if grant.directory && fs::read_dir(&path).map_err(|_| "IO_ERROR")?.next().is_some() { return Err("DIR_NOT_EMPTY".into()); }
    move_to_trash(&path)?;
    store.0.lock().map_err(|_| "IO_ERROR")?.retain(|_, item| item.path != path);
    forget_grants(&documents, &path)?;
    Ok(())
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
    require_main(&window)?;
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
