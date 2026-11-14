# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mino is a local Markdown editor and reader for macOS on Apple Silicon — it also reads and edits plain text and source files and reads PDFs — that is offline by default (the optional AI assistant is the only feature that uses the network, and only after the user turns it on), built with Tauri 2 (Rust), React 19, TypeScript, and Milkdown/Crepe. The toolchain must be arm64: Node ≥22 (`.nvmrc` pins 22.23.2), Rust, and the Xcode Command Line Tools.

## Commands

```sh
npm ci --no-audit --no-fund                       # install from the lockfile
npm run archcheck                                 # confirm Node, Rust, and Tauri CLI are arm64
npm run typecheck                                 # tsc --noEmit
npm run test                                      # all Vitest tests
npx vitest run tests/link-safety.test.ts          # one test file
npx vitest run -t "test name"                     # tests matching a name
cargo test --lib --manifest-path src-tauri/Cargo.toml              # all Rust tests
cargo test --lib --manifest-path src-tauri/Cargo.toml atomic_write # Rust tests matching a filter
cargo check --locked --offline --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev                              # desktop app with Vite on 127.0.0.1:1420
node scripts/generate-font-table.mjs --check      # the generated font files match the installed font packages
node scripts/perf-baseline.mjs out.json           # timings and bundle sizes to compare before and after a change (run npm run build first)
./build.sh                                        # clean release build and package; never changes the version
./start.sh                                        # development: npm run tauri -- dev (installs npm deps if missing, checks arm64 and port 1420)
./clean.sh                                        # remove all build output (dist, dist-package, src-tauri/target, generated schemas, Vite cache, Symbols/) and old mino-* test folders in the temp directory; keeps node_modules unless --deps; --dry-run only lists
./install.sh                                      # build.sh, install to /Applications and open it, then clean.sh; no version change, commit, tag or push
```

There is no linter configured. `./start.sh` exits if port 1420 is taken. `./build.sh` deletes the previous bundle, `dist`, ZIP, and `dist-package/manifest.json` but keeps Cargo caches, and its output is an unsigned app at `src-tauri/target/release/bundle/macos/Mino.app`. `./install.sh` asks a running Mino to quit, replaces `/Applications/Mino.app`, and its final `clean.sh` removes all of `src-tauri/target`, so don't run it during native acceptance unless you mean to replace the installed app. The version lives in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`, and they must agree.

`npm run dev` serves the UI alone in a browser, where `isTauri()` is false and no Rust commands exist.

## Architecture

### Frontend and backend boundary

- `src/app/useDocumentWorkspace.ts` is the single orchestrator. It holds tabs, session state, menu handling, and nearly every `invoke`/`listen` call (binary helpers are in `src/app/binary.ts`). `src/app/App.tsx` only lays out `src/app/components/`, and any name a component uses must be in the hook's final `return`. Feature modules under `src/features` and `src/core` have no IPC of their own.
- Any state change runs the whole hook, so what changes many times a second stays out of its state (a streaming AI answer lives in `AiStream`). The hook's return goes through `useStableFunctions` (`src/app/stable.ts`): handlers keep one identity and call the latest closure, which lets the `memo` components (file sidebar, outline, tab bar, status bar) skip renders. A `memo` component names the fields it reads in its `…Keys` list; add a field there when the component starts using it. A function called while rendering whose result depends on state must be listed in `STABLE_EXCEPT`, as `t` is.
- The hook must not call the synchronous Markdown parsers (`imageUrlsIn`, `rewriteImageUrls`, `hydrateMarkdown`): they parse the whole document on the main thread. Use the `…Async` versions in `analysisClient.ts`; `tests/main-thread-parsing.test.ts` checks this.
- The webview has no filesystem or network plugin permissions (`src-tauri/capabilities/main.json`, CSP in `tauri.conf.json`). All disk access goes through custom commands.
- To add a command, implement it in the relevant Rust module, register it in `generate_handler!` in `src-tauri/src/lib.rs`, and call it from `useDocumentWorkspace.ts`. Commands that touch files, hashes, or images use `#[tauri::command(async)]`, and native menu changes must run on the main thread.
- Commands return bare string error codes such as `OUT_OF_SCOPE` or `CONFLICT`. Each starts with `crate::require_workspace_window(&window)?`.
- Windows are labeled `main` or `workspace-*`. A new window pattern must be allowed in both the capabilities file and `is_workspace_window` in `lib.rs`.
- The native menu is built in `lib.rs` and emits `menu-action` to the focused window. Menu labels are localized in `native_menu.rs`, separately from the frontend strings in `src/app/i18n.ts`, so language changes touch both.

### Path authority

