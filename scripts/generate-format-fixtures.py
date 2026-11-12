#!/usr/bin/env python3
"""Writes the sample files for T81-T89 into tests/fixtures/formats and prints their manifest entries.

The files are small and deterministic: running this again produces the same bytes. `--check` compares the
files on disk with what would be written and exits 1 on any difference.
"""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
OUT = ROOT / 'formats'

NOVEL = (
    "第一卷 海边的灯塔\n\n"
    "序章\n\n"
    "　　很多年以后，他仍然记得那个傍晚：风从海面上吹来，带着盐和铁锈的气味。\n"
    "　　“你确定要去吗？”她问。\n\n"
    "第一章 出发\n\n"
    "　　清晨五点，镇上的第一班车准时开出。车窗上结着一层薄薄的雾气，他用手指在上面写下 *今天* 两个字。\n"
    "　　# 这一行以井号开头，但它只是正文，不是标题。\n"
    "　　<b>这里的尖括号也只是文字</b>，1 < 2 && 3 > 2。\n\n"
    "第二章 灯塔\n\n"
    "　　灯塔比照片里看起来更高。守塔人递给他一只搪瓷杯，里面是滚烫的茶。\n"
    "　　第三章的内容他还没有想好，所以这一句不是章节标题。\n\n"
    "尾声\n\n"
    "　　后来的事，就像潮水一样退去了。\n"
)
TRADITIONAL = (
    "第一章 開始\n\n"
    "這是一個用來檢查編碼識別的段落，裡面有繁體中文與標點符號。\n"
    "他說：「我們明天再繼續讀這本書吧。」於是闔上了書頁，窗外已經是傍晚了。\n\n"
    "第二章 燈塔\n\n"
    "臺灣的讀者通常使用這種編碼來儲存純文字檔案，請確認顯示沒有亂碼。\n"
)
WRAPPED = (
    "Chapter 1\n\n"
    "It was a bright cold day in April, and the clocks were\n"
    "striking thirteen. The hallway smelt of boiled cabbage\n"
    "and old rag mats.\n\n"
    "At one end of it a coloured poster, too large for indoor\n"
    "display, had been tacked to the wall.\n\n"
    "Chapter 2\n\n"
    "Outside, even through the shut window-pane, the world\n"
    "looked cold. Down in the street little eddies of wind\n"
    "were whirling dust and torn paper into spirals.\n"
)
JSON_FILE = '{\n  "name": "mino",\n  "kinds": ["markdown", "text", "code", "pdf"],\n  "limits": { "textMiB": 20, "pdfMiB": 200 },\n  "note": "中文 & <tags> stay text"\n}\n'
YAML_FILE = "# 示例配置\nserver:\n  host: 127.0.0.1\n  port: 1420\nfeatures:\n  - reading\n  - pdf\nmessage: |\n  多行文字\n  second line\n"
LOG_FILE = "2026-11-12T08:00:01Z INFO  server started on 127.0.0.1:1420\n2026-11-12T08:00:02Z WARN  缓存目录不存在，已创建\n2026-11-12T08:00:03Z \x1b[31mERROR\x1b[0m request failed: <timeout>\n"
CSV_FILE = '书名,作者,"备注, 含逗号",页数\r\n"海边的灯塔",林某,"第一行\r\n第二行",320\r\n"He said ""hi""",Smith,<b>not html</b>,12\r\n空行之后,,,\r\n'
TSV_FILE = "name\tvalue\tnote\nalpha\t1\tfirst\nbeta\t2\t含\"引号\"的文字\n"
HTML_FILE = '<!doctype html>\n<html>\n<head><title>样例</title><script>window.hacked = true</script></head>\n<body onload="alert(1)">\n  <h1>不会被执行</h1>\n  <img src="https://example.com/track.png">\n</body>\n</html>\n'


def pdf(objects, root=1):
    """Assembles numbered objects (1-based, in order) into a PDF with a classic cross-reference table."""
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root {root} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def stream(content: bytes) -> bytes:
    return f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream"


def ucs2(text: str) -> str:
    return text.encode('utf-16-be').hex().upper()


def title(text: str) -> str:
    return '<FEFF' + ucs2(text) + '>'


