#[cfg(not(target_os = "macos"))]
use std::fs::OpenOptions;
use std::{ffi::OsStr, fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}};

const MAX_ASSET: u64 = 20 * 1024 * 1024;

#[derive(PartialEq, Eq, Debug)]
pub enum PutResult { Created, ExistingSame, ExistingDifferent }

pub struct AssetDirectory {
    parent_path: PathBuf,
    #[cfg(target_os = "macos")]
    parent: File,
    #[cfg(target_os = "macos")]
    assets: File,
    #[cfg(not(target_os = "macos"))]
    assets_path: PathBuf,
}

fn valid_name(name: &OsStr) -> Result<(), String> {
    let path = Path::new(name);
    let mut components = path.components();
    if !matches!(components.next(), Some(std::path::Component::Normal(_))) || components.next().is_some() {
        return Err("OUT_OF_SCOPE".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn c_name(name: &OsStr) -> Result<std::ffi::CString, String> {
    use std::os::unix::ffi::OsStrExt;
    valid_name(name)?;
    std::ffi::CString::new(name.as_bytes()).map_err(|_| "OUT_OF_SCOPE".into())
}

impl AssetDirectory {
    pub fn open(parent_path: &Path, create: bool) -> Result<Self, String> {
        let canonical = fs::canonicalize(parent_path).map_err(|_| "OUT_OF_SCOPE")?;
        if canonical != parent_path { return Err("OUT_OF_SCOPE".into()); }
        #[cfg(target_os = "macos")]
        {
            use std::os::fd::AsRawFd;
            let parent = crate::fs::open_directory(&canonical)?;
            let assets_name = c_name(OsStr::new("assets"))?;
            if create {
                let created = unsafe { libc::mkdirat(parent.as_raw_fd(), assets_name.as_ptr(), 0o755) };
                if created < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists {
                    return Err("ASSET_WRITE_FAILED".into());
                }
            }
            let assets = crate::fs::open_directory_at(&parent, &assets_name).map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { "ASSET_NOT_FOUND" } else { "OUT_OF_SCOPE" })?;
            return Ok(Self { parent_path: canonical, parent, assets });
        }
        #[cfg(not(target_os = "macos"))]
        {
            let assets_path = canonical.join("assets");
            if create && !assets_path.exists() { fs::create_dir(&assets_path).map_err(|_| "ASSET_WRITE_FAILED")?; }
            let meta = fs::symlink_metadata(&assets_path).map_err(|_| "ASSET_NOT_FOUND")?;
            if !meta.is_dir() || meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
            Ok(Self { parent_path: canonical, assets_path })
        }
    }

    pub fn read(&self, name: &OsStr) -> Result<Option<Vec<u8>>, String> {
        valid_name(name)?;
        #[cfg(target_os = "macos")]
        let file = {
            use std::os::{fd::FromRawFd, fd::AsRawFd};
            let name = c_name(name)?;
            let fd = unsafe { libc::openat(self.assets.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW) };
            if fd < 0 {
                return if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound { Ok(None) } else { Err("OUT_OF_SCOPE".into()) };
            }
            unsafe { File::from_raw_fd(fd) }
        };
        #[cfg(not(target_os = "macos"))]
        let file = {
            let path = self.assets_path.join(name);
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("IO_ERROR".into()),
            };
            if !meta.is_file() || meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
            File::open(path).map_err(|_| "IO_ERROR")?
        };
        let meta = file.metadata().map_err(|_| "IO_ERROR")?;
        if !meta.is_file() { return Err("OUT_OF_SCOPE".into()); }
        if meta.len() > MAX_ASSET { return Err("IMAGE_TOO_LARGE".into()); }
        let mut bytes = Vec::new();
        file.take(MAX_ASSET + 1).read_to_end(&mut bytes).map_err(|_| "IO_ERROR")?;
        if bytes.len() as u64 > MAX_ASSET { return Err("IMAGE_TOO_LARGE".into()); }
        Ok(Some(bytes))
    }

    pub fn put(&self, name: &OsStr, bytes: &[u8]) -> Result<PutResult, String> {
        valid_name(name)?;
        if bytes.len() as u64 > MAX_ASSET { return Err("IMAGE_TOO_LARGE".into()); }
        if let Some(existing) = self.read(name)? {
            return Ok(if existing == bytes { PutResult::ExistingSame } else { PutResult::ExistingDifferent });
        }
        #[cfg(target_os = "macos")]
        let file = {
            use std::os::{fd::{AsRawFd, FromRawFd}};
            let entry = c_name(name)?;
            let fd = unsafe { libc::openat(self.assets.as_raw_fd(), entry.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW, 0o644) };
            if fd < 0 {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists {
                    return Ok(match self.read(name)? {
                        Some(existing) if existing == bytes => PutResult::ExistingSame,
                        Some(_) => PutResult::ExistingDifferent,
                        None => return Err("ASSET_WRITE_FAILED".into()),
                    });
                }
                return Err("ASSET_WRITE_FAILED".into());
            }
            unsafe { File::from_raw_fd(fd) }
        };
        #[cfg(not(target_os = "macos"))]
        let file = OpenOptions::new().write(true).create_new(true).open(self.assets_path.join(name)).map_err(|_| "ASSET_WRITE_FAILED")?;
        let mut file = file;
        file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "ASSET_WRITE_FAILED")?;
        #[cfg(target_os = "macos")]
        self.assets.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
        Ok(PutResult::Created)
    }

    pub fn verify_location(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            use std::os::{fd::AsRawFd, unix::fs::MetadataExt};
            let expected_parent = self.parent.metadata().map_err(|_| "OUT_OF_SCOPE")?;
            let actual_parent = fs::symlink_metadata(&self.parent_path).map_err(|_| "OUT_OF_SCOPE")?;
            if !actual_parent.is_dir() || expected_parent.dev() != actual_parent.dev() || expected_parent.ino() != actual_parent.ino() { return Err("OUT_OF_SCOPE".into()); }
            let mut child: libc::stat = unsafe { std::mem::zeroed() };
            let name = c_name(OsStr::new("assets"))?;
            if unsafe { libc::fstatat(self.parent.as_raw_fd(), name.as_ptr(), &mut child, libc::AT_SYMLINK_NOFOLLOW) } < 0 { return Err("OUT_OF_SCOPE".into()); }
            let expected_assets = self.assets.metadata().map_err(|_| "OUT_OF_SCOPE")?;
            if child.st_dev as u64 != expected_assets.dev() || child.st_ino as u64 != expected_assets.ino() { return Err("OUT_OF_SCOPE".into()); }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let meta = fs::symlink_metadata(&self.assets_path).map_err(|_| "OUT_OF_SCOPE")?;
            if !meta.is_dir() || meta.file_type().is_symlink() { return Err("OUT_OF_SCOPE".into()); }
        }
        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn sample() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mino-asset-dir-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn exclusive_asset_creation_reuses_same_bytes_and_rejects_link() {
        let dir = sample();
        let assets = AssetDirectory::open(&dir, true).unwrap();
        let name = OsStr::new("image.png");
        assert_eq!(assets.put(name, b"image").unwrap(), PutResult::Created);
        assert_eq!(assets.put(name, b"image").unwrap(), PutResult::ExistingSame);
        assert_eq!(assets.put(name, b"different").unwrap(), PutResult::ExistingDifferent);
        assert_eq!(assets.read(name).unwrap().unwrap(), b"image");
        std::os::unix::fs::symlink(dir.join("outside"), dir.join("assets/link.png")).unwrap();
        assert_eq!(assets.put(OsStr::new("link.png"), b"image").err().as_deref(), Some("OUT_OF_SCOPE"));
        assets.verify_location().unwrap();
        fs::rename(dir.join("assets"), dir.join("real-assets")).unwrap();
        std::os::unix::fs::symlink(dir.join("real-assets"), dir.join("assets")).unwrap();
        assert_eq!(AssetDirectory::open(&dir, true).err().as_deref(), Some("OUT_OF_SCOPE"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn swapped_parent_keeps_asset_in_original_directory_and_fails_location_check() {
        let dir = sample();
        let moved = dir.with_extension("moved");
        let outside = dir.with_extension("outside");
        let assets = AssetDirectory::open(&dir, true).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::create_dir(outside.join("assets")).unwrap();
        fs::write(outside.join("assets/image.png"), b"outside").unwrap();
        fs::rename(&dir, &moved).unwrap();
        std::os::unix::fs::symlink(&outside, &dir).unwrap();
        assert_eq!(assets.put(OsStr::new("image.png"), b"image").unwrap(), PutResult::Created);
        assert_eq!(assets.verify_location().err().as_deref(), Some("OUT_OF_SCOPE"));
        assert_eq!(fs::read(outside.join("assets/image.png")).unwrap(), b"outside");
        assert_eq!(fs::read(moved.join("assets/image.png")).unwrap(), b"image");
        fs::remove_file(dir).unwrap();
        fs::remove_dir_all(moved).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
