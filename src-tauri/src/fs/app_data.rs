use std::{fs, path::{Path, PathBuf}};

pub fn ensure_dir(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("INVALID_PATH")?;
    fs::create_dir_all(parent).map_err(|_| "IO_ERROR")?;
    let parent = fs::canonicalize(parent).map_err(|_| "IO_ERROR")?;
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::{fd::AsRawFd, unix::{ffi::OsStrExt, fs::MetadataExt}}};
        let name = path.file_name().ok_or("INVALID_PATH")?;
        let entry = CString::new(name.as_bytes()).map_err(|_| "INVALID_PATH")?;
        let parent_file = crate::fs::open_directory(&parent)?;
        let made = unsafe { libc::mkdirat(parent_file.as_raw_fd(), entry.as_ptr(), 0o700) };
        if made < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists { return Err("IO_ERROR".into()); }
        let directory = crate::fs::open_directory_at(&parent_file, &entry).map_err(|_| "OUT_OF_SCOPE")?;
        let actual = parent.join(name);
        let current = fs::symlink_metadata(&actual).map_err(|_| "COMMIT_UNCERTAIN")?;
        let held = directory.metadata().map_err(|_| "COMMIT_UNCERTAIN")?;
        if !current.is_dir() || current.dev() != held.dev() || current.ino() != held.ino() { return Err("COMMIT_UNCERTAIN".into()); }
        return Ok(actual);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let actual = parent.join(path.file_name().ok_or("INVALID_PATH")?);
        if let Ok(meta) = fs::symlink_metadata(&actual) { if meta.file_type().is_symlink() || !meta.is_dir() { return Err("OUT_OF_SCOPE".into()); } }
        fs::create_dir(&actual).or_else(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { Ok(()) } else { Err(error) }).map_err(|_| "IO_ERROR")?;
        Ok(actual)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn app_data_creation_rejects_linked_directory() {
        let parent = std::env::temp_dir().join(format!("mino-app-data-{}", std::process::id()));
        fs::create_dir_all(&parent).unwrap();
        let parent = fs::canonicalize(parent).unwrap();
        let data = parent.join("data");
        assert_eq!(ensure_dir(&data).unwrap(), data);
        fs::remove_dir(&data).unwrap();
        let outside = parent.join("outside"); fs::create_dir(&outside).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, &data).unwrap();
            assert_eq!(ensure_dir(&data), Err("OUT_OF_SCOPE".into()));
            #[cfg(target_os = "macos")]
            {
                assert_eq!(crate::fs::atomic_write::commit_canonical_parent(&data.join("settings.json"), b"new", None), Err("OUT_OF_SCOPE".into()));
                assert!(!outside.join("settings.json").exists());
            }
        }
        fs::remove_dir_all(parent).unwrap();
    }
}
