use encoding_rs::{Encoding, BIG5, GB18030, GBK, UTF_16BE, UTF_16LE, UTF_8};

/// How a text file is stored on disk (T82), so that it is written back the way it was read.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TextEncoding {
    pub encoding: &'static Encoding,
    /// A byte-order mark that was removed from the text. A UTF-8 mark stays in the text instead (the Markdown
    /// codec records and restores it), so this is only ever true for UTF-16.
    pub bom: bool,
    /// Encoding the decoded text gives back the file's bytes. When it does not, the file can only be saved as UTF-8.
    pub exact: bool,
}

impl TextEncoding {
    pub const UTF8: TextEncoding = TextEncoding { encoding: UTF_8, bom: false, exact: true };

    /// The name shown in the status bar.
    pub fn label(&self) -> String {
        let name = if self.encoding == GB18030 { "GB18030" } else if self.encoding == BIG5 { "Big5" } else { self.encoding.name() };
        if self.bom { format!("{name} BOM") } else { name.to_owned() }
    }
}

pub struct Decoded { pub text: String, pub encoding: TextEncoding }

fn strict(encoding: &'static Encoding, bytes: &[u8]) -> Option<String> {
    encoding.decode_without_bom_handling_and_without_replacement(bytes).map(|text| text.into_owned())
}

/// UTF-16 without a mark: in mostly-ASCII text every other byte is zero.
fn unmarked_utf16(bytes: &[u8]) -> Option<&'static Encoding> {
    if bytes.len() < 4 || bytes.len() % 2 != 0 { return None; }
    let sample = &bytes[..bytes.len().min(4096) & !1];
    let pairs = sample.len() / 2;
    let even = sample.iter().step_by(2).filter(|byte| **byte == 0).count();
    let odd = sample.iter().skip(1).step_by(2).filter(|byte| **byte == 0).count();
    if odd * 10 >= pairs * 3 && even * 20 <= pairs { Some(UTF_16LE) }
    else if even * 10 >= pairs * 3 && odd * 20 <= pairs { Some(UTF_16BE) }
    else { None }
}

/// Text has no NUL and next to no other control characters; anything else is a binary file with a text extension.
fn is_text(text: &str) -> bool {
    let mut controls = 0usize;
    let mut total = 0usize;
    for character in text.chars() {
        total += 1;
        if character == '\0' { return false; }
        if character.is_control() && !matches!(character, '\t' | '\n' | '\r' | '\u{c}' | '\u{1b}' | '\u{8}') { controls += 1; }
    }
    controls * 200 <= total
}

/// Decodes a text file, or says why it cannot be shown: `UNSUPPORTED_FORMAT` for binary content,
/// `INVALID_ENCODING` for text in an encoding that could not be recognized.
pub fn decode(bytes: &[u8]) -> Result<Decoded, &'static str> {
    let done = |text: String, encoding: &'static Encoding, bom: bool, body: &[u8]| {
        if !is_text(&text) { return Err("UNSUPPORTED_FORMAT"); }
        let candidate = TextEncoding { encoding, bom: false, exact: true };
        let exact = encode_body(&text, candidate).is_ok_and(|encoded| encoded == body);
        Ok(Decoded { text, encoding: TextEncoding { encoding, bom, exact } })
    };
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        let text = std::str::from_utf8(bytes).map_err(|_| "INVALID_ENCODING")?.to_owned();
        return done(text, UTF_8, false, bytes);
    }
    for (mark, encoding) in [([0xff, 0xfe], UTF_16LE), ([0xfe, 0xff], UTF_16BE)] {
        if bytes.starts_with(&mark) {
            let body = &bytes[2..];
            return done(strict(encoding, body).ok_or("INVALID_ENCODING")?, encoding, true, body);
        }
    }
    // Checked before UTF-8: ASCII text stored as UTF-16 is also valid UTF-8, with a NUL after every letter.
    if bytes.contains(&0) {
        let encoding = unmarked_utf16(bytes).ok_or("UNSUPPORTED_FORMAT")?;
        return done(strict(encoding, bytes).ok_or("UNSUPPORTED_FORMAT")?, encoding, false, bytes);
    }
    if let Ok(text) = std::str::from_utf8(bytes) { return done(text.to_owned(), UTF_8, false, bytes); }
    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let guess = detector.guess(None, chardetng::Utf8Detection::Deny);
    let guess = if guess == GBK { GB18030 } else { guess };
    for encoding in [guess, GB18030, BIG5] {
        if encoding == UTF_8 || encoding == UTF_16LE || encoding == UTF_16BE { continue; }
        if let Some(text) = strict(encoding, bytes) { return done(text, encoding, false, bytes); }
    }
    Err("INVALID_ENCODING")
}

