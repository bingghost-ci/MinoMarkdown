# T84 TXT 编辑与保存

日期：2026-11-12。层级：codeComplete，automatedVerified（Rust 与编辑器组件有测试；整条保存链路没有自动化测试）；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 文本与代码文档：阅读模式显示预览，按 `⌘⇧R` 或铅笔按钮后显示源码编辑器（`SourceEditor`，`plain` 模式，不加载 Markdown 语法）；回到阅读模式时先取回编辑器里的文字再重画预览。查找会切到源码（阅读模式下只读），关闭查找回到预览。
- 保存、未保存标记、草稿、冲突检测、自动保存走与 Markdown 相同的 `session.ts` 状态机和命令，保存内容就是编辑器里的文本，不做规范化。
- 另存为：对话框提供原扩展名和 `md`。存为 `md` 后标签成为 Markdown 文档（UTF-8），阅读时按 Markdown 显示，开始编辑时才分析并进入可视化编辑器。
- 恢复的草稿按文件名判断类型；没有磁盘文件的文本草稿首次保存时，对话框带上原文件名和原扩展名，不会被存成 `.md`。
- 文本与代码文档没有格式工具栏；“切换源码 / 可视化”“导出 Markdown”对它们不可用。
- Rust：非 Markdown 文档带图片附件保存时返回 `INVALID_ASSET`，文本里形如 `![x](assets/x.png)` 的内容按原样写入，不创建 `assets/`。

## 自动化验证

- Vitest `tests/source-editor.test.ts` 新增 3 项：`plain` 模式没有 Markdown 语言；加载语言后文本不变且不算编辑；只读打开、解锁后可编辑，未改动的行保留 CRLF。
- Rust `text_files_are_never_given_image_attachments`、`saved_copies_keep_the_kind_or_become_markdown`（含建议文件名的校验）。
- 现有 session、草稿、冲突测试全部通过。

## 没有自动化测试的部分

`useDocumentWorkspace.ts` 里的整条流程（阅读 ↔ 编辑切换、保存、`UNENCODABLE` 询问、另存后变为 Markdown、草稿恢复类型）没有组件级测试，这个 hook 一直没有测试台。这些只经过类型检查和代码走读。

## 未验证

中文输入法输入、保存后磁盘内容、外部修改冲突提示、草稿恢复、另存为 `md` 后进入可视化编辑。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。
