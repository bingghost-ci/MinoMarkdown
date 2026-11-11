# T68 西文字体与中西搭配

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 新增五款西文字体，全部为 OFL 1.1 的可变字体：Source Serif 4、Literata、EB Garamond、Inter、JetBrains Mono（`@fontsource-variable/*`），合计 1.01 MiB。代码字体统一为 `CODE_FONT_STACK`（JetBrains Mono 在前）。
- 中文字体和西文字体分开选择（设置字段 `cjkFont`、`latinFont`）；字体栈里西文在前、中文在后，所以混排时拉丁字母用西文字体，汉字用中文字体。旧字段 `fontPreset`、`editorFont` 在 `settings.rs` 的 `migrate()` 中迁移。
- `src/features/reading/script.ts` 的 `dominantScript` 判断文档以中文还是西文为主。西文为主的文档自动使用西文版式（设置项 `latinLayout`：`auto` 或 `off`）：两端对齐并自动断词（`--doc-hyphens`）、无首行缩进、行距略小（舒适档 1.58）、行宽档位改为 28、32、36；导出时 `<html lang>` 也随之设置。

## 自动化验证

- `tests/reading-script.test.ts`（8 项）：中文、英文、混排、代码块和链接不计入、空文档等情况下的判断。
- `tests/reading-fonts.test.ts`：中西字体栈的顺序、斜体分片的选择。
- `tests/export-style.test.ts`（10 项）：导出样式中的字体与 `lang`。

## 样张

- `doc/evidence/reading/T65-western-layout.jpg`：英文样例在白、书页、深色下的西文版式。
- `doc/evidence/reading/T68-font-panel.jpg`：字体面板。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：真实英文长文的断词、对齐和行宽观感；中英混排段落的基线和字重是否协调。
- 实机 PENDING：导出 HTML 与 PDF 中西文字体正确内嵌。
- 用户验收 PENDING。
