use crate::documents::{DocumentStore, OpenDocument, open_granted_path, relocate_grants, forget_grants};
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

static NEXT_ENTRY: AtomicU64 = AtomicU64::new(1);
const PAGE_SIZE: usize = 200;

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

fn require_main(window: &WebviewWindow) -> Result<(), String> { if window.label() == "main" { Ok(()) } else { Err("OUT_OF_SCOPE".into()) } }
fn is_markdown(path: &Path) -> bool { path.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("md") || x.eq_ignore_ascii_case("markdown")) }
fn ignored(name: &str) -> bool { name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist" | "build" | "assets" | "venv" | "__pycache__") }
fn valid_name(name: &str, directory: bool) -> bool {
    !name.is_empty() && name.len() <= 200 && name == name.trim() && !ignored(name) && !name.contains(['/', '\\', ':']) && !name.chars().any(char::is_control) && (directory || is_markdown(Path::new(name)))
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
        if meta.file_type().is_symlink() || !(meta.is_dir() || meta.is_file() && is_markdown(&path)) { continue; }
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
    let token = format!("workspace-{}", NEXT_ENTRY.fetch_add(1, Ordering::Relaxed));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    store.0.lock().map_err(|_| "IO_ERROR")?.insert(token.clone(), EntryGrant { workspace: token.clone(), root: path.clone(), path, directory: true });
    Ok(WorkspaceRoot { token, name })
}

pub(crate) fn workspace_path(store: &WorkspaceStore, token: &str) -> Result<PathBuf, String> {
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.workspace != token { return Err("OUT_OF_SCOPE".into()); }
    checked_path(&grant)
}
#[tauri::command]
pub fn list_children(window: WebviewWindow, store: State<'_, WorkspaceStore>, directory_token: String, offset: usize) -> Result<ChildrenPage, String> {
    require_main(&window)?;
    list_at(&store, &directory_token, offset)
}
#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn rename_workspace_entry(window: WebviewWindow, store: State<'_, WorkspaceStore>, documents: State<'_, DocumentStore>, entry_token: String, new_name: String) -> Result<WorkspaceEntry, String> {
    require_main(&window)?;
    let grant = store.0.lock().map_err(|_| "IO_ERROR")?.get(&entry_token).cloned().ok_or("OUT_OF_SCOPE")?;
    if grant.path == grant.root || !valid_name(&new_name, grant.directory) { return Err("INVALID_NAME".into()); }
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

#[tauri::command]
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

#[cfg(test)]
mod tests {
    use super::*;
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
        fs::write(dir.join("skip.txt"),b"x").unwrap();
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
    fn invalid_names_are_rejected() {
        for name in ["", ".hidden.md", "../bad.md", "a/b.md", "bad:one.md", "note.txt", " trailing.md "] { assert!(!valid_name(name,false)); }
        assert!(valid_name("中文 文档.md",false));
        assert!(valid_name("子目录",true));
    }
}