The frontend never supplies arbitrary paths for reading or writing. Rust stores (`DocumentStore`, `WorkspaceStore`, `SnapshotStore`, `IntentStore`) map opaque tokens to paths granted by a system dialog, drag-and-drop, or a Finder open. Symlinks and paths outside the granted scope are rejected. Keep new file operations behind these grants.

### Document pipeline

1. `prepareMarkdown` in `src/core/markdown/codec.ts` runs `analyzeMarkdown`, which chooses `visual` or `source-protected` mode. Documents over 2 MiB or with syntax that can't round-trip safely (math, directives) are source-protected, shown as a sanitized preview with a raw source editor, and saved unchanged.
2. In visual mode, front matter, BOM, newline style, and the trailing newline are recorded. `composeVisualMarkdown` restores them on save, so byte fidelity depends on that pair staying in sync.
3. `EditorAdapter` wraps Crepe. Editor transactions are the source of truth for the body, so React must not hold a controlled copy of it or rebuild the editor on keystrokes. Custom input handling must respect IME composition.
4. `src/features/document/session.ts` is a pure state machine. `revision` and `savedRevision` determine dirtiness, and save tickets carry `generation` so results from a replaced document are ignored and edits made during a save stay dirty.

### Saving and images

- `save_document` compares `expected_revision` (a SHA-256 of disk bytes) to detect conflicts, and writes through `src-tauri/src/fs/atomic_write.rs`. That module has `#[cfg(test)]` fault injection that covers failures before commit. Each replaced version is kept as a hidden `.mino-backup-<name>-<hash>.bak` beside the file; after a successful commit only that latest one stays. The app's own records are written with `replace_record`.
- Local images display through the `mino-asset` URI scheme, which rechecks the grant per request. Binary uploads go through `stage_binary` (`staging.rs`), and commands receive staged references rather than bytes.
- Images added in the editor stay pending in `EditorAdapter` until save. They are then uploaded with the document, written to `assets/` beside it by `fs/asset_directory.rs`, and returned as rewritten relative references.
- Unsaved edits are debounced into drafts in the app data directory (`drafts.rs`).

### Reading styles and fonts

- The twelve reading styles are data in `src/features/reading/styles.ts`; `css.ts` generates the CSS for the editor, the preview, HTML export and print from them, so a look changes in one place. The chrome is neutral gray and only the page and the accent take a style's color. `settings.rs` repeats the style IDs and the legacy-ID map, and a test compares the two.
- Switching style, font or texture strength only changes `data-theme` and CSS variables on `<html>`. It must not rebuild the editor.
- Paper textures are layered PNG tiles generated by `scripts/generate-paper-textures.mjs` (`--check` verifies them); edit the script, not the images. The app draws them from their files (`?url`); an export reads the layers of its style through `read_app_asset` and inlines them, so an exported page still loads nothing.
- Fonts are offered in `src/features/reading/fonts.ts`. The `@font-face` rules of the bundled ones are the generated `bundledFonts.css`, and the same faces as data are `fontTable.ts`, read through `fontFaces.ts` only by exports; `scripts/generate-font-table.mjs` writes both (`--check` verifies them), so run it after changing a font package. Chinese and Western fonts are chosen separately (`cjkFont`, `latinFont`), and code has its own monospace font (`codeFont`, which sets `--code-font` for code blocks, source files and the source editor); `sys:<family>` names a font installed on the Mac, listed by `list_system_fonts`, and its name is validated in both TypeScript and Rust before it reaches CSS. Only fonts whose license allows redistribution are bundled; `doc/evidence/bundled-font-licenses.tsv` and each folder under `src/assets/fonts/` record the source and license.
- A mostly-Western document (`dominantScript` in `script.ts`) gets Western layout through the same CSS variables.

### Other formats: text, source files, PDF

- `src-tauri/src/file_kinds.rs` is the only list of supported extensions and decides what a file is opened as (`markdown`, `text`, `code`, `pdf`); `src/features/document/kinds.ts` repeats it and a test compares the two, as does one for `fileAssociations` in `tauri.conf.json`. Content is checked too: binary data behind a supported extension is `UNSUPPORTED_FORMAT`.
- Text is decoded by `text_encoding.rs` (UTF-8, UTF-16, GB18030, Big5 and what `chardetng` guesses) and written back in the encoding the grant recorded. `UNENCODABLE` means the user must agree to UTF-8 first; never write a lossy file.
- A text, source or PDF document has `kind` set and `mode: 'source-protected'`; it never reaches Crepe or the Markdown analysis. Text and source files are read through their own renderers (`src/features/text/`, run in the analysis worker, output escaped with a fixed set of tags) and edited in `SourceEditor`. Keep Markdown-only paths (`switchToVisual`, snapshots, asset handling) guarded by `kind === 'markdown'`.
- A PDF is read-only and rendered by `pdfjs-dist` (`src/features/pdf/`, loaded only when one is opened). Its bytes come through `read_document_range`, which rechecks the grant and the file's identity on every call; its character maps and fonts come through `read_app_asset`. The CSP is unchanged, so nothing there may `fetch`, and WebAssembly stays off (`useWasm: false`). `scripts/pdf-assets-plugin.mjs` copies the data files into `dist/pdfjs/`.
- Reading positions of text and PDF files are kept by `positions.rs` under a hash of the path.
- Sample files live in `tests/fixtures/formats/`; edit `scripts/generate-format-fixtures.py` (`--check` verifies them), not the files. In development, `?ui-preview=editor&ui-file=<name>` shows one without Rust.

