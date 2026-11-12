# T102 前端冗余清理

状态：automatedVerified。2026-11-12。

每删一处前都用 `grep` 在 `src/` 与 `tests/` 里确认没有引用；每合并一处前都逐行比较过两份实现，行为不完全相同的没有合并。

## 规模

| | 清理前（T101 之后） | 清理后 |
| --- | ---: | ---: |
| `src/` 的 ts、tsx、css（不含生成的 `fontTable.ts`、`bundledFonts.css`） | 10,508 行，664,033 字节 | 10,405 行，653,422 字节 |
| 入口包 | 627,521 字节 | 622,951 字节 |
| `i18n.ts` 的 `english` 表 | 479 条 | 422 条 |
| `styles.css` | 515 行 | 483 行 |

## 已删除

- **死代码：** `src/app/appearance.ts` 整个文件；`EditorAdapter.retryFailedImages`；`groupLabels`（`styles.ts`）；`fromHsl`（`color.ts`）；`PdfTextCache.all` 的 `onProgress` 参数；`resolveDestination` 外面那层只做转发的包装（内部函数改名并直接导出）；`FontPicker` 里两个分支相同的三元式；主 hook 返回值里无人读取的 `systemDark`、`preview`、`setSettings`，以及只赋值、从不读取的 `sidebarRoot` ref。
- **只被测试使用的导出：** `renderHtml()` 包装（两个测试文件各自用 `renderExport(...).html`）；`exportStyle.ts` 对 `withoutBundledFonts` 的再导出（测试改为从 `fonts.ts` 引用）。
- **未使用的界面文案：** 57 条。判断办法：键的文字在 `src/` 的其他文件和 `src-tauri/src` 里都不出现。它们是旧风格名（素白、暖黄、墨黑…）、旧字体卡片说明、旧欢迎页、旧冲突对话框和 PDF“页面调暗”的遗留。删除后再检查，422 条全部有使用者。
- **死 CSS：** `.style-gallery`、`.style-card*`、`.font-options`、`.font-option*`、`.theme-control*`、`.reading-toolbar`、`.reading-label`、`.editor-toolbar .reading-edit*`、`.sidebar-empty-icon`、`.sidebar-empty p`、`.sidebar-empty span`（`.sidebar-empty` 现在自己就是 `<p>`）、`.tree-header > svg`（标题栏的直接子元素现在是按钮），以及它们在选择器列表和媒体查询里的残留；从未被读取的 `--editor-line-height`（CSS 与主 hook 两处）。
- **未限定的 `.recovery-item*` 三条规则：** 唯一的使用处是草稿对话框，那里另有三条更具体的规则。审查时说它们“完全被覆盖”，核对后发现并不是：`flex-wrap: wrap` 和按钮的 `height: 28px` 只在未限定的规则里。这两个声明已并入 `.drafts-dialog .recovery-item` 的规则，对话框的样式不变。

## 已合并

- `escapeHtml`：`textDocument.ts` 与 `codeDocument.ts` 里逐字相同的两份留一份。
- `base64`：`exportStyle.ts` 与 `renderHtml.ts` 里相同的两份移到 `appAssets.ts`，放在它的逆运算旁边。
- 设置更新：19 处 `setSettings((current) => ({ ...current, … }))` 改用主 hook 提供的 `updateSettings(patch)`；`AppearancePanel` 与 `SettingsDialog` 里各自的 `update` 包装直接指向它。
- 主 hook：四处“显示刚打开的文件”合为 `showOpened`；四处释放文档图片地址的循环合为 `revokeDocumentUrls`；两处“从标签栏取下一个标签”合为 `removeTab`；两处“窗口里只有一个未动过的空文档”的判断合为 `onlyUntouchedBlank`。
- 由 T98 带来的：`tests/helpers/bundled-font-css.ts` 已在 T98 删除。

## 核对后没有合并或没有删除的，及原因

- **`renderHtml.ts` 的 `escapeHtml`：** 与另外两份不同（不转义单引号）。合并会改变导出 HTML 的字节，不属于“相同的重复”。
- **围栏代码块的识别（`outline.ts`、`largeDocument.ts`、`highlight.ts`）：** 三处各有不同的规则（反引号信息串的限制、按窗口扫描、只取语言名），不是同一段逻辑。front matter 的正则和去 BOM 的几处也是各自上下文里的一行，写法和用途不同。
- **`captureCurrentTab` 与 `currentTabSnapshot`：** 前者在序列化失败时沿用上一份完整文本，后者让错误抛出，行为不同。
- **`isFontChoice`：** `src/` 里没有调用，但它是 `CLAUDE.md` 所说“字体名在 TypeScript 和 Rust 两侧都校验”的那一侧，并有十几项测试，保留。
- **`styles.css` 第 310 行的 `:root { --ui-text… }`：** 确实总被生成的样式覆盖，但它是生成样式缺席时的兜底，只有一行，保留。
- **`styles.css` 里 T61/T64 与 T79 两段“先声明后覆盖”的约 40 行：** 没有合并。把层叠合并回基础规则需要逐条核对视觉结果，这里没有截图比对的手段，改错了不会有任何测试报错。留待实机阶段有比对手段时再做。
- **`--editor-font` / `--editor-font-size` 与 `--doc-font` / `--doc-size` 的重复：** 前者仍被 Crepe 的变量当作回退值引用，未动。

## 默认字号 15 与 16

查到的事实：

- Rust 端 `default_editor_font_size()` 是 15，有两项测试断言；桌面应用的设置来自 Rust，所以新安装实际得到的是 15。
- “重置缩放”（`textZoom.ts`）回到 15，有测试断言。
- 前端的 `defaultReadingSettings.editorFontSize` 在提交 `e3e6a3a`（T61–T77）里由 15 改成了 16，但它只在浏览器预览和设置加载完成之前生效。
- [阅读体验章程](../08-阅读体验章程.md)没有规定默认字号。

无法从文档判断 16 是不是有意的新默认值。按“不改变应用里现有行为”处理：前端改为引用 `DEFAULT_EDITOR_FONT_SIZE`（15），三处由此一致。受影响的只有浏览器预览的初始字号。如果本意是 16，需要把 Rust 默认值、`textZoom.ts` 和相应测试一起改，请用户决定。

## 改动的文件

`src/app/appearance.ts`（删除）、`src/app/useDocumentWorkspace.ts`、`i18n.ts`、`readingSettings.ts`、`textZoom.ts`、`src/app/components/` 下 10 个组件、`src/styles.css`、`src/features/editor/EditorAdapter.ts`、`src/features/pdf/pdfEngine.ts`、`src/features/reading/styles.ts`、`color.ts`、`src/features/export/renderHtml.ts`、`exportStyle.ts`、`appAssets.ts`、`src/features/text/textDocument.ts`、`codeDocument.ts`、`tests/export-style.test.ts`、`tests/html-export.test.ts`、`tests/markdown-preview.test.ts`。

## 检查

`npm run typecheck` PASS；`npm run test` 540 项 PASS、1 项跳过；`npm run build` PASS。其间有一次全量测试里一项导出测试超时，当时机器的负载平均值在 86 以上（来自本机其他进程），重跑通过。

## 实机 PENDING

设置对话框各页、外观面板、字体面板、右键菜单、草稿列表（按钮高度与换行）、文件栏空状态、大纲空状态各看一遍，样式无缺失；英文界面无缺字；分离标签、关闭最后一个标签、从文件栏和最近文件打开文档的流程照常。
