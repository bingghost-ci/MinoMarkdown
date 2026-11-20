pub mod atomic_write;
pub mod app_data;
pub mod asset_directory;
pub mod bounded_file;

use sha2::{Digest, Sha256};

/// Opens a directory itself, never the target of a link standing in its place.
#[cfg(target_os = "macos")]
pub fn open_directory(path: &std::path::Path) -> Result<std::fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(path).map_err(|_| "OUT_OF_SCOPE".into())
}

/// Opens a directory given by its canonical path, as the parents of granted files and of the app's records are.
/// A path that is not its own canonical form has a link in it and is `OUT_OF_SCOPE`; `unresolved` is the code for
/// a path that cannot be resolved at all, which callers tell apart (a deleted folder is `NOT_FOUND` for a document).
#[cfg(target_os = "macos")]
pub fn open_canonical_directory(path: &std::path::Path, unresolved: &str) -> Result<std::fs::File, String> {
    if std::fs::canonicalize(path).map_err(|_| unresolved.to_string())? != path { return Err("OUT_OF_SCOPE".into()); }
    open_directory(path)
}

/// Checks, after working through an open directory, that `path` still names that directory: nothing put a link or
/// another folder in its place meanwhile. `code` is the error when it did, or when either cannot be examined.
#[cfg(target_os = "macos")]
pub fn still_at(path: &std::path::Path, directory: &std::fs::File, code: &str) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let current = std::fs::symlink_metadata(path).map_err(|_| code.to_string())?;
    let held = directory.metadata().map_err(|_| code.to_string())?;
    if !current.is_dir() || current.dev() != held.dev() || current.ino() != held.ino() { return Err(code.into()); }
    Ok(())
}

/// The same check for an entry of an open directory: `name` in `parent` is still what `opened` holds, and not a
/// link or another file put under that name since.
#[cfg(target_os = "macos")]
pub fn still_entry(parent: &std::fs::File, name: &std::ffi::CStr, opened: &std::fs::File, code: &str) -> Result<(), String> {
    use std::os::{fd::AsRawFd, unix::fs::MetadataExt};
    let mut current: libc::stat = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstatat(parent.as_raw_fd(), name.as_ptr(), &mut current, libc::AT_SYMLINK_NOFOLLOW) } < 0 { return Err(code.into()); }
    let held = opened.metadata().map_err(|_| code.to_string())?;
    if current.st_dev as u64 != held.dev() || current.st_ino as u64 != held.ino() { return Err(code.into()); }
    Ok(())
}

/// A file name as the `*at` calls take it. Only a single plain name passes: no separator, no `.` or `..`, no NUL.
#[cfg(target_os = "macos")]
pub fn entry_c_name(name: &std::ffi::OsStr) -> Result<std::ffi::CString, String> {
    use std::os::unix::ffi::OsStrExt;
    let mut parts = std::path::Path::new(name).components();
    if !matches!(parts.next(), Some(std::path::Component::Normal(_))) || parts.next().is_some() { return Err("OUT_OF_SCOPE".into()); }
    std::ffi::CString::new(name.as_bytes()).map_err(|_| "OUT_OF_SCOPE".into())
}

/// The names in an open directory, without `.` and `..`. The handle can be listed again afterwards.
#[cfg(target_os = "macos")]
pub fn directory_entries(folder: &std::fs::File) -> std::io::Result<Vec<std::ffi::OsString>> {
    use std::os::{fd::AsRawFd, unix::ffi::OsStringExt};
    let duplicate = unsafe { libc::dup(folder.as_raw_fd()) };
    if duplicate < 0 { return Err(std::io::Error::last_os_error()); }
    // A dup shares the read offset, so a directory listed earlier through this handle must be rewound.
    unsafe { libc::lseek(duplicate, 0, libc::SEEK_SET); }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() { let error = std::io::Error::last_os_error(); unsafe { libc::close(duplicate); } return Err(error); }
    let mut names = Vec::new();
    loop {
        unsafe { *libc::__error() = 0; }
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            let code = unsafe { *libc::__error() };
            unsafe { libc::closedir(stream); }
            return if code != 0 { Err(std::io::Error::from_raw_os_error(code)) } else { Ok(names) };
        }
        let bytes = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if bytes != b"." && bytes != b".." { names.push(std::ffi::OsString::from_vec(bytes.to_vec())); }
    }
}

/// Opens an entry of an open directory for reading, never through a link. `flags` are added to the open
/// (`O_DIRECTORY`, or `O_NONBLOCK` so that a FIFO under the name cannot block).
#[cfg(target_os = "macos")]
pub fn open_file_at(parent: &std::fs::File, name: &std::ffi::CStr, flags: libc::c_int) -> std::io::Result<std::fs::File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | flags) };
    if descriptor < 0 { Err(std::io::Error::last_os_error()) } else { Ok(unsafe { std::fs::File::from_raw_fd(descriptor) }) }
}

/// Creates a file in an open directory. It fails when the name is taken, by a link too, so nothing is ever
/// written over. `access` is `O_WRONLY` or `O_RDWR`.
#[cfg(target_os = "macos")]
pub fn create_file_at(parent: &std::fs::File, name: &std::ffi::CStr, access: libc::c_int, mode: libc::c_uint) -> std::io::Result<std::fs::File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), access | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, mode) };
    if descriptor < 0 { Err(std::io::Error::last_os_error()) } else { Ok(unsafe { std::fs::File::from_raw_fd(descriptor) }) }
}

