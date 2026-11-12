# T98 启动与入口包

状态：automatedVerified（计划层级 nativeVerified，实机 PENDING）。2026-11-12。

体积取自每一步之后的 `npm run build`，由新加的构建插件 `entry-budget` 报告（入口包压缩后代码的 UTF-8 字节数）。

## 入口包的变化

| 步骤 | 入口包（字节） | 本步变化 | 门槛 | 结论 |
| --- | ---: | ---: | --- | --- |
| T91 基线 | 3,122,055 | | | |
| T92–T97 之后 | 3,123,280 | +1,225 | | |
| P7-1、P7-2 CodeMirror 与 ProseMirror 移出 | 2,611,899 | −511,381 | 入口包不含这两类模块 | 达标，保留 |
| P7-3 字体表 | 2,060,340 | −551,559 | 减少 400 kB 以上 | 达标，保留（做法比方案更进一步，见下） |
| P7-4 纸张纹理 | 628,344 | −1,431,996 | 减少 1,400 kB 以上 | 达标，保留 |
| P7-5、P7-6 之后 | 627,521 | −823 | | |

入口包合计由 3,122,055 字节降到 627,521 字节（−79.9%）。分析 worker 主包由 782,010 字节降到 519,427 字节（P7-5，−262,583，门槛 250 kB）。

## 逐项说明

**P7-1** `css.ts` 只需要语法角色的名字，却经 `syntaxRoles.ts` 引入了 `@codemirror/language`。角色名、`SyntaxRole`、`tokenClass` 移到没有依赖的 `syntaxRoleNames.ts`。

**P7-2** 由 T94 拆出的 `findText.ts` 完成，主 hook 不再引用带 ProseMirror 的 `find.ts`。

**P7-3** 第一版只把 Fontsource 的 CSS 原文换成生成的字体表，入口包减少 354 kB，**没有达到 400 kB 的门槛**：`unicode-range` 数据本身占了约 76 kB，省不掉。按方案不调整门槛，于是改了做法：

- `scripts/generate-font-table.mjs` 生成两个文件：`bundledFonts.css`（434 条 `@font-face` 规则，由构建工具解析其中的字体路径，浏览器直接解析）和 `fontTable.ts`（同一批字形的数据）。
- `fontFaces.ts`（新）持有字形清单、`fontFaceCss`、`facesForText`，只被导出代码引用，随导出的代码块按需加载。
- `fonts.ts` 只剩字体选项和字体栈；`install.ts` 不再用 JavaScript 往页面写约 380 KB 的 `@font-face` 文本。
- 每个字形的 `ranges`（共约 3.6 万个数对）改为首次读取时才展开。

改造前后用同一段代码导出字形清单和 `fontFaceCss` 的结果，两份 JSON 逐字节相同（434 个字形）。代价：这些规则现在在 CSS 包里，CSS 由 114,720 字节增到 534,385 字节。启动时要加载的总字节数没有少多少，少掉的是 JavaScript 的解析、正则拆解和字符串拼接；这部分的实际启动耗时需要实机测量。

**P7-4** 12 张纹理原来以 base64 内联在入口包里，启动时又被写进四种纸张风格的样式块。现在应用内用 `?url` 引用构建输出的文件；导出时 `buildExportStyle` 只读取所用风格的那几层并内联为 data URI，读不到时页面保留纸色、不带纹理，仍然不引用任何外部文件。这其实是[阅读体验章程](../08-阅读体验章程.md) §“实现记录”里原本写的设计，T63 的实现偏离了它。

为了让导出能读到纹理，`read_app_asset` 的允许范围从“`/assets/` 下的 `.woff2`”扩大到“另加四种纸张的纹理 PNG”（文件名须以 `paper-`、`xuan-`、`parchment-`、`kraft-` 开头，且是不含路径的普通文件名）。这些是应用自己的静态文件，页面本来就在显示它们；CSP 与 capabilities 没有改动。这一处是对自定义命令范围的扩大，特此记录，由用户判断是否接受；不接受的话可以改为把纹理另外内联进只在导出时加载的代码块（应用体积增加约 1 MiB）。