### AI assistant

- Off by default. `src-tauri/src/ai.rs` is the only code that makes network requests: OpenAI-compatible streaming chat to the address in `ai.json`, with the API key in the macOS Keychain. The webview's CSP and capabilities stay closed, so never add a frontend `fetch` for it.
- `src/features/ai/prompts.ts` builds messages and cuts or splits long documents; `src/app/aiAssistant.ts` holds the drawer state and receives its IPC from `useDocumentWorkspace.ts`. Answers are rendered through the preview renderer so they are sanitized like any document.
- Tests use a local mock server (Rust) or a fake transport (Vitest). Never put a real key in code, logs, tests or documents.

### Limits and exports

- A file of 200,000 characters or more that opens in reading mode is shown through the preview first (`src/features/document/largeDocument.ts`, `deferredVisual` in the workspace hook): its opening pages, then the whole. It is analyzed and loaded into the editor only when the user starts editing, and until then it is saved as its unchanged source.
- Analysis, preview and export rendering run in `analysis.worker.ts`. A module that touches `document` while loading stops the worker from starting, and everything then falls back to the main thread without an error; `vite.config.ts` aliases one such dependency and checks the worker bundle for it. KaTeX and the code parsers are loaded there only for a document that needs them (`loadMathRenderer`, `loadCodeParsers`).
- The window appears after the entry chunk has run. `vite.config.ts` fails the build when that chunk contains the editor, CodeMirror, PDF.js, Mermaid or KaTeX, or outgrows `ENTRY_BUDGET_BYTES`: import such code lazily, and keep modules the app shell imports free of those dependencies (`findText.ts` and `syntaxRoleNames.ts` exist for that).
- The 2 MiB source-protection threshold is `VISUAL_SIZE_LIMIT_BYTES` in `compatibility.ts`. Raw HTML and footnotes stay visual, and the fragments are rechecked after the editor loads. The 20 MiB document and image limits (200 MiB for a PDF) are enforced in Rust.
- HTML export, print, and preview must keep sanitizing untrusted markup and must not load remote images. Exports read immutable snapshots (`snapshots.rs`, `src/features/export/snapshot.ts`).
- Export PDF and Print render the same page as HTML export and hand it to `src-tauri/src/pdf_export.rs`, which loads it into an offscreen `WKWebView` (JavaScript off) and prints it with `NSPrintOperation`; `window.print()` does nothing in the app's webview. An exported PDF is printed without a page background (`pdfFile` in `css.ts`) and PDFKit then paints the paper color under each whole page, because WebKit never paints the `@page` margins; this keeps text and links. AppKit may call back from its own thread when no panel is shown. Exports (PDF and HTML) write the file chosen in the save panel with `fs::write_chosen_file`, in place and with a timeout, not with `atomic_write`: opening a privacy-protected folder such as Downloads, which the save panel does not grant, blocks.

## Tests

Vitest tests are in `tests/`. Rust tests are inline `#[cfg(test)]` modules, and there is no `src-tauri/tests` directory. Fixtures in `tests/fixtures` are described by `manifest.json`, and the development build loads `tests/fixtures/markdown/F01`–`F05` through `import.meta.glob`; production builds don't include them.

Automated tests don't cover native macOS behavior. Finder integration, Chinese IME input, system PDF output, and performance are verified manually, per `doc/05-验收与发布.md`.

## Project documents

The docs in `doc/` are written in Chinese and start at `doc/README.md`.

- `doc/06-开发进度.md` is the only place task status is recorded. Other documents must not copy it, and `codeComplete`, automated verification, device verification, and user acceptance are tracked separately.
- `doc/02-技术设计.md` includes planned structures and interfaces that may not exist yet, so check the code before relying on it.
- `Markdown编辑器.md` is the original requirements file. Its SHA-256 is recorded in `doc/README.md`, so don't modify it.
- When requirements change, update the product plan, technical design, development plan, Goal list, and acceptance mapping in that order, and record the affected task numbers. Tasks T01–T29 correspond to Goals G01–G29, and later batches keep the same numbering (T81–T89 are the text, source and PDF formats).
