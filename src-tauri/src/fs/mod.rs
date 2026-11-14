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

/// The same for an entry of a directory that is already open. The error tells a missing entry from a refused one.
#[cfg(target_os = "macos")]
pub fn open_directory_at(parent: &std::fs::File, name: &std::ffi::CStr) -> std::io::Result<std::fs::File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
    if descriptor < 0 { Err(std::io::Error::last_os_error()) } else { Ok(unsafe { std::fs::File::from_raw_fd(descriptor) }) }
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
        let dir = std::env::temp_dir().join(format!("mino-chosen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir(&dir).unwrap();
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
