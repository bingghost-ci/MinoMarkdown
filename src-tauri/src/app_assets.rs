use tauri::{ipc::Response, AppHandle, WebviewWindow};

fn plain_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 160 && !name.starts_with('.') && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')) && !name.contains("..")
}

/// Only built WOFF2 font files under `/assets/` can be read, for embedding in exported HTML and print pages,
/// and the character maps and standard fonts the PDF renderer needs (T86): the webview's CSP does not let it
/// fetch them. These are the app's own bundled files; no document or user path is reachable through this command.
pub(crate) fn allowed_path(path: &str) -> bool {
    if let Some(name) = path.strip_prefix("/assets/") { return plain_name(name) && name.ends_with(".woff2"); }
    if let Some(name) = path.strip_prefix("/pdfjs/cmaps/") { return plain_name(name) && name.ends_with(".bcmap"); }
    if let Some(name) = path.strip_prefix("/pdfjs/standard_fonts/") { return plain_name(name) && (name.ends_with(".pfb") || name.ends_with(".ttf")); }
    false
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
    #[test]
    fn the_pdf_renderer_reads_only_its_character_maps_and_fonts() {
        for path in ["/pdfjs/cmaps/UniGB-UCS2-H.bcmap", "/pdfjs/cmaps/78-EUC-H.bcmap", "/pdfjs/standard_fonts/FoxitSerif.pfb", "/pdfjs/standard_fonts/LiberationSans-Regular.ttf"] { assert!(allowed_path(path), "{path}"); }
        for path in ["/pdfjs/cmaps/../../index.html", "/pdfjs/cmaps/a/b.bcmap", "/pdfjs/cmaps/x.js", "/pdfjs/standard_fonts/x.woff2", "/pdfjs/pdf.worker.mjs", "/pdfjs/cmaps/.bcmap", "/pdfjs/cmaps/", "/pdfjs/standard_fonts/x.pfb?", "pdfjs/cmaps/x.bcmap", "/pdfjs/cmaps/x%2e.bcmap"] {
            assert!(!allowed_path(path), "{path}");
        }
    }
}
