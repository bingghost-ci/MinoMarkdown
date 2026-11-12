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
}
