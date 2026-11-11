use tauri::{ipc::Response, AppHandle, WebviewWindow};

/// Only built WOFF2 font files under `/assets/` can be read, for embedding in exported HTML and print pages.
/// These are the app's own bundled files; no document or user path is reachable through this command.
pub(crate) fn allowed_path(path: &str) -> bool {
    let Some(name) = path.strip_prefix("/assets/") else { return false };
    name.len() <= 160 && name.ends_with(".woff2") && !name.starts_with('.') && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')) && !name.contains("..")
}

#[tauri::command(async)]
pub fn read_app_asset(app: AppHandle, window: WebviewWindow, path: String) -> Result<Response, String> {
    if !crate::is_workspace_window(window.label()) { return Err("OUT_OF_SCOPE".into()); }
    if !allowed_path(&path) { return Err("OUT_OF_SCOPE".into()); }
    app.asset_resolver().get(path).map(|asset| Response::new(asset.bytes)).ok_or_else(|| "ASSET_NOT_FOUND".into())
}

#[cfg(test)]
mod tests {
    use super::allowed_path;
    #[test]
    fn only_bundled_woff2_files_are_readable() {
        assert!(allowed_path("/assets/noto-serif-sc-116-400-normal-B1x_9a.woff2"));
        for path in ["/assets/../index.html", "/assets/a/b.woff2", "/assets/x.js", "/etc/passwd", "assets/x.woff2", "/assets/.woff2", "/assets/x%2F.woff2", "/assets/x..woff2", "/node_modules/a.woff2", "/assets/x.woff2?"] {
            assert!(!allowed_path(path), "{path}");
        }
    }
}
