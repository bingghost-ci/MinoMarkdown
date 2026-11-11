# T59 导出套用风格

日期：2026-11-11。层级：automatedVerified，原生实测与用户验收 PENDING。

## 实现

- `src/features/export/exportStyle.ts` 的 `buildExportStyle` 用当前风格（或“简洁白底”）和排版生成导出样式。只内嵌文档实际用到字符所在的字体分片，由主线程通过新命令 `read_app_asset` 读取。该命令只允许读取应用包内的 `/assets/*.woff2`，不涉及用户文件，返回二进制。
- **HTML：** 字体预算 6 MiB，超出或读取失败时去掉随包字体、改用系统字体回退。纹理以 data URI 内嵌。页面结构为 `<main class="mino-page"><article class="mino-doc">`。只有内嵌了字体时，CSP 的 `font-src` 才从 `'none'` 改为 `data:`，其余 CSP 与净化规则不变。
- **PDF / 打印：** 字体预算 24 MiB（打印页不保存）。`pdfMode` 有两档：`print` 打印友好（默认，白底；夜间风格改用深色墨水，图表改用浅色）；`screen` 与屏幕一致，以 `print-color-adjust: exact` 在打印区域内铺纸色和纹理，页边距为白色（见 T52）。纸型 A4/Letter，页边距 12/18/25 mm。
- 设置“阅读与导出”页提供导出风格、PDF 模式、纸型、页边距。

## 字体实测

用 `tests/export-samples.test.ts`（设置 `MINO_EXPORT_SAMPLES` 后运行，平时跳过）生成样例导出：

| 风格 | HTML | 打印页 |
| --- | --- | --- |
| 书页（思源宋体） | 内嵌 1.34 MiB，页面 2.0 MiB | 同左 |
| 宣纸（霞鹜文楷） | 超出 6 MiB，回退系统楷体，页面 183 KiB | 内嵌 14.0 MiB |
| 夜读（思源宋体） | 内嵌 1.34 MiB | 同左 |

霞鹜文楷没有分片，任何文档的 HTML 导出都会回退系统楷体，这是已知降级。

## PDF

`scripts/html-to-pdf.swift` 用与应用相同的 WKWebView 打印路径把样例页面输出为 PDF，并截取前两页：

- `doc/evidence/reading/M4-paper-print-print.pdf/.jpg`、`M4-paper-print-screen.pdf/.jpg`
- `doc/evidence/reading/M4-xuan-print-print.pdf/.jpg`
- `doc/evidence/reading/M4-graphite-print-print.pdf/.jpg`、`M4-graphite-print-screen.pdf/.jpg`
- `doc/evidence/reading/M4-xuan-fallback.html`：回退系统字体的 HTML 样例。

结果：打印友好模式下夜读为白底黑字；“与屏幕一致”下纸色只在打印区域内；任务列表、三线表、图注、花饰分隔线与屏幕一致。

## 自动化结果

`tests/export-style.test.ts` 6 项 PASS：只读取覆盖文档字符的分片；超出预算或读取失败时回退；黑体预设不读字体；夜间风格打印改白底、图表改浅色，`screen` 模式与纸型、页边距；页面内联样式且无外部引用，CSP 只在内嵌字体时允许 `data:`；图注。`app_assets.rs` 测试只允许读取 `/assets/*.woff2`，PASS。

## 收尾：开发模式导出字体（2026-11-11）

原先 `npm run tauri -- dev` 中字体 URL 指向 `/node_modules/…`，而 `read_app_asset` 只读 `dist/assets`，开发模式下导出会回退系统字体。现由 `src/features/export/appAssets.ts` 的 `readAppAsset` 处理：开发构建中，`/node_modules/` 下的 `.woff2` 用 Vite 的 `?inline` 模块读取（默认导出为 data URI，加载它是同源脚本导入，CSP 的 `script-src 'self'` 本来就允许），其他路径和发布构建仍走 `read_app_asset`。`read_app_asset` 与 CSP 均未修改。发布构建中该分支的开关默认为假、调用方不传入，不会执行。

- 测试 `tests/app-assets.test.ts` 3 项 PASS：发布构建总是调用命令；开发路径读到的字节与磁盘字体逐字节一致；只有 `node_modules` 下的 `.woff2` 走开发路径。
- 真实 WebKit 验证：用 `scripts/style-samples.swift --print` 在 Vite 开发页面（127.0.0.1:1430）中调用 `readAppAsset`，读到 `noto-serif-sc-4-400-normal.woff2` 2,760 字节和 `lxgw-wenkai-latin-500-normal.woff2` 7,231,496 字节，均以 `wOF2` 开头，后者与磁盘文件大小一致。未在 `tauri dev` 窗口中实际导出。
- 检查：第一次 `npm run build` 与后台 Vite 进程同时被外部终止（退出码 144），未输出结果；第二次 PASS。

## 已知限制

（开发模式字体已在收尾中解决。）

## PENDING

在应用中断网打开导出的 HTML，确认字体正确；在没有宋体、楷体的机器上查看回退效果；应用内两种 PDF 模式、纸型和页边距；PDF 文字可选中；用户验收。