fn encode_body(text: &str, encoding: TextEncoding) -> Result<Vec<u8>, &'static str> {
    if encoding.encoding == UTF_8 { return Ok(text.as_bytes().to_vec()); }
    if encoding.encoding == UTF_16LE || encoding.encoding == UTF_16BE {
        let little = encoding.encoding == UTF_16LE;
        let mut out = Vec::with_capacity(text.len() * 2);
        for unit in text.encode_utf16() { out.extend_from_slice(&if little { unit.to_le_bytes() } else { unit.to_be_bytes() }); }
        return Ok(out);
    }
    let (bytes, _, unmappable) = encoding.encoding.encode(text);
    if unmappable { Err("UNENCODABLE") } else { Ok(bytes.into_owned()) }
}

/// The bytes to write for `text`. `UNENCODABLE` when the text has characters the encoding lacks, or when the
/// file was not read exactly and writing it back in the same encoding could change bytes the user never touched.
pub fn encode(text: &str, encoding: TextEncoding) -> Result<Vec<u8>, &'static str> {
    if !encoding.exact { return Err("UNENCODABLE"); }
    let body = encode_body(text, encoding)?;
    if !encoding.bom { return Ok(body); }
    let mark: &[u8] = if encoding.encoding == UTF_16LE { &[0xff, 0xfe] } else if encoding.encoding == UTF_16BE { &[0xfe, 0xff] } else { &[] };
    Ok([mark, &body].concat())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "第一章 起点\r\n\r\n这是一个用来检查编码识别的段落，里面有中文、English words 和数字 12345。\r\n他说：“我们明天再继续读这本书吧。”于是合上了书页，窗外已经是傍晚了。\n";
    const TRADITIONAL: &str = "第一章 開始\n\n這是一個用來檢查編碼識別的段落，裡面有繁體中文與標點符號。\n他說：「我們明天再繼續讀這本書吧。」於是闔上了書頁，窗外已經是傍晚了。\n臺灣的讀者通常使用這種編碼來儲存純文字檔案，請確認顯示沒有亂碼。\n";

    fn round_trip(bytes: &[u8], expected: &'static Encoding, bom: bool, text: &str) {
        let decoded = decode(bytes).unwrap();
        assert_eq!(decoded.encoding.encoding, expected);
        assert_eq!(decoded.encoding.bom, bom);
        assert!(decoded.encoding.exact);
        assert_eq!(decoded.text, text);
        assert_eq!(encode(&decoded.text, decoded.encoding).unwrap(), bytes);
    }

    #[test]
    fn utf8_with_and_without_a_mark_keeps_its_text_whole() {
        round_trip(SAMPLE.as_bytes(), UTF_8, false, SAMPLE);
        let marked = [b"\xef\xbb\xbf".as_slice(), SAMPLE.as_bytes()].concat();
        // The mark stays in the text, as the Markdown codec expects.
        round_trip(&marked, UTF_8, false, &format!("\u{feff}{SAMPLE}"));
        assert_eq!(decode(b"").unwrap().text, "");
    }

    #[test]
    fn utf16_is_read_with_or_without_a_mark_and_written_back_the_same() {
        let le: Vec<u8> = SAMPLE.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let be: Vec<u8> = SAMPLE.encode_utf16().flat_map(u16::to_be_bytes).collect();
        round_trip(&[b"\xff\xfe".as_slice(), &le].concat(), UTF_16LE, true, SAMPLE);
        round_trip(&[b"\xfe\xff".as_slice(), &be].concat(), UTF_16BE, true, SAMPLE);
        let ascii = "plain ASCII text, saved as UTF-16 without a byte-order mark\n";
        let unmarked: Vec<u8> = ascii.encode_utf16().flat_map(u16::to_le_bytes).collect();
        round_trip(&unmarked, UTF_16LE, false, ascii);
        // An odd number of bytes after the mark is not UTF-16.
        assert_eq!(decode(b"\xff\xfea\x00b").err(), Some("INVALID_ENCODING"));
    }

    #[test]
    fn gb18030_and_big5_are_recognized() {
        let (gb, _, failed) = GB18030.encode(SAMPLE);
        assert!(!failed);
        round_trip(&gb, GB18030, false, SAMPLE);
        let (big5, _, failed) = BIG5.encode(TRADITIONAL);
        assert!(!failed);
        round_trip(&big5, BIG5, false, TRADITIONAL);
    }

    #[test]
    fn an_edit_is_written_in_the_original_encoding_or_refused() {
        let (big5, _, _) = BIG5.encode(TRADITIONAL);
        let decoded = decode(&big5).unwrap();
        let edited = decoded.text.replace("開始", "序幕");
        let written = encode(&edited, decoded.encoding).unwrap();
        assert_eq!(decode(&written).unwrap().text, edited);
        assert_ne!(written, edited.as_bytes());
        // Big5 has no emoji; the file must not be written with a replacement.
        assert_eq!(encode(&format!("{edited}😀"), decoded.encoding).err(), Some("UNENCODABLE"));
        assert_eq!(encode(&format!("{edited}😀"), TextEncoding::UTF8).unwrap(), format!("{edited}😀").as_bytes());
        // GB18030 covers all of Unicode.
        let (gb, _, _) = GB18030.encode(SAMPLE);
        let decoded = decode(&gb).unwrap();
        assert!(encode(&format!("{}😀", decoded.text), decoded.encoding).is_ok());
    }

    #[test]
    fn a_file_that_was_not_read_exactly_is_only_saved_as_utf8() {
        let inexact = TextEncoding { encoding: BIG5, bom: false, exact: false };
        assert_eq!(encode("abc", inexact).err(), Some("UNENCODABLE"));
    }

    #[test]
    fn binary_content_is_refused() {
        assert_eq!(decode(b"PK\x03\x04\x00\x00\x00\x08\x00binary\xff\xfe\x00").err(), Some("UNSUPPORTED_FORMAT"));
        assert_eq!(decode(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]).err(), Some("UNSUPPORTED_FORMAT"));
        assert_eq!(decode(b"\x01\x02\x03\x04\x05\x06\x07\x0e\x0f\x10").err(), Some("UNSUPPORTED_FORMAT"));
        // A log with terminal colors is still text.
        assert!(decode(b"\x1b[31merror\x1b[0m: something failed\n").is_ok());
    }

    /// The sample files of `tests/fixtures/formats` (written by `scripts/generate-format-fixtures.py`).
    #[test]
    fn the_sample_files_decode_to_the_same_text_and_encode_back_to_their_bytes() {
        let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/formats");
        let read = |name: &str| std::fs::read(folder.join(name)).unwrap();
        let novel = String::from_utf8(read("novel-utf8.txt")).unwrap();
        for (name, encoding, bom, text) in [
            ("novel-utf8.txt", UTF_8, false, novel.clone()),
            ("novel-gb18030.txt", GB18030, false, novel.replace('\n', "\r\n")),
            ("novel-utf16le-bom.txt", UTF_16LE, true, novel.clone()),
            ("novel-utf8-bom.txt", UTF_8, false, format!("\u{feff}{novel}")),
        ] {
            let bytes = read(name);
            let decoded = decode(&bytes).unwrap_or_else(|code| panic!("{name}: {code}"));
            assert_eq!((decoded.encoding.encoding, decoded.encoding.bom, decoded.encoding.exact), (encoding, bom, true), "{name}");
            assert_eq!(decoded.text, text, "{name}");
            assert_eq!(encode(&decoded.text, decoded.encoding).unwrap(), bytes, "{name}");
        }
        let big5 = decode(&read("essay-big5.txt")).unwrap();
        assert_eq!(big5.encoding.encoding, BIG5);
        assert!(big5.text.starts_with("第一章 開始\n") && big5.text.contains("臺灣的讀者"));
        assert_eq!(decode(&read("archive-named.txt")).err(), Some("UNSUPPORTED_FORMAT"));
        for name in ["config.json", "settings.yaml", "server.log", "table.csv", "table.tsv", "page.html", "wrapped-english.txt"] { assert_eq!(decode(&read(name)).unwrap().encoding, TextEncoding::UTF8, "{name}"); }
        assert!(crate::file_kinds::looks_like_pdf(&read("sample.pdf")) && crate::file_kinds::looks_like_pdf(&read("scanned.pdf")) && !crate::file_kinds::looks_like_pdf(&read("not-a.pdf")));
    }

    #[test]
    fn labels_name_the_encoding() {
        assert_eq!(TextEncoding::UTF8.label(), "UTF-8");
        assert_eq!(TextEncoding { encoding: UTF_16LE, bom: true, exact: true }.label(), "UTF-16LE BOM");
        assert_eq!(TextEncoding { encoding: GB18030, bom: false, exact: true }.label(), "GB18030");
        assert_eq!(TextEncoding { encoding: BIG5, bom: false, exact: true }.label(), "Big5");
    }
}
