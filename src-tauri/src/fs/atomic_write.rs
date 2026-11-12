#[cfg(not(target_os = "macos"))]
use std::fs::OpenOptions;
use std::{fs::{self, File}, io::{Read, Write}, path::Path, sync::atomic::{AtomicU64, Ordering}};
#[cfg(any(test, not(target_os = "macos")))]
use std::path::PathBuf;

#[cfg(not(target_os = "macos"))]
fn open_existing(path: &Path) -> Result<File, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
    if !meta.is_file() || meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
    let file = File::open(path);
    let file = file.map_err(|_| "OUT_OF_SCOPE")?;
    if !file.metadata().map_err(|_| "IO_ERROR")?.is_file() { return Err("OUT_OF_SCOPE".into()); }
    Ok(file)
}

#[cfg(not(target_os = "macos"))]
fn read_existing(path: &Path) -> Result<(File, fs::Metadata, Vec<u8>), String> {
    let mut file = open_existing(path)?;
    let meta = file.metadata().map_err(|_| "IO_ERROR")?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    Ok((file, meta, bytes))
}

#[cfg(target_os = "macos")]
fn copy_metadata(source: &File, destination: &File) -> Result<(), String> {
    use std::{ffi::c_void, os::{fd::AsRawFd, raw::c_int}};
    unsafe extern "C" {
        fn fcopyfile(from: c_int, to: c_int, state: *mut c_void, flags: u32) -> c_int;
    }
    const COPYFILE_ACL: u32 = 1 << 0;
    const COPYFILE_XATTR: u32 = 1 << 2;
    let copied = unsafe { fcopyfile(source.as_raw_fd(), destination.as_raw_fd(), std::ptr::null_mut(), COPYFILE_ACL | COPYFILE_XATTR) };
    if copied == 0 { Ok(()) } else { Err("METADATA_COPY_FAILED".into()) }
}

#[cfg(not(target_os = "macos"))]
fn copy_metadata(_source: &File, _destination: &File) -> Result<(), String> { Ok(()) }

static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    Write,
    Flush,
    Replace,
    #[cfg(test)]
    SwapParent,
}

#[cfg(not(target_os = "macos"))]
struct Temporary(PathBuf);
#[cfg(not(target_os = "macos"))]
impl Drop for Temporary {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

fn revision(bytes: &[u8]) -> String {
    super::sha256_hex(bytes)
}

pub fn commit(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<String, String> {
    commit_with_fault(path, bytes, expected, Fault::None)
}

/// Writes one of the app's own records (settings, recent files, the assistant's configuration) over whatever
/// is there now. `limit` is the most the existing file may hold.
pub fn replace_record(path: &Path, bytes: &[u8], limit: u64) -> Result<(), String> {
    let expected = super::bounded_file::read_canonical_parent(path, limit).ok().map(|old| super::sha256_hex(&old));
    commit_canonical_parent(path, bytes, expected.as_deref()).map(|_| ())
}

pub fn commit_canonical_parent(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return macos::commit(path, bytes, expected, Fault::None, true);
    #[cfg(not(target_os = "macos"))]
    commit(path, bytes, expected)
}

fn commit_with_fault(path: &Path, bytes: &[u8], expected: Option<&str>, fault: Fault) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return macos::commit(path, bytes, expected, fault, false);
    #[cfg(not(target_os = "macos"))]
    {
    let parent = path.parent().ok_or("INVALID_PATH")?;
    let name = path.file_name().ok_or("INVALID_PATH")?.to_string_lossy();
    let existing = if expected.is_some() {
        let (source, meta, current) = read_existing(path)?;
        if meta.permissions().readonly() { return Err("PERMISSION_DENIED".into()); }
        if revision(&current) != expected.unwrap() { return Err("CONFLICT".into()); }
        Some((source, meta))
    } else {
        if path.exists() || fs::symlink_metadata(path).is_ok() { return Err("TARGET_EXISTS".into()); }
        None
    };
    let temp_path = parent.join(format!(".mino-{}-{}-{}.tmp", name, std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
    let temp = Temporary(temp_path.clone());
    let mut file = OpenOptions::new().create_new(true).write(true).open(&temp_path).map_err(|_| "IO_ERROR")?;
    if let Some((source, meta)) = &existing {
        fs::set_permissions(&temp_path, meta.permissions()).map_err(|_| "PERMISSION_DENIED")?;
        copy_metadata(source, &file)?;
    }
    if fault == Fault::Write { return Err("IO_ERROR".into()); }
    file.write_all(bytes).map_err(|_| "IO_ERROR")?;
    if fault == Fault::Flush { return Err("IO_ERROR".into()); }
    file.sync_all().map_err(|_| "IO_ERROR")?;
    drop(file);
    if let Some(expected) = expected {
        let (_, _, current) = read_existing(path).map_err(|_| "CONFLICT")?;
        if revision(&current) != expected { return Err("CONFLICT".into()); }
    } else if path.exists() || fs::symlink_metadata(path).is_ok() {
        return Err("TARGET_EXISTS".into());
    }
    if fault == Fault::Replace { return Err("IO_ERROR".into()); }
    if let Some(expected) = expected {
        let backup = parent.join(format!(".mino-backup-{}-{}.bak", name, &expected[..16]));
        if !backup.exists() { fs::hard_link(path, &backup).map_err(|_| "IO_ERROR")?; }
        fs::rename(&temp_path, path).map_err(|_| "IO_ERROR")?;
    } else {
        fs::hard_link(&temp_path, path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists { "TARGET_EXISTS" } else { "IO_ERROR" }.to_owned()
        })?;
    }
    drop(temp);
    let directory = File::open(parent).map_err(|_| "COMMIT_UNCERTAIN")?;
    directory.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
    Ok(revision(bytes))
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::{ffi::{CString, OsStr}, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}};

    fn name(value: &OsStr) -> Result<CString, String> {
        CString::new(value.as_bytes()).map_err(|_| "INVALID_PATH".into())
    }

    fn open_at(directory: &File, entry: &CString) -> Result<File, String> {
        let fd = unsafe { libc::openat(directory.as_raw_fd(), entry.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW) };
        if fd < 0 {
            return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "OUT_OF_SCOPE" }.into());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if !file.metadata().map_err(|_| "IO_ERROR")?.is_file() { return Err("OUT_OF_SCOPE".into()); }
        Ok(file)
    }

    fn read_at(directory: &File, entry: &CString) -> Result<(File, fs::Metadata, Vec<u8>), String> {
        let mut file = open_at(directory, entry)?;
        let metadata = file.metadata().map_err(|_| "IO_ERROR")?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents).map_err(|_| "IO_ERROR")?;
        Ok((file, metadata, contents))
    }

