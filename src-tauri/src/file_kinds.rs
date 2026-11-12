use std::path::Path;

/// What a file is opened as (T81). This module is the only list of supported extensions: `documents.rs`,
/// `workspace.rs`, `open_intents.rs` and the frontend's `kinds.ts` (compared by a test) all follow it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DocumentKind { Markdown, Text, Code, Pdf }

pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];
pub const TEXT_EXTENSIONS: &[&str] = &["txt", "text"];
pub const CODE_EXTENSIONS: &[&str] = &["log", "json", "jsonc", "yaml", "yml", "toml", "xml", "csv", "tsv", "ini", "conf", "cfg", "properties", "sh", "bash", "zsh", "py", "js", "mjs", "cjs", "jsx", "ts", "tsx", "rs", "go", "java", "kt", "swift", "c", "h", "cpp", "cc", "hpp", "cs", "rb", "php", "lua", "sql", "css", "scss", "less", "html", "htm", "vue", "tex", "diff", "patch", "bat", "ps1", "gradle"];
pub const PDF_EXTENSIONS: &[&str] = &["pdf"];

/// Text documents, as before.
pub const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
/// A PDF is read in ranges and never held whole in the webview, so it may be larger.
pub const MAX_PDF_BYTES: u64 = 200 * 1024 * 1024;

impl DocumentKind {
    pub fn of(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        let extension = extension.as_str();
        if MARKDOWN_EXTENSIONS.contains(&extension) { Some(Self::Markdown) }
        else if TEXT_EXTENSIONS.contains(&extension) { Some(Self::Text) }
        else if CODE_EXTENSIONS.contains(&extension) { Some(Self::Code) }
        else if PDF_EXTENSIONS.contains(&extension) { Some(Self::Pdf) }
        else { None }
    }

    pub fn as_str(self) -> &'static str {
        match self { Self::Markdown => "markdown", Self::Text => "text", Self::Code => "code", Self::Pdf => "pdf" }
    }

    /// Kinds whose content is text: they can be edited, saved, searched and created.
    pub fn is_text(self) -> bool { self != Self::Pdf }

    pub fn max_bytes(self) -> u64 { if self == Self::Pdf { MAX_PDF_BYTES } else { MAX_TEXT_BYTES } }
}

/// True for a path whose content is text and may be written by the app.
pub fn is_text_path(path: &Path) -> bool { DocumentKind::of(path).is_some_and(DocumentKind::is_text) }

/// The lower-case extension of a supported file.
pub fn extension(path: &Path) -> Option<String> {
    DocumentKind::of(path)?;
    Some(path.extension()?.to_str()?.to_ascii_lowercase())
}

/// A PDF starts with its header within the first 1024 bytes.
pub fn looks_like_pdf(head: &[u8]) -> bool {
    head[..head.len().min(1024)].windows(5).any(|window| window == b"%PDF-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_follow_the_extension_whatever_its_case() {
        for (name, kind) in [("a.md", DocumentKind::Markdown), ("a.MARKDOWN", DocumentKind::Markdown), ("小说.TXT", DocumentKind::Text), ("a.text", DocumentKind::Text), ("a.json", DocumentKind::Code), ("server.LOG", DocumentKind::Code), ("a.tar.yml", DocumentKind::Code), ("a.PDF", DocumentKind::Pdf)] {
            assert_eq!(DocumentKind::of(Path::new(name)), Some(kind), "{name}");
        }
        for name in ["a", "a.docx", "a.epub", "a.png", ".txt", "a.md.bak", "a.exe", "a."] { assert_eq!(DocumentKind::of(Path::new(name)), None, "{name}"); }
    }

    #[test]
    fn no_extension_is_listed_twice() {
        let all: Vec<_> = [MARKDOWN_EXTENSIONS, TEXT_EXTENSIONS, CODE_EXTENSIONS, PDF_EXTENSIONS].concat();
        let unique: std::collections::HashSet<_> = all.iter().collect();
        assert_eq!(all.len(), unique.len());
        assert!(all.iter().all(|extension| !extension.is_empty() && extension.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())));
    }

    #[test]
    fn only_pdf_is_read_only_and_large() {
        assert!(DocumentKind::Markdown.is_text() && DocumentKind::Text.is_text() && DocumentKind::Code.is_text() && !DocumentKind::Pdf.is_text());
        assert!(is_text_path(Path::new("a.txt")) && !is_text_path(Path::new("a.pdf")) && !is_text_path(Path::new("a.docx")));
        assert_eq!(DocumentKind::Pdf.max_bytes(), 200 * 1024 * 1024);
        assert_eq!(DocumentKind::Text.max_bytes(), 20 * 1024 * 1024);
    }

    #[test]
    fn a_pdf_header_is_found_near_the_start_only() {
        assert!(looks_like_pdf(b"%PDF-1.7\n"));
        assert!(looks_like_pdf(&[b"\xef\xbb\xbfjunk ".as_slice(), b"%PDF-1.4"].concat()));
        assert!(!looks_like_pdf(b"PK\x03\x04"));
        assert!(!looks_like_pdf(b""));
        assert!(!looks_like_pdf(&[vec![b' '; 2000], b"%PDF-1.4".to_vec()].concat()));
    }
}