def sample_pdf() -> bytes:
    page1 = b"BT /F1 24 Tf 72 720 Td (Mino sample document) Tj ET\nBT /F1 12 Tf 72 690 Td (The quick brown fox jumps over the lazy dog.) Tj ET\nBT /F1 12 Tf 72 670 Td (Visit the project page) Tj ET\nBT /F1 12 Tf 72 650 Td (Jump to the last page) Tj ET"
    page2 = f"BT /F2 20 Tf 72 720 Td <{ucs2('第二页 中文内容')}> Tj ET\nBT /F2 12 Tf 72 690 Td <{ucs2('灯塔比照片里看起来更高，守塔人递给他一杯茶。')}> Tj ET".encode()
    page3 = b"BT /F1 20 Tf 72 720 Td (Appendix) Tj ET\nBT /F1 12 Tf 72 690 Td (The lighthouse keeper poured the tea. The fox was gone.) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /Outlines 14 0 R /PageMode /UseOutlines >>",                                   # 1
        b"<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",                                                        # 2
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R /Annots [12 0 R 13 0 R] >>",  # 3
        stream(page1),                                                                                                   # 4
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F2 10 0 R >> >> /Contents 6 0 R >>",  # 5
        stream(page2),                                                                                                   # 6
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",  # 7
        stream(page3),                                                                                                   # 8
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",                           # 9
        b"<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [11 0 R] >>",  # 10
        b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 /FontDescriptor 18 0 R >>",  # 11
        b"<< /Type /Annot /Subtype /Link /Rect [72 666 200 682] /Border [0 0 0] /A << /S /URI /URI (https://example.com/mino) >> >>",  # 12
        b"<< /Type /Annot /Subtype /Link /Rect [72 646 200 662] /Border [0 0 0] /Dest [7 0 R /Fit] >>",                 # 13
        b"<< /Type /Outlines /First 15 0 R /Last 17 0 R /Count 3 >>",                                                    # 14
        b"<< /Title (Introduction) /Parent 14 0 R /Next 17 0 R /First 16 0 R /Last 16 0 R /Count 1 /Dest [3 0 R /Fit] >>",  # 15
        f"<< /Title {title('第二页 中文内容')} /Parent 15 0 R /Dest [5 0 R /Fit] >>".encode(),                              # 16
        b"<< /Title (Appendix) /Parent 14 0 R /Prev 15 0 R /Dest [7 0 R /XYZ 0 792 0] >>",                              # 17
        b"<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",  # 18
    ]
    return pdf(objects)


def scanned_pdf() -> bytes:
    """Two pages that only draw shapes, as a scan only holds images: there is no text to select or extract."""
    drawing = b"0.85 g 72 300 468 420 re f\n0.2 g 100 640 300 6 re f 100 620 380 6 re f 100 600 340 6 re f"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
        stream(drawing),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>",
        stream(drawing),
    ]
    return pdf(objects)


FILES = {
    'novel-utf8.txt': (NOVEL.encode('utf-8'), ['UTF-8, LF', 'volume / chapter / prologue / epilogue titles', 'Markdown and HTML characters that must stay text']),
    'novel-gb18030.txt': (NOVEL.replace('\n', '\r\n').encode('gb18030'), ['GB18030 (GBK) bytes', 'CRLF']),
    'novel-utf16le-bom.txt': (b'\xff\xfe' + NOVEL.encode('utf-16-le'), ['UTF-16LE with byte-order mark']),
    'novel-utf8-bom.txt': (b'\xef\xbb\xbf' + NOVEL.encode('utf-8'), ['UTF-8 with byte-order mark']),
    'essay-big5.txt': (TRADITIONAL.encode('big5'), ['Big5 bytes', 'traditional Chinese']),
    'wrapped-english.txt': (WRAPPED.encode('utf-8'), ['hard-wrapped paragraphs separated by blank lines', 'Chapter N titles']),
    'config.json': (JSON_FILE.encode('utf-8'), ['JSON highlighting', 'characters that must be escaped']),
    'settings.yaml': (YAML_FILE.encode('utf-8'), ['YAML with a block scalar']),
    'server.log': (LOG_FILE.encode('utf-8'), ['log without a language', 'terminal color codes are still text']),
    'table.csv': (CSV_FILE.encode('utf-8'), ['quoted field with a comma', 'quoted field with a line break', 'doubled quotes', 'CRLF']),
    'table.tsv': (TSV_FILE.encode('utf-8'), ['tab-separated', 'quotes inside an unquoted field']),
    'page.html': (HTML_FILE.encode('utf-8'), ['script, event handler and remote image that must only be shown as source']),
    'sample.pdf': (sample_pdf(), ['3 pages of two sizes', 'standard font without embedding', 'CJK text through a predefined CMap', 'nested bookmarks', 'external and internal link']),
    'scanned.pdf': (scanned_pdf(), ['2 pages without a text layer']),
    'archive-named.txt': (b'PK\x03\x04\x14\x00\x00\x00\x08\x00' + bytes(range(32)) * 4, ['binary content behind a text extension: UNSUPPORTED_FORMAT']),
    'not-a.pdf': (b'This file has a PDF extension but no PDF header.\n', ['text behind a PDF extension: UNSUPPORTED_FORMAT']),
}


def main() -> int:
    check = '--check' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    entries, wrong = [], []
    for name, (data, checkpoints) in FILES.items():
        path = OUT / name
        if check:
            if not path.exists() or path.read_bytes() != data: wrong.append(name)
        else:
            path.write_bytes(data)
        entries.append({'id': f'FMT-{name}', 'path': f'formats/{name}', 'sha256': hashlib.sha256(data).hexdigest(), 'mode': 'asset', 'checkpoints': checkpoints})
    manifest_path = ROOT / 'manifest.json'
    manifest = [item for item in json.loads(manifest_path.read_text('utf-8')) if not item['id'].startswith('FMT-')] + entries
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if check:
        if manifest_path.read_text('utf-8') != text: wrong.append('manifest.json')
        print('different: ' + ', '.join(wrong) if wrong else f'{len(entries)} format fixtures match')
        return 1 if wrong else 0
    manifest_path.write_text(text, 'utf-8')
    print(f'wrote {len(entries)} files to {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
