# T81 文档类型框架

日期：2026-11-12。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src-tauri/src/file_kinds.rs` 是受支持扩展名的唯一来源：Markdown（`md`、`markdown`）、纯文本（`txt`、`text`）、代码与配置（50 个扩展名）、PDF。`documents.rs`、`workspace.rs`、`open_intents.rs` 原来各自的 `md` 判断都改为调用它；`snapshots.rs` 里剩下的一处判断的是“导出 Markdown”的目标文件，保持只认 `md`。
- 前端 `src/features/document/kinds.ts` 重复同一张表，用于标签、状态栏和草稿恢复。
- 内容复核：PDF 必须在前 1024 字节内出现 `%PDF-`；文本类含 NUL 或大量控制字符时判为二进制。不符返回 `UNSUPPORTED_FORMAT`；扩展名不在表内仍是 `UNSUPPORTED_FILE_TYPE`。
- `OpenDocument`、`SaveResult` 增加 `kind`、`encoding`（`OpenDocument` 另有 `size`）；`Grant` 记录类型与编码。
- 打开对话框的过滤器为“所有支持的文档 / Markdown / 纯文本 / PDF”。拖入与 Finder 打开的意图类型由 `markdown` 改名为 `document`。`tauri.conf.json` 的 `fileAssociations` 增加三组，`rank` 均为 `Alternate`，PDF 的 `role` 为 `Viewer`。
- 文件栏列出全部受支持类型；新建接受文本类扩展名（不能新建 PDF）；重命名不能改变文件类型（`a.txt` 不能改成 `a.md`），避免已打开的文档与磁盘类型不一致；全文搜索覆盖 Markdown、纯文本、代码文件并按各自编码解码，不搜 PDF。

## 自动化验证

- Rust `file_kinds::tests`（4 项）：扩展名不分大小写、无重复、只有 PDF 只读且上限 200 MiB、PDF 头只在开头附近识别。
- Rust `documents::tests::each_kind_opens_as_what_its_extension_says_and_binary_content_is_refused`：GB18030 的 TXT、JSON、PDF 各自以正确类型打开；伪装成 `.txt` 的 ZIP、没有 PDF 头的 `.pdf`、MPEG-TS 的 `.ts` 返回 `UNSUPPORTED_FORMAT`；`.docx` 返回 `UNSUPPORTED_FILE_TYPE`。
- Rust `new_kinds_do_not_follow_links_either`：TXT、PDF 的符号链接和经符号链接目录的路径都返回 `OUT_OF_SCOPE`。
- Rust `workspace::tests`：`invalid_names_are_rejected`、`a_rename_keeps_the_kind_of_the_file`、`search_covers_text_and_source_files_in_their_own_encoding`（GB18030、UTF-16、UTF-8 三个文件各命中一次）。
- Rust `open_intents` 测试：TXT、YAML、PDF 进入打开队列，`.docx` 不进入。
- Vitest `tests/document-kinds.test.ts`（5 项）：前端四张表与 `file_kinds.rs` 逐项相同；`tauri.conf.json` 关联的扩展名与表相同且全部为 `Alternate`。

## 未验证

打开对话框、拖入、Finder“打开方式”、最近文件、会话恢复都只有 Rust 侧的路径测试，没有在真实应用里操作过。Finder 是否把 Mino 列进这些类型的“打开方式”、是否没有抢占默认应用，需要安装后实测。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。
