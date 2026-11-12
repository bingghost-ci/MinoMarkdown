use std::{fs::{self, OpenOptions}, io::Read, path::Path};
#[cfg(not(target_os = "macos"))]
use std::fs::File;

pub fn read_no_follow(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let initial = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "IO_ERROR" }.to_owned()
    })?;
    if initial.file_type().is_symlink() || !initial.is_file() { return Err("OUT_OF_SCOPE".into()); }
    if initial.len() > limit { return Err("FILE_TOO_LARGE".into()); }
    #[cfg(target_os = "macos")]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(path)
    };
    #[cfg(not(target_os = "macos"))]
    let file = File::open(path);
    let file = file.map_err(|_| "OUT_OF_SCOPE")?;
    let metadata = file.metadata().map_err(|_| "IO_ERROR")?;
    if !metadata.is_file() { return Err("OUT_OF_SCOPE".into()); }
    if metadata.len() > limit { return Err("FILE_TOO_LARGE".into()); }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    if bytes.len() as u64 > limit { return Err("FILE_TOO_LARGE".into()); }
    Ok(bytes)
}

// App-owned records use a canonical parent. Open the entry through that directory
// so replacing the parent with a link cannot redirect a read outside app data.
#[cfg(target_os = "macos")]
pub fn read_canonical_parent(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::{ffi::CString, fs::File, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}};
    let parent = path.parent().ok_or("INVALID_PATH")?;
    if fs::canonicalize(parent).map_err(|_| "IO_ERROR")? != parent { return Err("OUT_OF_SCOPE".into()); }
    let directory = crate::fs::open_directory(parent)?;
    let directory_meta = directory.metadata().map_err(|_| "IO_ERROR")?;
    let name = CString::new(path.file_name().ok_or("INVALID_PATH")?.as_bytes()).map_err(|_| "INVALID_PATH")?;
    let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
    if fd < 0 {
        let error = std::io::Error::last_os_error();
        return Err(if error.kind() == std::io::ErrorKind::NotFound { "NOT_FOUND" } else { "OUT_OF_SCOPE" }.into());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(|_| "IO_ERROR")?;
    if !metadata.is_file() { return Err("OUT_OF_SCOPE".into()); }
    if metadata.len() > limit { return Err("FILE_TOO_LARGE".into()); }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    if bytes.len() as u64 > limit { return Err("FILE_TOO_LARGE".into()); }
    let current = fs::symlink_metadata(parent).map_err(|_| "COMMIT_UNCERTAIN")?;
    if !current.is_dir() || current.dev() != directory_meta.dev() || current.ino() != directory_meta.ino() { return Err("COMMIT_UNCERTAIN".into()); }
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
pub fn read_canonical_parent(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    read_no_follow(path, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_reader_rejects_links_and_growth() {
        let root = std::env::temp_dir().join(format!("mino-bounded-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("data.json");
        fs::write(&file, b"abcd").unwrap();
        assert_eq!(read_no_follow(&file, 4).unwrap(), b"abcd");
        assert_eq!(read_no_follow(&file, 3), Err("FILE_TOO_LARGE".into()));
        fs::remove_file(&file).unwrap();
        #[cfg(unix)] {
            std::os::unix::fs::symlink(root.join("outside.json"), &file).unwrap();
            assert_eq!(read_no_follow(&file, 4), Err("OUT_OF_SCOPE".into()));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn canonical_parent_reader_rejects_linked_directory_and_file() {
        let root = std::env::temp_dir().join(format!("mino-canonical-read-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let data = root.join("data");
        let outside = root.join("outside");
        fs::create_dir(&data).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(data.join("settings.json"), b"safe").unwrap();
        fs::write(outside.join("settings.json"), b"outside").unwrap();
        assert_eq!(read_canonical_parent(&data.join("settings.json"), 64).unwrap(), b"safe");
        fs::rename(&data, root.join("moved")).unwrap();
        std::os::unix::fs::symlink(&outside, &data).unwrap();
        assert_eq!(read_canonical_parent(&data.join("settings.json"), 64), Err("OUT_OF_SCOPE".into()));
        fs::remove_file(&data).unwrap();
        fs::create_dir(&data).unwrap();
        std::os::unix::fs::symlink(outside.join("settings.json"), data.join("settings.json")).unwrap();
        assert_eq!(read_canonical_parent(&data.join("settings.json"), 64), Err("OUT_OF_SCOPE".into()));
        fs::remove_dir_all(root).unwrap();
    }
}