    struct TemporaryAt<'a> { directory: &'a File, entry: CString, active: bool }
    impl Drop for TemporaryAt<'_> {
        fn drop(&mut self) {
            if self.active { unsafe { libc::unlinkat(self.directory.as_raw_fd(), self.entry.as_ptr(), 0); } }
        }
    }

    /// Earlier versions kept beside a file: the one that was just replaced.
    const KEPT_BACKUPS: usize = 1;

    /// Removes the backups of `file_name` beyond the newest `keep`. Every replaced version used to stay as a
    /// hidden file for ever: hundreds beside the settings file, and a full copy of a document for each save (T101).
    ///
    /// Only regular files named exactly `.mino-backup-<file_name>-<16 hex digits>.bak` are candidates, so the
    /// backups of a file whose name merely starts the same way are not touched, and nothing is followed or
    /// opened. `previous`, the version just replaced, always stays. Errors are ignored: the save has succeeded.
    fn prune_backups(directory: &File, file_name: &OsStr, previous: &CString, keep: usize) {
        let prefix = [b".mino-backup-".as_slice(), file_name.as_bytes(), b"-"].concat();
        let descriptor = unsafe { libc::dup(directory.as_raw_fd()) };
        if descriptor < 0 { return; }
        let stream = unsafe { libc::fdopendir(descriptor) };
        if stream.is_null() { unsafe { libc::close(descriptor); } return; }
        unsafe { libc::rewinddir(stream); }
        let mut older: Vec<(i64, i64, CString)> = Vec::new();
        loop {
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() { break; }
            let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
            let Some(hash) = name.to_bytes().strip_prefix(prefix.as_slice()).and_then(|rest| rest.strip_suffix(b".bak")) else { continue };
            if hash.len() != 16 || !hash.iter().all(u8::is_ascii_hexdigit) || name == previous.as_c_str() { continue; }
            let mut stat: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::fstatat(directory.as_raw_fd(), name.as_ptr(), &mut stat, libc::AT_SYMLINK_NOFOLLOW) } != 0 { continue; }
            if stat.st_mode & libc::S_IFMT != libc::S_IFREG { continue; }
            // A backup is a link made at the moment its version was replaced, which is when its status changed.
            older.push((stat.st_ctime, stat.st_ctime_nsec, name.to_owned()));
        }
        unsafe { libc::closedir(stream); }
        older.sort();
        let surplus = (older.len() + 1).saturating_sub(keep.max(1));
        for (_, _, name) in older.into_iter().take(surplus) {
            unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0); }
        }
    }

    pub(super) fn commit(path: &Path, bytes: &[u8], expected: Option<&str>, fault: Fault, canonical_parent: bool) -> Result<String, String> {
        let parent = fs::canonicalize(path.parent().ok_or("INVALID_PATH")?).map_err(|_| "IO_ERROR")?;
        if canonical_parent && parent != path.parent().ok_or("INVALID_PATH")? { return Err("OUT_OF_SCOPE".into()); }
        let directory = crate::fs::open_directory(&parent)?;
        let directory_meta = directory.metadata().map_err(|_| "IO_ERROR")?;
        let entry = name(path.file_name().ok_or("INVALID_PATH")?)?;
        let original = if let Some(expected) = expected {
            let (source, metadata, contents) = read_at(&directory, &entry)?;
            if metadata.permissions().readonly() { return Err("PERMISSION_DENIED".into()); }
            if revision(&contents) != expected { return Err("CONFLICT".into()); }
            Some((source, metadata))
        } else {
            None
        };
        let temp_name = format!(".mino-{}-{}-{}.tmp", path.file_name().ok_or("INVALID_PATH")?.to_string_lossy(), std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed));
        let temp = name(OsStr::new(&temp_name))?;
        let fd = unsafe { libc::openat(directory.as_raw_fd(), temp.as_ptr(), libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW, 0o600) };
        if fd < 0 { return Err("IO_ERROR".into()); }
        let mut staging = unsafe { File::from_raw_fd(fd) };
        let mut cleanup = TemporaryAt { directory: &directory, entry: temp, active: true };
        if let Some((source, metadata)) = &original {
            staging.set_permissions(metadata.permissions()).map_err(|_| "PERMISSION_DENIED")?;
            copy_metadata(source, &staging)?;
        }
        if fault == Fault::Write { return Err("IO_ERROR".into()); }
        staging.write_all(bytes).map_err(|_| "IO_ERROR")?;
        if fault == Fault::Flush { return Err("IO_ERROR".into()); }
        staging.sync_all().map_err(|_| "IO_ERROR")?;
        drop(staging);
        #[cfg(test)]
        if fault == Fault::SwapParent {
            use std::os::unix::fs::symlink;
            let moved = parent.with_extension("moved");
            let outside = parent.with_extension("outside");
            fs::rename(&parent, &moved).map_err(|_| "IO_ERROR")?;
            symlink(&outside, &parent).map_err(|_| "IO_ERROR")?;
        }
        if let Some(expected) = expected {
            let (_, current_meta, current) = read_at(&directory, &entry).map_err(|_| "CONFLICT")?;
            if revision(&current) != expected { return Err("CONFLICT".into()); }
            if let Some((_, original_meta)) = &original {
                if current_meta.dev() != original_meta.dev() || current_meta.ino() != original_meta.ino() { return Err("CONFLICT".into()); }
            }
        } else if open_at(&directory, &entry).is_ok() {
            return Err("TARGET_EXISTS".into());
        }
        if fault == Fault::Replace { return Err("IO_ERROR".into()); }
        let mut previous = None;
        if let Some(expected) = expected {
            let backup = name(OsStr::new(&format!(".mino-backup-{}-{}.bak", path.file_name().ok_or("INVALID_PATH")?.to_string_lossy(), &expected[..16])))?;
            let linked = unsafe { libc::linkat(directory.as_raw_fd(), entry.as_ptr(), directory.as_raw_fd(), backup.as_ptr(), 0) };
            if linked < 0 {
                if std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists { return Err("IO_ERROR".into()); }
                let (_, _, existing_backup) = read_at(&directory, &backup).map_err(|_| "IO_ERROR")?;
                if revision(&existing_backup) != expected { return Err("CONFLICT".into()); }
            }
            let moved = unsafe { libc::renameat(directory.as_raw_fd(), cleanup.entry.as_ptr(), directory.as_raw_fd(), entry.as_ptr()) };
            if moved < 0 { return Err("IO_ERROR".into()); }
            cleanup.active = false;
            previous = Some(backup);
        } else {
            let linked = unsafe { libc::linkat(directory.as_raw_fd(), cleanup.entry.as_ptr(), directory.as_raw_fd(), entry.as_ptr(), 0) };
            if linked < 0 {
                return Err(if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists { "TARGET_EXISTS" } else { "IO_ERROR" }.into());
            }
            unsafe { libc::unlinkat(directory.as_raw_fd(), cleanup.entry.as_ptr(), 0); }
            cleanup.active = false;
        }
        directory.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
        let current_parent = fs::symlink_metadata(&parent).map_err(|_| "COMMIT_UNCERTAIN")?;
        if !current_parent.is_dir() || current_parent.dev() != directory_meta.dev() || current_parent.ino() != directory_meta.ino() {
            return Err("COMMIT_UNCERTAIN".into());
        }
        // The write is complete and durable. Tidying up comes last and cannot fail the save.
        if let Some(previous) = &previous {
            prune_backups(&directory, path.file_name().ok_or("INVALID_PATH")?, previous, KEPT_BACKUPS);
        }
        Ok(revision(bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("mino-atomic-test-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("记录.md");
        (dir, path)
    }

    #[test]
    fn failures_before_commit_preserve_original_bytes() {
        for fault in [Fault::Write, Fault::Flush, Fault::Replace] {
            let (dir, path) = sample();
            fs::write(&path, b"original").unwrap();
            assert!(commit_with_fault(&path, b"replacement", Some(&revision(b"original")), fault).is_err());
            assert_eq!(fs::read(&path).unwrap(), b"original");
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "failed write must clean staging files");
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn failed_first_save_leaves_no_target_or_staging_file() {
        for fault in [Fault::Write, Fault::Flush, Fault::Replace] {
            let (dir, path) = sample();
            assert_eq!(commit_with_fault(&path, b"new", None, fault), Err("IO_ERROR".into()));
            assert!(!path.exists());
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn missing_parent_and_read_only_target_do_not_modify_original() {
        let (dir, path) = sample();
        assert_eq!(commit(&dir.join("missing/note.md"), b"new", None), Err("IO_ERROR".into()));
        fs::write(&path, b"original").unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        assert_eq!(commit(&path, b"new", Some(&revision(b"original"))), Err("PERMISSION_DENIED".into()));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn new_targets_are_exclusive_and_changed_targets_conflict() {
        let (dir, path) = sample();
        fs::write(&path, b"other file").unwrap();
        assert_eq!(commit(&path, b"new", None), Err("TARGET_EXISTS".into()));
        assert_eq!(commit(&path, b"new", Some(&revision(b"prior"))), Err("CONFLICT".into()));
        assert_eq!(fs::read(&path).unwrap(), b"other file");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn symlink_target_does_not_modify_outside_file() {
        use std::os::unix::fs::symlink;
        let (dir, path) = sample();
        let outside = dir.join("outside.md");
        fs::write(&outside, b"outside").unwrap();
        symlink(&outside, &path).unwrap();
        assert_eq!(commit(&path, b"new", Some(&revision(b"outside"))), Err("OUT_OF_SCOPE".into()));
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parent_replaced_after_staging_keeps_commit_in_open_directory() {
        let (dir, path) = sample();
        let outside = dir.with_extension("outside");
        let moved = dir.with_extension("moved");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("记录.md"), b"outside").unwrap();
        fs::write(&path, b"original").unwrap();
        assert_eq!(commit_with_fault(&path, b"new", Some(&revision(b"original")), Fault::SwapParent), Err("COMMIT_UNCERTAIN".into()));
        assert_eq!(fs::read(outside.join("记录.md")).unwrap(), b"outside");
        assert_eq!(fs::read(moved.join("记录.md")).unwrap(), b"new");
        fs::remove_file(&dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
        fs::remove_dir_all(moved).unwrap();
    }

    #[test]
    fn successful_replace_keeps_a_recovery_copy() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, path) = sample();
        fs::write(&path, b"old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let original_hash = revision(b"old");
        assert_eq!(commit(&path, b"new", Some(&original_hash)).unwrap(), revision(b"new"));
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
        assert_eq!(fs::read(dir.join(format!(".mino-backup-记录.md-{}.bak", &original_hash[..16]))).unwrap(), b"old");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    fn backups(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).filter(|name| name.starts_with(".mino-backup-")).collect();
        names.sort();
        names
    }

    /// Saves `versions` one after another, checking after each that the version it replaced can still be recovered.
    #[cfg(target_os = "macos")]
    fn save_in_turn(dir: &Path, path: &Path, versions: &[&[u8]], record: bool) {
        fs::write(path, versions[0]).unwrap();
        for pair in versions.windows(2) {
            let expected = revision(pair[0]);
            let saved = if record { commit_canonical_parent(path, pair[1], Some(&expected)) } else { commit(path, pair[1], Some(&expected)) };
            assert_eq!(saved.unwrap(), revision(pair[1]));
            assert_eq!(fs::read(path).unwrap(), pair[1]);
            assert_eq!(fs::read(dir.join(format!(".mino-backup-记录.md-{}.bak", &expected[..16]))).unwrap(), pair[0]);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_document_keeps_the_version_it_last_replaced() {
        let (dir, path) = sample();
        let versions: [&[u8]; 7] = [b"v0", b"v1", b"v2", b"v3", b"v4", b"v5", b"v6"];
        save_in_turn(&dir, &path, &versions, false);
        // Six saves replaced v0 to v5; only the last of those remains.
        assert_eq!(backups(&dir), vec![format!(".mino-backup-记录.md-{}.bak", &revision(b"v5")[..16])]);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2, "the document, one backup, and no staging file");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_record_the_app_keeps_for_itself_keeps_one_earlier_version() {
        let (dir, _) = sample();
        // Records are written through their canonical folder, as the app data folder is.
        let dir = fs::canonicalize(dir).unwrap();
        let path = dir.join("记录.md");
        // Backups left by earlier versions of the app, which never removed any, go at the first write.
        for stale in 0..40u8 { fs::write(dir.join(format!(".mino-backup-记录.md-{:016x}.bak", u64::from(stale) + 1)), [stale]).unwrap(); }
        save_in_turn(&dir, &path, &[b"one", b"two", b"three", b"two", b"three"], true);
        assert_eq!(backups(&dir), vec![format!(".mino-backup-记录.md-{}.bak", &revision(b"two")[..16])]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn pruning_touches_only_this_files_own_backups_and_never_fails_the_save() {
        let (dir, path) = sample();
        let outside = dir.join("outside.txt");
        fs::write(&outside, b"not a backup").unwrap();
        // Another file's backup whose name begins the same way; names that are not `<16 hex digits>.bak`;
        // and a folder and a link that are named exactly like a backup but are not files.
        let decoys = [".mino-backup-记录.md-extra-0123456789abcdef.bak", ".mino-backup-记录.md-0123.bak", ".mino-backup-记录.md-0123456789abcdeg.bak", ".mino-backup-记录.md-0123456789abcdef.bak.txt", ".mino-backup-记录.mdx-0123456789abcdef.bak"];
        for decoy in decoys { fs::write(dir.join(decoy), b"keep").unwrap(); }
        let folder = dir.join(".mino-backup-记录.md-aaaaaaaaaaaaaaaa.bak");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("inside"), b"keep").unwrap();
        let link = dir.join(".mino-backup-记录.md-bbbbbbbbbbbbbbbb.bak");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        save_in_turn(&dir, &path, &[b"v0", b"v1", b"v2", b"v3", b"v4", b"v5", b"v6"], false);
        for decoy in decoys { assert_eq!(fs::read(dir.join(decoy)).unwrap(), b"keep", "{decoy}"); }
        assert_eq!(fs::read(folder.join("inside")).unwrap(), b"keep");
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&outside).unwrap(), b"not a backup");
        // Its own backups were still pruned to the latest.
        assert!(backups(&dir).contains(&format!(".mino-backup-记录.md-{}.bak", &revision(b"v5")[..16])));
        assert_eq!(backups(&dir).len(), 1 + decoys.len() + 2);
        fs::remove_dir_all(dir).unwrap();
    }

    /// T91 timing, compared before and after a change: `cargo test --release --lib -- --ignored --nocapture timing_sha256`.
    #[test]
    #[ignore]
    fn timing_sha256_64_mib() {
        let bytes: Vec<u8> = (0..64 * 1024 * 1024u32).map(|index| (index.wrapping_mul(2654435761) >> 24) as u8).collect();
        let mut runs: Vec<u128> = (0..5).map(|_| { let started = std::time::Instant::now(); std::hint::black_box(revision(&bytes)); started.elapsed().as_millis() }).collect();
        runs.sort();
        println!("timing_sha256_64_mib median_ms={} digest={}", runs[2], &revision(&bytes)[..16]);
    }
}
