# T106 导出 PDF 与打印分开

日期：2026-11-13。环境：macOS 27（Darwin 27.0.0），Apple Silicon。层级：automatedVerified，实机 PENDING。

## 问题

原“打印 / PDF”在隐藏 iframe 里调用 `window.print()`。Tauri 的 WKWebView 不实现它，点击后没有任何反应。

## 做法

- 导出 PDF 与打印（`⌘P`）分为两个操作，都使用 HTML 导出的同一页面，交给 `src-tauri/src/pdf_export.rs`：离屏 `WKWebView`（关闭页面 JavaScript、关闭 `drawsBackground`），等待字体与图片后用 `NSPrintOperation` 打印。
- 导出 PDF：页面以 `pdfFile` 样式打印（`html`、`body` 透明，`print-color-adjust: exact`），不弹面板写入临时文件；再用 PDFKit 的 `PDFPage` 子类在每页内容下整页填充底色后另存，经 `atomic_write` 写到存储面板选择的位置。
- 打印：系统打印面板以表单弹在文档窗口上。

## 预先探针（Swift，scratchpad）

| 检查 | 结果 |
| --- | --- |
| WebKit 打印出的 PDF 中未绘制区域 | `drawsBackground` 打开时正文区域被涂白；关闭后整页透明（垫红色底光栅化，页边距与正文区域均为红色） |
| CoreGraphics 逐页重画并垫底色 | 底色满版、浅色文字保留，但链接注释丢失（原文件有 `/URI` 与 `/Dest`，重画后无） |
| PDFKit `PDFPage` 子类垫底色后 `write` | 底色满版，`/URI` 与 `/Dest` 链接保留 |

## 自动化

- `pdf_export.rs` 4 项 Rust 测试：纸型与颜色校验；建议文件名；超大页面被拒；生成两页带链接的 PDF，铺 `#f6efe0` 后光栅化检查四角与上边距像素为底色、深色方块仍在、链接仍在、页数不变。
- `tests/export-style.test.ts`：`pdf` 模式透明背景、颜色不变、无纹理、返回底色；简洁白底为 `#ffffff`。
- 合计：`npm run typecheck` PASS；`npm run test` 553 项 PASS、1 项跳过；`cargo test --lib` 148 项 PASS。

## 应用进程内自测

临时在 `lib.rs` 加入环境变量触发的自测钩子（已删除，未提交），用 `tests/export-samples.test.ts` 生成的 `paper`、`xuan`、`graphite`、`dusk` 的 `-pdf-` 页面在调试版应用中走 `export_pdf` 的同一路径：

- 4 份共约 3 秒完成；每份 2 页。
- 渲染第 1、2 页：底色铺满整页，第 2 页页边距与第 1 页一致；暖灰（夜间）浅色文字、代码块、表格、图片正确。
- 首次运行发现不弹面板时 AppKit 在其他线程回调完成，结果通道已改为全局表。
- 打印面板：以 `AXSheet` 出现在“Mino”窗口上，按钮为 Cancel / PDF / Print；按 Esc 取消后命令返回 `false`。

## PENDING

从界面（文件菜单、工具栏、右键菜单）实际导出与打印；打到打印机；英文界面文字；含公式、Mermaid 的大文档；macOS 13.3 以下。纸张纹理不导出，只有底色。

## 修复（2026-11-13）：选“下载”文件夹后导出卡住

用户实测：保存窗口里选“下载”文件夹后，目录里没有出现 PDF，之后再点“导出 PDF”没有任何反应。对卡住的进程做 `sample` 发现，PDF 已经生成好（临时目录里的 `painted.pdf` 有 6.8 MB），线程停在 `atomic_write::commit` → `open_directory` → `open()`。原子写入要先打开目标文件夹本身，“下载”受 macOS 隐私保护，保存窗口只授权了选中的那一个文件，所以 `open()` 一直在等隐私检查；导出命令因此不返回，前端一直处于忙碌状态，后面的点击都被拦下。

修复：导出 PDF 和导出 HTML 改用 `fs::write_chosen_file`，只原地写入用户选中的那个文件（`O_NOFOLLOW`，不建临时文件，也不留备份），并且在独立线程里写，30 秒没完成就返回 `WRITE_BLOCKED`，提示用户检查授权或换一个文件夹，界面不会再卡死。新增 Rust 测试覆盖新建、覆盖、拒绝符号链接和拒绝目录。“隐私检查导致阻塞”这一点是根据调用栈推断的，因为本机终端本身有访问“下载”的权限，复现不了；需要实机在“下载”“桌面”“文稿”里各导出一次确认。保存文档、另存为仍走原子写入，在受保护的文件夹里是否有同样的问题，还没验证。
