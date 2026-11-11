# T52 PDF 打印背景验证

日期：2026-11-11。环境：macOS 27（Darwin 27.0.0），Apple Silicon。层级：automatedVerified，应用内实际打印 PENDING。

## 方法

`scripts/print-pdf-probe.swift` 用离屏 WKWebView 加载同一长页面（书页底色 `#f7f1e3`、两页以上正文、随包思源宋体），通过 `NSPrintOperation` 以保存方式输出 PDF，不弹打印或进度面板。每种做法输出一个 PDF，再用 PDFKit 光栅化前两页，读取角落颜色、第 2 页正文起始位置和嵌入字体名。原始输出见 `doc/evidence/reading/T52-print-pdf-probe.txt`。

| 变体 | 做法 | 结果 |
| --- | --- | --- |
| A | 默认 | 无背景，白纸 |
| B | `WKPreferences.shouldPrintBackgrounds = true` | 打印区域内有纸色，页边距区域白色 |
| C | CSS `print-color-adjust: exact` | 与 B 相同；不需要 Rust 侧设置 |
| D/E | `@page { margin: 0 }` + 内边距 | 纸色满版，但第 2 页起正文距页边约 3 mm，内边距只在首尾页出现 |
| F | `@page { background }` | 无效，页边距仍为白色 |
| G/I | thead/tfoot 占位行（整表或逐行） | 不在每页重复，跨页边距不成立 |
| H | `box-decoration-break: clone` | 不重复内边距 |

字体以子集嵌入（如 `AAAAAE+NotoSerifSC…`），文字可选中。

## 结论

1. 打印背景可用 CSS `print-color-adjust: exact` 开启，不需要新增 Rust 命令或修改 WKPreferences。章程 §11 计划的“只作用于打印 webview 的 Rust 命令”取消。
2. 满版纸色与每页一致的页边距在 WebKit 中不能同时实现。若要满版，第 2 页起正文会贴边。
3. 因此 PDF 默认采用“打印友好”（白底，保留字体、排版、表格和图片样式）。“与屏幕一致”只在打印区域内铺纸色和纹理，页边距为白色。章程 §9、§13 已改为 v0.3。
4. macOS 12–13.2 上 `print-color-adjust` 的效果未验证；打印友好模式不依赖背景打印，可作为降级。

## 样张

- `doc/evidence/reading/T52-C-color-adjust.pdf`：CSS 开启背景，页边距白色。
- `doc/evidence/reading/T52-D-margin0.pdf`：满版纸色，第 2 页正文贴边。

## PENDING

在应用中用“打印 / 存储为 PDF…”经系统对话框实际输出，两种模式各一份；旧系统降级未验证。
