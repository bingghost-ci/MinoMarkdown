#[cfg(not(target_os = "macos"))]
use std::fs::OpenOptions;
use std::{ffi::OsStr, fs::{self, File}, io::Write, path::{Path, PathBuf}};

const MAX_ASSET: u64 = crate::file_kinds::MAX_IMAGE_BYTES;
#[cfg(target_os = "macos")]
static NEXT_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;

#[cfg(test)]
thread_local! { pub(crate) static FAIL_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
#[cfg(target_os = "macos")]
fn fail_write() -> bool {
    #[cfg(test)]
    return FAIL_WRITE.with(|fail| fail.get());
    #[cfg(not(test))]
    false
}

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
    crate::fs::entry_c_name(name)
}

impl AssetDirectory {
    pub fn open(parent_path: &Path, create: bool) -> Result<Self, String> {
        let canonical = fs::canonicalize(parent_path).map_err(|_| "OUT_OF_SCOPE")?;
        if canonical != parent_path { return Err("OUT_OF_SCOPE".into()); }
        #[cfg(target_os = "macos")]
        {
            
            let parent = crate::fs::open_directory(&canonical)?;
            let assets_name = c_name(OsStr::new("assets"))?;
            if create {
                crate::fs::ensure_directory_at(&parent, &assets_name, 0o755).map_err(|_| "ASSET_WRITE_FAILED")?;
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
            
            let name = c_name(name)?;
            match crate::fs::open_file_at(&self.assets, &name, 0) {
                Ok(file) => file,
                Err(error) => return if error.kind() == std::io::ErrorKind::NotFound { Ok(None) } else { Err("OUT_OF_SCOPE".into()) },
            }
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
        super::bounded_file::read_open(file, MAX_ASSET, "IMAGE_TOO_LARGE").map(Some)
    }

    pub fn put(&self, name: &OsStr, bytes: &[u8]) -> Result<PutResult, String> {
        valid_name(name)?;
        if bytes.len() as u64 > MAX_ASSET { return Err("IMAGE_TOO_LARGE".into()); }
        if let Some(existing) = self.read(name)? {
            return Ok(if existing == bytes { PutResult::ExistingSame } else { PutResult::ExistingDifferent });
        }
        // The bytes go to a hidden temporary file first and are linked under their name only once complete, so a
        // failed write (a full disk) never leaves a truncated image under the name later saves would find.
        #[cfg(target_os = "macos")]
        {
            use std::os::fd::AsRawFd;
            let entry = c_name(name)?;
            let temp = c_name(OsStr::new(&format!(".mino-asset-{}-{}.tmp", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed))))?;
            let mut file = crate::fs::create_file_at(&self.assets, &temp, libc::O_WRONLY, 0o644).map_err(|_| "ASSET_WRITE_FAILED")?;
            let written = if fail_write() { Err(std::io::Error::other("injected")) } else { file.write_all(bytes).and_then(|_| file.sync_all()) };
            drop(file);
            let linked = written.is_ok() && unsafe { libc::linkat(self.assets.as_raw_fd(), temp.as_ptr(), self.assets.as_raw_fd(), entry.as_ptr(), 0) } == 0;
            let exists = !linked && written.is_ok() && std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists;
            unsafe { libc::unlinkat(self.assets.as_raw_fd(), temp.as_ptr(), 0); }
            if exists {
                return Ok(match self.read(name)? {
                    Some(existing) if existing == bytes => PutResult::ExistingSame,
                    Some(_) => PutResult::ExistingDifferent,
                    None => return Err("ASSET_WRITE_FAILED".into()),
                });
            }
            if !linked { return Err("ASSET_WRITE_FAILED".into()); }
            self.assets.sync_all().map_err(|_| "COMMIT_UNCERTAIN")?;
            Ok(PutResult::Created)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let path = self.assets_path.join(name);
            let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_| "ASSET_WRITE_FAILED")?;
            if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() { let _ = fs::remove_file(&path); return Err("ASSET_WRITE_FAILED".into()); }
            Ok(PutResult::Created)
        }
    }

    /// Removes a regular file from the folder, never a link or a folder (T109: undoing a copy made for a move).
    pub fn remove(&self, name: &OsStr) -> Result<(), String> {
        valid_name(name)?;
        #[cfg(target_os = "macos")]
        {
            use std::os::fd::AsRawFd;
            let entry = c_name(name)?;
            let mut stat: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::fstatat(self.assets.as_raw_fd(), entry.as_ptr(), &mut stat, libc::AT_SYMLINK_NOFOLLOW) } < 0 { return Err("ASSET_NOT_FOUND".into()); }
            if stat.st_mode & libc::S_IFMT != libc::S_IFREG { return Err("OUT_OF_SCOPE".into()); }
            if unsafe { libc::unlinkat(self.assets.as_raw_fd(), entry.as_ptr(), 0) } < 0 { return Err("IO_ERROR".into()); }
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let path = self.assets_path.join(name);
            let meta = fs::symlink_metadata(&path).map_err(|_| "ASSET_NOT_FOUND")?;
            if !meta.is_file() { return Err("OUT_OF_SCOPE".into()); }
            fs::remove_file(path).map_err(|_| "IO_ERROR".into())
        }
    }

    /// Where an image in the folder is on disk, for moving it to the Trash.
    pub fn path_of(&self, name: &OsStr) -> Result<PathBuf, String> {
        valid_name(name)?;
        Ok(self.parent_path.join("assets").join(name))
    }

    pub fn verify_location(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            crate::fs::still_at(&self.parent_path, &self.parent, "OUT_OF_SCOPE")?;
            crate::fs::still_entry(&self.parent, &c_name(OsStr::new("assets"))?, &self.assets, "OUT_OF_SCOPE")?;
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

    fn sample() -> PathBuf {
        crate::fs::test_dir("asset-dir")
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
    fn a_failed_write_leaves_no_file_under_the_name_and_the_next_put_succeeds() {
        let dir = sample();
        let assets = AssetDirectory::open(&dir, true).unwrap();
        let name = OsStr::new("image.png");
        FAIL_WRITE.with(|fail| fail.set(true));
        let failed = assets.put(name, b"image");
        FAIL_WRITE.with(|fail| fail.set(false));
        assert_eq!(failed.err().as_deref(), Some("ASSET_WRITE_FAILED"));
        assert_eq!(fs::read_dir(dir.join("assets")).unwrap().count(), 0, "no truncated image and no temporary file");
        assert_eq!(assets.put(name, b"image").unwrap(), PutResult::Created);
        assert_eq!(fs::read(dir.join("assets/image.png")).unwrap(), b"image");
        assert_eq!(fs::read_dir(dir.join("assets")).unwrap().count(), 1);
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
