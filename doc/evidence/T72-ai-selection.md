# T72 选中文本操作

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `EditorAdapter` 新增 `selectionContext()`（选中的文字及其前后文）和 `insertMarkdown()`（在光标处或选区后插入，作为一次可撤销的编辑）。
- 抽屉底部的“选中文字”一组：解释、翻译、改写、续写。没有选区时点击会提示“请先在文档中选中一段文字”，不发送请求；选区超过上下文预算时提示缩小选区。
- 结果先显示在抽屉里，用户点“插入文档”或“替换选区”才写入；AI 不会自行修改文档。阅读模式下这两个按钮不可用，`insertMarkdown` 也会拒绝（`READING_MODE`）。
- 输入法组字期间 `insertMarkdown` 拒绝执行；提问输入框在组字时按回车不发送。

## 自动化验证

- `tests/ai-prompts.test.ts`：四种选区操作的消息内容、选区过长时的截断、`insertableMarkdown` 的整理。
- `tests/ai-assistant.test.ts`：对选中文字执行操作并把回答标记为可插入；插入的是整理后的 Markdown 并报告结果。

阅读模式下按钮禁用、组字期间拒绝插入这两点没有自动化测试。

`insertMarkdown` 在真实 Crepe 编辑器里的行为（撤销一步恢复、插入位置）没有自动化测试。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：选中一段文字后四种操作各做一次；插入后 ⌘Z 一步撤销；插入内容含列表、代码块时结构正确。
- 实机 PENDING：中文输入法组字过程中点击这些按钮不打断输入。
- 用户验收 PENDING。