/// Makes a directory in an open directory. A name that is taken is an `AlreadyExists` error.
#[cfg(target_os = "macos")]
pub fn make_directory_at(parent: &std::fs::File, name: &std::ffi::CStr, mode: libc::mode_t) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), mode) } < 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}

/// The same, but a name that is already there is not an error: the caller opens it next and sees what it is.
#[cfg(target_os = "macos")]
pub fn ensure_directory_at(parent: &std::fs::File, name: &std::ffi::CStr, mode: libc::mode_t) -> std::io::Result<()> {
    match make_directory_at(parent, name, mode) {
        Err(error) if error.kind() != std::io::ErrorKind::AlreadyExists => Err(error),
        _ => Ok(()),
    }
}

/// The error code for an entry that could not be opened: missing, or refused (a link, no permission).
pub fn missing_or_refused(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "OUT_OF_SCOPE" }.into()
}

/// The same for an entry of a directory that is already open. The error tells a missing entry from a refused one.
#[cfg(target_os = "macos")]
pub fn open_directory_at(parent: &std::fs::File, name: &std::ffi::CStr) -> std::io::Result<std::fs::File> {
    open_file_at(parent, name, libc::O_DIRECTORY)
}

/// How long an export waits for macOS to let it write the file the user chose.
pub const CHOSEN_FILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Writes an exported file to the path the user just chose in a save panel (T106).
///
/// Only that one file is touched. The atomic writer opens the folder itself and creates a temporary file beside
/// the target, and in a privacy-protected folder (Downloads, Desktop, Documents, iCloud Drive) macOS covers neither
/// with the save panel's permission: the `open` then waits on the privacy check, possibly for good. Here the write
/// runs on its own thread, and after `timeout` the export reports `WRITE_BLOCKED` instead of hanging; the write
/// may still finish later if macOS lets it. The file is written in place, which suits an export: no edit of the
/// user's is lost if it fails.
pub fn write_chosen_file(path: &std::path::Path, bytes: Vec<u8>, timeout: std::time::Duration) -> Result<(), String> {
    let path = path.to_path_buf();
    let (done, result) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let _ = done.send(write_in_place(&path, &bytes)); });
    result.recv_timeout(timeout).unwrap_or_else(|_| Err("WRITE_BLOCKED".into()))
}

fn write_in_place(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o644)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(path)
        .map_err(|error| if error.kind() == std::io::ErrorKind::PermissionDenied { "PERMISSION_DENIED".to_string() } else { "IO_ERROR".to_string() })?;
    if !file.metadata().map_err(|_| "IO_ERROR")?.is_file() { return Err("INVALID_PATH".into()); }
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "IO_ERROR".into())
}

/// Lowercase hexadecimal, as revisions, draft hashes and record keys are written.
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut text, byte| { let _ = write!(text, "{byte:02x}"); text })
}

/// The SHA-256 of `bytes` in hexadecimal: the revision of a file's content.
pub fn sha256_hex(bytes: &[u8]) -> String { hex(&Sha256::digest(bytes)) }

/// The SHA-256 of everything a reader still has, read in pieces so a large file is never held whole.
pub fn sha256_of_reader(reader: &mut impl std::io::Read) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 { return Ok(hex(&hasher.finalize())); }
        hasher.update(&buffer[..count]);
    }
}

/// A new, empty folder for one test, given by its canonical path. The `mino-` prefix is what `clean.sh` sweeps.
#[cfg(test)]
pub(crate) fn test_dir(tag: &str) -> std::path::PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let dir = std::env::temp_dir().join(format!("mino-{tag}-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::canonicalize(dir).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_as_the_reference_values_do() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        // More than one block, and a length that is not a multiple of the block size.
        assert_eq!(sha256_hex(&[b'a'; 1000]), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
        assert_eq!(hex(&[0x00, 0x0f, 0xa0, 0xff]), "000fa0ff");
    }

    #[test]
    fn a_chosen_file_is_written_or_replaced_in_place_and_never_through_a_link() {
        let dir = crate::fs::test_dir("chosen");
        let target = dir.join("out.pdf");
        write_chosen_file(&target, b"%PDF-new".to_vec(), CHOSEN_FILE_TIMEOUT).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"%PDF-new");
        write_chosen_file(&target, b"%PDF".to_vec(), CHOSEN_FILE_TIMEOUT).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"%PDF", "a replaced file is not left longer than the new one");
        // Nothing else appears in the folder: no temporary file and no backup.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let elsewhere = dir.join("elsewhere");
        std::fs::write(&elsewhere, b"keep").unwrap();
        let link = dir.join("link.pdf");
        std::os::unix::fs::symlink(&elsewhere, &link).unwrap();
        assert!(write_chosen_file(&link, b"x".to_vec(), CHOSEN_FILE_TIMEOUT).is_err());
        assert_eq!(std::fs::read(&elsewhere).unwrap(), b"keep");
        assert_eq!(write_chosen_file(&dir, b"x".to_vec(), CHOSEN_FILE_TIMEOUT), Err("IO_ERROR".into()));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
