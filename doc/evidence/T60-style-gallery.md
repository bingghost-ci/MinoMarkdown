# T60 风格画廊与整体验收

日期：2026-11-11。层级：automatedVerified，集中实机验收与用户验收 PENDING。

## 实现

- 新的设置对话框 `src/app/components/SettingsDialog.tsx`，分四页：
  - 外观：语言；“跟随系统外观”及白天、夜间风格；风格画廊按纸张、护眼、夜间、其他分组，每张卡片是按风格数据画出的小页面（真实纸色、纹理、墨色、链接色和推荐字体）。
  - 排版：字体预设、字号、行距、段距、行宽、对齐、首行缩进，带实时样例。
  - 阅读与导出：打开时进入阅读模式、图注、夜间降亮、导出风格、PDF 模式、纸型、页边距。
  - 工作区：自动保存与原有工作区选项。
- 旧的设置对话框从 `Dialogs.tsx` 删除。状态栏风格菜单按分组显示。
- 中英文文案在 `src/app/i18n.ts`，菜单在 `native_menu.rs`。

## 整体检查（2026-11-11）

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test` | 306 项 PASS，1 项样张生成默认跳过（33 个文件） |
| `npm run build` | PASS |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | 70 项 PASS，1 项忽略 |
| `npm run tauri -- build --bundles app` | PASS，`Mino.app` 36.41 MiB（原 15.67 MiB），arm64 |

## 四个出口并排

- 编辑器：`doc/evidence/reading/M3-preview.jpg`
- 阅读模式：`doc/evidence/reading/M3-reading-mode.jpg`
- PDF：`doc/evidence/reading/M4-*-print-*.jpg/.pdf`
- HTML：用 `tests/export-samples.test.ts` 生成，书页与夜读的 HTML 约 2 MiB，未放入仓库；宣纸的回退样例为 `M4-xuan-fallback.html`。

源码保护预览与 HTML 共用 `.mino-doc` 样式；预览样张未单独截图。

## 收尾（2026-11-11）

收尾第 1–6 项完成后重新生成 M3、M4 样张，并新增 `M3-grid-table.jpg` 与 `M4-paper-grid-print-print.pdf/.jpg`；检查与打包结果见下方“收尾检查”。

### 收尾检查

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test` | 319 项 PASS，1 项样张生成默认跳过（37 个文件） |
| `npm run build` | PASS |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | 72 项 PASS，1 项忽略 |
| `npm run tauri -- build --bundles app` | PASS，`Mino.app` 36.82 MiB（37,712 KiB，比 36.41 MiB 增加 420 KiB），arm64 |

## PENDING

四个出口实机并排一致；设置页分组与缩略图；全部 T51–T59 的原生项；用户验收。
