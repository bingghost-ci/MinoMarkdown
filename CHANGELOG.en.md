# Changelog

[简体中文](CHANGELOG.md) · **English**

What changed in Mino for the people who use it, by version. Versions follow [Semantic Versioning](https://semver.org/): a fix raises the third number, a new feature the second, an incompatible change the first.

## 1.1.0 — 2026-11-21

A round of typography learned from Typora's theme gallery (the ideas only; the rules and colors are Mino's own), and fixes for data safety across windows. The automated tests pass. How it looks on screen and the native behavior have not been checked on a device yet.

### Added

- **Alerts**: a quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` is drawn as a card with an icon and a title. The document stays a plain quote.
- **Layouts**, chosen apart from the paper: standard, academic (section numbers, abstract, figure numbers), official (after GB/T 9704, margins included), technical and typewriter.
- **Four reading styles**: High Contrast, Terracotta, Pine and Midnight Blue, sixteen in all. Styles and layouts are picked from thumbnails in the settings.
- **Table of contents**: a paragraph that says only `[TOC]` becomes the contents in reading mode and in exports.
- **Quote styles** (follow style, bar, card, indented), **rounded tables**, **paper rulings** (grid, dots), **Chinese emphasis** (slanted, Kai, emphasis dots) and **focus mode**.
- Highlights, keys (`<kbd>`), strikethrough, footnotes and finished tasks have styles of their own, and a code block names its language in the corner.
- Western serif faces are drawn slightly larger in Chinese documents, level with the characters. Bold no longer blooms on night styles.
- Print and PDF export: no widows or orphans, no heading stranded at the foot of a page, and tables, alerts and diagrams are not cut in two.

### Fixed

- A file is open in one tab of one window only; opening it elsewhere switches to that tab.
- When saving fails as a window closes, the document can be saved under another name instead of only being discarded.
- A draft belongs to the window that opened it and cannot be recovered twice.
- An AI key is sent only to the address it was entered for.
- The editor no longer escapes `[!NOTE]` and `[TOC]` on save.

## 1.0.0 — 2026-11-20

The first version with a settled number. It holds all the work from 2026-11-07 to 2026-11-20 (50 commits, all labeled 0.1.0 until now). The features are complete and the automated tests pass. Native behavior (opening from Finder, Chinese input methods, PDF export and printing, performance) has not yet been checked item by item on a device; the package is unsigned and is built from source.

### Writing

- WYSIWYG Markdown editing: headings, lists, tasks, quotes, tables (with a size picker), code blocks, links and images; the source is one switch away.
- An image pasted or dropped is written to an `assets/` folder beside the document on save, and the Markdown holds only the relative path.
- Text transforms: spaces between Chinese and Western text, full-width and half-width punctuation, letter case.
- Content that cannot be edited visually without risk (math, directives) opens source-protected: a sanitized preview, and the file saved exactly as it was.
- Bold and italic next to Chinese characters render correctly in the editor, and both are visible in Chinese fonts.
- Raw HTML that is only layout around images (SVG included) is shown as those images; the file is unchanged.

### Reading and appearance

- Reading mode: a document opened from Finder or the sidebar is shown read-only, with progress, Space to turn the page and a click to enlarge an image; `⌘⇧R` switches to editing.
- Twelve reading styles (seven for day, five for night) with paper textures; they can follow the system appearance, and the title bar and the window's light or dark look follow the style.
- Chinese, Western and code fonts chosen separately; seven Chinese fonts, four Western fonts and monospace fonts are bundled, and installed fonts can be used.
- Adjustable line width, line spacing, paragraph spacing, first-line indent, alignment and table style; a mostly-Western document gets Western layout.
- Code highlighting tells variables, calls, properties and operators apart; seven color schemes, or your own colors role by role, kept separately for day and night.
- The settings are a window of their own and can sit on another display; pinch on the trackpad zooms the page.
- The sidebar and the outline can be resized and hidden.

### Diagrams

- Eight looks for Mermaid diagrams: On the Page, Architecture, Marker, Pencil, Chalk, Sci-fi, Fountain Pen and Colorful. Within a look you can change the color scheme (or set five colors of your own), the label font, and the pattern and routing of edges; the hand-drawn looks also offer a fill.
- The hand-drawn looks are outlined by the app itself: lines waver, corners overshoot, and a redraw is identical. Labels can use a running or a brush-written regular script.
- `:name:` in a label is drawn as an icon; cloud, burst and bare-text nodes are drawn as remarks.
- A diagram always fits the page width and no longer scrolls sideways; in reading mode a click opens it in a viewer, fitted to the window.

### Files and windows

- Tabs and windows; a tab dragged out of the window gets a window of its own.
- The sidebar holds several folders at once: full-text search, new file, rename, move by dragging, move to Trash. Moving a Markdown file takes its images along, and reading positions follow.
- Native context menus for documents, tabs and the sidebar; files dropped on the Dock icon are opened.
- The tabs of the last session can be restored at launch.

### More formats

- Plain text: UTF-8, UTF-16, GB18030 and Big5 are recognized and the file is saved in its own encoding; a long text gets an outline from its chapter headings.
- Source and configuration files: syntax highlighting and line numbers; CSV and TSV can be shown as tables.
- PDF: read-only, with zoom, text selection, the bookmark outline, find, and the page remembered.

### Export and print

- Export as Markdown with its image folder, as Markdown text only, or as self-contained HTML (styles, fonts and images embedded; nothing remote is loaded).
- Export PDF is separate from Print: an exported PDF fills each page with the paper color of the export style, with selectable text and working links; Print uses the system panel and is white by default.

### AI assistant (optional, off by default)

- For the whole document: summary, key points, concepts, background, or your own question. For selected text: explain, translate, rewrite, continue. Text selected in a PDF can be asked about too.
- An answer can be inserted into the document or saved as a note.
- Works with DeepSeek, OpenAI and compatible services; the key is kept in the macOS Keychain, and only the Rust process makes network requests.

### Safety and reliability

- Offline by default: with AI off, no network request is made. The interface has no file or network access; disk access goes through the Rust side and is limited to files the user granted.
- Atomic writes, with the previous version kept as a hidden backup; a file changed on disk is reported as a conflict, and the differences can be viewed.
- Unsaved edits are written to a draft and can be restored at the next launch.
- A save and a move exclude each other, so a file is never moved away in the middle of a save.

### Performance

- Analysis, preview and export rendering run on a background thread; the editor, PDF, diagrams and math load on demand, and the build checks the size of the entry bundle.
- A document of 200,000 characters or more shows its first screens at once and is loaded into the editor only when editing starts.
- A window appears as soon as it is styled, instead of after four seconds.

### Fixed in this version

- A document that begins with `---`, a paragraph and `---` no longer loses that paragraph on export.
- The record of reading positions can be written again after it grew too large or was damaged.
- The name fields of the sidebar and the toolbar no longer submit when Enter confirms a candidate of a Chinese input method.
- In the English interface, the new document after closing the last tab is no longer named in Chinese.
- About fifty issues found in the full code review of 2026-11-14, among them: backslash escapes lost on save, the content of one tab written into another when switching, a discarded draft coming back after the window closed, and a half-written image making every later save fail.
- The release build could not load its entry page; a second PDF failed to open; the selection in a code block was dark on light styles; one file could be opened twice.

### Engineering

- Repeated code was merged (63 items in five batches): work through an open directory is in `fs/mod.rs`, the two kinds of window share their settings logic, and the settings controls, the color palette and the dialog backdrop are shared components. The rules for reuse are in `CLAUDE.md` and `doc/10-代码复用整改.md`.
- Build scripts: `build.sh`, `install.sh`, `start.sh` and `clean.sh`, sharing `scripts/release-common.sh`.

### Known limits

- There is no download; a local build is unsigned and not notarized.
- Apple Silicon only. The bundle declares macOS 12.0 as its minimum but has only been built and used on macOS 27.
- The project's own license has not been decided.
- The other limits are in the [README](README.en.md#limits).

### How it was built

| Date | Work |
| --- | --- |
| Nov 7 | The desktop editor and the workspace interface (T01–T29) |
| Nov 8 | Several documents and windows, editor settings; safe preview of source-protected documents; fixes for local images and tab switching |
| Nov 9 | Editor performance and experience (T30–T34); new app icon, build and install scripts |
| Nov 10 | Editing enhancements after the first build and text editing enhancements (T35–T48); the app renamed Mino |
| Nov 11 | Page view, reading styles, fonts, reading mode and styled export (T49–T69); the optional AI assistant (T70–T73); resizable side panes and several folders at once (T74–T79) |
| Nov 12 | AI answers saved as notes (T80); plain text, source files and PDFs (T81–T89); the code font (T90); less main-thread work, a smaller entry bundle and less redundant code (T91–T104) |
| Nov 13 | Native context menus and a rewritten README (T105) |
| Nov 14 | PDF export split from Print (T106); diagram styles and edge settings (T107); moving sidebar entries by dragging, the tinted title bar, drops on the Dock (T108, T109); a full code review and its fixes |
| Nov 15 | The release build loads its entry page again |
| Nov 17 | Finer code highlighting; selectable code color schemes (T110) |
| Nov 19 | Custom code colors, a movable settings dialog and a settings window (T111–T113); whiteboard-sketch diagrams with icons and remarks (T113–T116); the diagram looks redone and kept readable (T117–T119) |
| Nov 20 | ChillKai replaces two Chinese fonts (T120); repeated code merged; version 1.0.0 |
