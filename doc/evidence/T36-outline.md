# T36 文档大纲

任务：T36 / G36 · 日期：2026-11-10 · 输入版本：`4fd5f59` 之上的未提交工作区 · 运行环境：macOS arm64，Vitest，未启动原生应用。

## 变更

- `src/features/outline/outline.ts`：`outlineFromDoc` 从 ProseMirror 文档取标题；`outlineFromSource` 用逐行扫描取标题，避免在大文档上解析全文。
- `src/app/components/OutlinePanel.tsx`、`App.tsx`、`EditorToolbar.tsx`、`styles.css`：右侧面板和工具栏开关。
- `src/features/editor/EditorAdapter.ts`：`outline()`、`revealHeading()`。跳转只改选区，不产生文档步骤，也不触发 `listener.updated`。
- `src/app/useDocumentWorkspace.ts`：编辑后 300 ms 防抖刷新，IME 组合期间顺延，面板关闭时不计算；预览模式从预览 DOM 取标题。
- `src-tauri/src/settings.rs`：`showOutline` 持久化，旧设置缺省为关闭。
- `src-tauri/src/lib.rs`、`native_menu.rs`、`src/app/i18n.ts`：“显示或隐藏大纲”中英文菜单。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：16 个文件、106 项 PASS，新增 4 项覆盖 ATX/setext、代码块、front matter、BOM/CRLF、嵌套标题和位置。
- `npm run build`：PASS。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：62 项 PASS。

## 限制

- 源码视图的跳转按行估算滚动位置，软换行很多时可能有偏差。
- 原生实测 PENDING：长文档跳转、中文输入时更新、重启后开关状态。用户验收 PENDING。
