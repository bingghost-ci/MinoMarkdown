# T64 界面外观与悬浮按钮

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src/app/components/FloatingControls.tsx`：页面右侧一列圆形悬浮按钮，依次为大纲、字体与风格、AI（仅在 AI 已开启时出现）、日夜切换、阅读模式。
- `src/styles.css`：侧栏、标签栏、工具栏、状态栏改为中性灰；页面卡片、悬浮按钮、弹出面板、抽屉的样式。
- `EditorToolbar.tsx` 在阅读模式下不显示；`StatusBar.tsx` 精简。
- `readingSettings.ts` 的 `toggledDayNight`：当前是白天风格时切到所选的夜间风格，反之切到所选的白天风格；切换后不再跟随系统外观。

## 自动化验证

`tests/reading-styles.test.ts` 与设置相关测试覆盖 `toggledDayNight`、`pickedStyle` 的结果。按钮的点击、焦点和键盘操作没有自动化测试，只在离屏页面中点击后截图确认。

## 样张

`doc/evidence/reading/T74-all-styles.jpg`（每格右侧可见悬浮按钮；原 `T61-all-styles.jpg` 已由它取代）、`T71-ai-drawer.jpg`（AI 开启后多出 AI 按钮）。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：悬浮按钮在窄窗口、侧栏展开或收起、全屏时的位置；不遮挡正文和滚动条。
- 实机 PENDING：键盘 Tab 顺序、旁白读出的名称。
- 用户验收 PENDING。
