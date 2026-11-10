# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mino is a local, offline Markdown editor for macOS on Apple Silicon, built with Tauri 2 (Rust), React 19, TypeScript, and Milkdown/Crepe. The toolchain must be arm64: Node ≥22 (`.nvmrc` pins 22.23.2), Rust, and the Xcode Command Line Tools.

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
./build.sh                                        # clean release build and package; never changes the version
./start.sh                                        # build.sh, then open the app (--build-only skips opening)
./install.sh                                      # bump patch, build, install to /Applications, commit, tag, push, save symbols, remove build output
```

There is no linter configured. `./start.sh` exits if `mino-markdown` is already running. `./build.sh` deletes the previous bundle, `dist`, ZIP, and `dist-package/manifest.json` but keeps Cargo caches, and its output is an unsigned app at `src-tauri/target/release/bundle/macos/Mino.app`. `./install.sh` deletes all of `src-tauri/target/debug` and `release` after saving release symbols to the git-ignored `Symbols/`, so don't run it during native acceptance unless you mean to replace the installed app and push a version tag. The version lives in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`, and they must agree.

`npm run dev` serves the UI alone in a browser, where `isTauri()` is false and no Rust commands exist.

## Architecture

### Frontend and backend boundary

- `src/app/useDocumentWorkspace.ts` is the single orchestrator. It holds tabs, session state, menu handling, and nearly every `invoke`/`listen` call (binary helpers are in `src/app/binary.ts`). `src/app/App.tsx` only lays out `src/app/components/`, and any name a component uses must be in the hook's final `return`. Feature modules under `src/features` and `src/core` have no IPC of their own.
- The webview has no filesystem or network plugin permissions (`src-tauri/capabilities/main.json`, CSP in `tauri.conf.json`). All disk access goes through custom commands.
- To add a command, implement it in the relevant Rust module, register it in `generate_handler!` in `src-tauri/src/lib.rs`, and call it from `useDocumentWorkspace.ts`. Commands that touch files, hashes, or images use `#[tauri::command(async)]`, and native menu changes must run on the main thread.
- Commands return bare string error codes such as `OUT_OF_SCOPE` or `CONFLICT`.
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

- `save_document` compares `expected_revision` (a SHA-256 of disk bytes) to detect conflicts, and writes through `src-tauri/src/fs/atomic_write.rs`. That module has `#[cfg(test)]` fault injection that covers failures before commit.
- Local images display through the `mino-asset` URI scheme, which rechecks the grant per request. Binary uploads go through `stage_binary` (`staging.rs`), and commands receive staged references rather than bytes.
- Images added in the editor stay pending in `EditorAdapter` until save. They are then uploaded with the document, written to `assets/` beside it by `fs/asset_directory.rs`, and returned as rewritten relative references.
- Unsaved edits are debounced into drafts in the app data directory (`drafts.rs`).

### Limits and exports

- The 2 MiB source-protection threshold is `VISUAL_SIZE_LIMIT_BYTES` in `compatibility.ts`. Raw HTML and footnotes stay visual, and the fragments are rechecked after the editor loads. The 20 MiB document and image limits are enforced in Rust.
- HTML export, print, and preview must keep sanitizing untrusted markup and must not load remote images. Exports read immutable snapshots (`snapshots.rs`, `src/features/export/snapshot.ts`).

## Tests

Vitest tests are in `tests/`. Rust tests are inline `#[cfg(test)]` modules, and there is no `src-tauri/tests` directory. Fixtures in `tests/fixtures` are described by `manifest.json`, and the development build loads `tests/fixtures/markdown/F01`–`F05` through `import.meta.glob`; production builds don't include them.

Automated tests don't cover native macOS behavior. Finder integration, Chinese IME input, system PDF output, and performance are verified manually, per `doc/05-验收与发布.md`.

## Project documents

The docs in `doc/` are written in Chinese and start at `doc/README.md`.

- `doc/06-开发进度.md` is the only place task status is recorded. Other documents must not copy it, and `codeComplete`, automated verification, device verification, and user acceptance are tracked separately.
- `doc/02-技术设计.md` includes planned structures and interfaces that may not exist yet, so check the code before relying on it.
- `Markdown编辑器.md` is the original requirements file. Its SHA-256 is recorded in `doc/README.md`, so don't modify it.
- When requirements change, update the product plan, technical design, development plan, Goal list, and acceptance mapping in that order, and record the affected task numbers. Tasks T01–T29 correspond to Goals G01–G29.
