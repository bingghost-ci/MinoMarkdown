# T82 文本编码

日期：2026-11-12。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

`src-tauri/src/text_encoding.rs`，依赖 `encoding_rs` 0.8.42 与 `chardetng` 1.0.0（都不联网）。

- 识别顺序：UTF-8 BOM → UTF-16 LE / BE BOM → 含 NUL 时按奇偶位置判断无 BOM 的 UTF-16，否则判为二进制 → 合法 UTF-8 → `chardetng` 的猜测，再依次尝试 GB18030、Big5。候选编码必须能无错误地解码整个文件，否则 `INVALID_ENCODING`。GBK 按 GB18030 处理。
- UTF-8 的行为不变：带 BOM 的文件仍把 BOM 留在文本里交给前端（Markdown codec 记录并还原）。UTF-16 的 BOM 从文本去掉，记在 `Grant` 里，保存时加回。
- 保存按 `Grant` 的编码写回。有原编码表示不了的字符，或打开时“解码再编码”与原字节不一致，返回 `UNENCODABLE`；前端询问是否改存 UTF-8，同意才带 `forceUtf8` 重试，不同意什么都不写。编码检查在写任何附件之前进行。
- 保存前的冲突检查改为只比较磁盘字节的 SHA-256，不再解码，所以磁盘文件变成无法解码的内容时得到的是 `CONFLICT` 而不是编码错误。
- 状态栏显示编码（Markdown 只在不是 UTF-8 时显示）。

## 自动化验证

Rust `text_encoding::tests`（8 项）：UTF-8 有无 BOM、UTF-16 LE / BE 有无 BOM、GB18030、Big5 的识别与逐字节往返；Big5 文本编辑后仍是 Big5，加入 emoji 返回 `UNENCODABLE`，GB18030 可以写任何字符；读取不精确的文件只能存为 UTF-8；ZIP 头、PNG 头、控制字符序列判为二进制，带终端颜色码的日志仍是文本；`the_sample_files_decode_to_the_same_text_and_encode_back_to_their_bytes` 对 `tests/fixtures/formats` 的样例逐个验证。`documents::tests`：`saved_copies_keep_the_kind_or_become_markdown`、`the_disk_revision_is_taken_from_bytes_whatever_they_decode_to`。

## 已知限制

- 很短的、或只含少量非 ASCII 字符的 GBK / Big5 文件，`chardetng` 可能猜错；没有手动选择编码的界面。
- `chardetng` 还能猜出 Shift_JIS、EUC-KR、Windows-125x 等编码，文件会按猜到的编码打开和写回，但这些没有样例也没有测试。UTF-32 不支持。
- “改存 UTF-8”的询问用的是 webview 的 `window.confirm`，没有实机看过它在 Tauri 窗口里的样子。

## 未验证

真实的 GBK 小说、UTF-16 文本；编辑后用 `file` 或十六进制确认磁盘字节；`UNENCODABLE` 的询问流程。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。
