# T39 定时自动保存

任务：T39 / G39 · 日期：2026-11-10 · 输入版本：`4fd5f59` 之上的未提交工作区 · 运行环境：macOS arm64，Vitest，未启动原生应用。

## 变更

- `src/features/document/autosave.ts`：纯函数 `autosaveDecision`，判断保存、等待或跳过。
- `src/app/useDocumentWorkspace.ts`：复用 `createDraftScheduler`，首次修改后最多等待一个间隔，连续输入不会无限推迟。复用 `saveDocument`，因此仍走 `expected_revision`、`generation` 票据和原子写入。后台保存不更新最近文件，也不重建原生菜单。保存失败或冲突后，该文档的自动保存暂停，手动保存成功后恢复。
- `src-tauri/src/settings.rs`：`autoSave` 默认关闭，`autoSaveSeconds` 默认 30，只接受 15、30、60、120、300。
- `src/app/components/Dialogs.tsx`、`src/app/i18n.ts`：设置页“编辑器”中的选项和文案。

## 检查

- `npm run typecheck`：首次因 i18n 键重复失败，改名后 PASS。
- `npm run test`：19 个文件、156 项 PASS，新增 `tests/autosave.test.ts`，覆盖未命名、IME、busy、未就绪、保存中、冲突、已暂停、保存中的新编辑和多窗口设置同步。
- `npm run build`：PASS。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：62 项 PASS，旧设置缺省值和非法间隔已加断言。

## 限制

- 只保存当前活动标签。后台标签的修改仍有草稿保护，切回后继续自动保存。
- 大文档每次自动保存都要序列化全文，间隔太短可能感到停顿，运行数据待集中测试。
- 原生实测 PENDING：连续中文输入不中断、外部修改后不覆盖、多窗口设置同步。用户验收 PENDING。
