use std::{fs, path::{Path, PathBuf}};

pub fn ensure_dir(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("INVALID_PATH")?;
    fs::create_dir_all(parent).map_err(|_| "IO_ERROR")?;
    let parent = fs::canonicalize(parent).map_err(|_| "IO_ERROR")?;
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let name = path.file_name().ok_or("INVALID_PATH")?;
        let entry = CString::new(name.as_bytes()).map_err(|_| "INVALID_PATH")?;
        let parent_file = crate::fs::open_directory(&parent)?;
        crate::fs::ensure_directory_at(&parent_file, &entry, 0o700).map_err(|_| "IO_ERROR")?;
        let directory = crate::fs::open_directory_at(&parent_file, &entry).map_err(|_| "OUT_OF_SCOPE")?;
        let actual = parent.join(name);
        crate::fs::still_at(&actual, &directory, "COMMIT_UNCERTAIN")?;
        Ok(actual)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let actual = parent.join(path.file_name().ok_or("INVALID_PATH")?);
        if let Ok(meta) = fs::symlink_metadata(&actual) { if meta.file_type().is_symlink() || !meta.is_dir() { return Err("OUT_OF_SCOPE".into()); } }
        fs::create_dir(&actual).or_else(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { Ok(()) } else { Err(error) }).map_err(|_| "IO_ERROR")?;
        Ok(actual)
    }
}

/// Where one of the app's own records is kept: `name` in the app data directory, which is made when missing.
pub fn record_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(ensure_dir(&app.path().app_data_dir().map_err(|_| "IO_ERROR")?)?.join(name))
}

/// One of the app's own records, or `None` when it is missing, over `limit`, behind a link or not this JSON.
/// What a record means (its version, its valid values) is checked by the caller.
pub fn load_record<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Option<T> {
    super::bounded_file::read_canonical_parent(path, limit).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

/// Writes a record over whatever is there, as `replace_record` does.
pub fn save_record<T: serde::Serialize>(path: &Path, record: &T, limit: u64) -> Result<(), String> {
    super::atomic_write::replace_record(path, &serde_json::to_vec(record).map_err(|_| "IO_ERROR")?, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn app_data_creation_rejects_linked_directory() {
        let parent = crate::fs::test_dir("app-data");
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