**P7-5** `renderMath.ts` 不再静态引入 KaTeX。`loadMathRenderer(markdown)` 在文本含 `$` 或 `math` 时才加载它，预览、导出、主线程回退路径都先取得渲染器再渲染；没有渲染器时公式保持为源码。

**P7-6** `analysisClient.ts` 里三处动态 `import()` 的模块本来就在入口包里，改为静态引用，构建不再有“dynamic import will not move module”警告。

**P7-7** `vite.config.ts` 新增 `entryBudget` 插件：入口包含有 `@codemirror`、`@lezer`、`@milkdown`、`prosemirror-*`、`katex`、`mermaid`、`pdfjs-dist` 的代码模块，或超过预算时构建失败。预算暂定 700,000 字节，T104 按实测值定稿。**验证**：在 `main.tsx` 里临时引入 `@codemirror/state`，构建以 “the entry chunk must not contain …” 失败；去掉后通过。

## 测试

- `tests/reading-fonts.test.ts` 新增 4 项：两个生成文件与生成器的输出一致；字形清单里的字体族与应用登记的 12 个字体族相同；样式表里的规则与旧的 `fontFaceCss(bundledFaces)` 逐条相同、每个文件存在；`ranges` 是按需计算的。
- `tests/export-style.test.ts` 新增 1 项：导出读取所用风格的三层纹理并内联，样式里没有 `/src/assets/`，没有任何外部引用；白色风格和“素白导出”不读取纹理；纹理读不到时退回纯色且字体照常内嵌。
- `tests/paper-textures.test.ts`、`tests/reading-styles.test.ts`：按新约定更新（应用内是文件地址，导出时是 data URI）。
- `tests/app-assets.test.ts` 新增 1 项：开发服务器下读取纹理文件本身，其他 PNG 和带 `..` 的路径被拒绝。
- `tests/math.test.ts`：公式经 `loadMathRenderer` 渲染；无公式的文本不加载 KaTeX；未加载时公式保持源码。
- Rust `app_assets` 测试：四种纸张的纹理文件名可读；其他 PNG、带目录的、带 `..` 的、其他扩展名的都不可读。
- 删除了 `tests/helpers/bundled-font-css.ts`（为旧的 `?raw` CSS 导入打的桩）及 `vite.config.ts` 里为它保留的两条 `test.css.include`。

本任务中发现应用级测试在全量并行、机器负载高时会因固定等待时间不够而失败。`tests/helpers/appHarness.tsx` 改为等待条件成立（`until`），并给这些测试 60 秒的时限；全量测试连续两次通过。

## 改动的文件

`vite.config.ts`、`scripts/generate-font-table.mjs`（新）、`src/main.tsx`、`src/core/markdown/syntaxRoleNames.ts`（新）、`syntaxRoles.ts`、`renderMath.ts`、`analysis.worker.ts`、`analysisClient.ts`、`src/features/reading/fonts.ts`、`fontFaces.ts`（新）、`fontTable.ts`（生成）、`bundledFonts.css`（生成）、`textures.ts`、`css.ts`、`install.ts`、`src/features/export/exportStyle.ts`、`appAssets.ts`、`renderHtml.ts`、`src/features/preview/renderMarkdownPreview.ts`、`src-tauri/src/app_assets.rs`、`doc/08-阅读体验章程.md` 及上述测试。

## 检查

`npm run typecheck` PASS；`npm run test` 540 项 PASS、1 项跳过；`cargo test --lib` 130 项 PASS、4 项忽略；`cargo check --locked --offline` PASS；`npm run build` PASS，字体预算 42.8 MiB / 48 MiB，`dist` 共 60,096 KiB，441 个 woff2、12 个纹理 PNG 作为独立文件输出。`node scripts/generate-font-table.mjs --check` PASS。

## 实机 PENDING

- 冷启动到窗口出现的时间与改前构建对比（各 5 次）；
- 12 种风格下字体显示正常，四种纸张风格的纹理显示正常（打包后经 `'self'` 加载文件）；
- 导出 HTML 断网打开，纹理与字体完整；打印页纹理正常（需要 `read_app_asset` 在打包后的应用里读到 PNG）；
- 含公式的文档首次预览时公式正常渲染（KaTeX 在 worker 里按需加载）。
