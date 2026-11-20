use std::{fs::{self, OpenOptions}, io::Read, path::Path};
#[cfg(not(target_os = "macos"))]
use std::fs::File;

/// The content of a file that is already open, refused with `too_large` when it holds more than `limit` bytes
/// (checked before reading and again after, since a file can grow) and with `OUT_OF_SCOPE` when it is not a
/// regular file.
pub fn read_open(file: fs::File, limit: u64, too_large: &str) -> Result<Vec<u8>, String> {
    let metadata = file.metadata().map_err(|_| "IO_ERROR")?;
    if !metadata.is_file() { return Err("OUT_OF_SCOPE".into()); }
    if metadata.len() > limit { return Err(too_large.into()); }
    read_at_most(file, limit, too_large)
}

/// Everything a reader has, refused with `too_large` once it yields more than `limit` bytes: a size taken
/// beforehand is only a hint, since a file can grow while it is read.
pub fn read_at_most(reader: impl Read, limit: u64, too_large: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
    if bytes.len() as u64 > limit { return Err(too_large.into()); }
    Ok(bytes)
}

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
    read_open(file, limit, "FILE_TOO_LARGE")
}

// App-owned records use a canonical parent. Open the entry through that directory
// so replacing the parent with a link cannot redirect a read outside app data.
#[cfg(target_os = "macos")]
pub fn read_canonical_parent(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::{ffi::CString, os::unix::{ffi::OsStrExt, fs::MetadataExt}};
    let parent = path.parent().ok_or("INVALID_PATH")?;
    let directory = crate::fs::open_canonical_directory(parent, "IO_ERROR")?;
    let directory_meta = directory.metadata().map_err(|_| "IO_ERROR")?;
    let name = CString::new(path.file_name().ok_or("INVALID_PATH")?.as_bytes()).map_err(|_| "INVALID_PATH")?;
    let file = crate::fs::open_file_at(&directory, &name, 0).map_err(|error| crate::fs::missing_or_refused(&error))?;
    let bytes = read_open(file, limit, "FILE_TOO_LARGE")?;
    let current = fs::symlink_metadata(parent).map_err(|_| "COMMIT_UNCERTAIN")?;
    if !current.is_dir() || current.dev() != directory_meta.dev() || current.ino() != directory_meta.ino() { return Err("COMMIT_UNCERTAIN".into()); }
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
pub fn read_canonical_parent(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    read_no_follow(path, limit)
}

/// The SHA-256 of an app record of any size, read in pieces through its canonical parent and never through a
/// link: what `replace_record` compares before replacing a record that outgrew its limit.
pub fn revision_canonical_parent(path: &Path) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let mut file = {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let parent = path.parent().ok_or("INVALID_PATH")?;
        let directory = crate::fs::open_canonical_directory(parent, "IO_ERROR")?;
        let name = CString::new(path.file_name().ok_or("INVALID_PATH")?.as_bytes()).map_err(|_| "INVALID_PATH")?;
        crate::fs::open_file_at(&directory, &name, libc::O_NONBLOCK).map_err(|error| crate::fs::missing_or_refused(&error))?
    };
    #[cfg(not(target_os = "macos"))]
    let mut file = {
        let meta = fs::symlink_metadata(path).map_err(|_| "NOT_FOUND")?;
        if meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
        File::open(path).map_err(|_| "IO_ERROR")?
    };
    if !file.metadata().map_err(|_| "IO_ERROR")?.is_file() { return Err("OUT_OF_SCOPE".into()); }
    super::sha256_of_reader(&mut file).map_err(|_| "IO_ERROR".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_reader_rejects_links_and_growth() {
        let root = crate::fs::test_dir("bounded");
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
        let root = crate::fs::test_dir("canonical-read");
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
