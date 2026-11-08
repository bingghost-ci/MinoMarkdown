# T23 独立 Markdown 文件拖入原生复核

日期：2026-11-07。平台：开发机 macOS / arm64，当前未签名 `.app`。此证据只覆盖 Finder 向应用主窗口拖入单个 `.md` 文件。

## 原因

原实现把主窗口拖放监听在 `tauri::Builder::on_webview_event`。当前锁定的 `tauri-runtime-wry 2.12.2` 对主窗口内容使用 `WebviewKind::WindowContent`，把 WRY 拖放包装成 `SynthesizedWindowEvent::DragDrop`，随后转成 `WindowEvent::DragDrop`；只有子 WebView 才包装成 `WebviewEvent::DragDrop`。因此原回调不运行，`OpenIntent` 队列没有收到文件，界面也没有反馈。

修复：改为 `on_window_event` 监听主窗口的 `WindowEvent::DragDrop`，仍沿用原有的一次性意图队列、路径验证、未保存保护与 `open_intent_document`。空路径事件显示状态提示。调查时曾试用 WRY 上游粘贴板路径补丁；找到真正的事件层级错误后已撤回该试用补丁，锁定依赖未变。

## 原生操作与结果

1. 在 `/tmp/mino-drag-repro/独立文档.md` 写入标题“拖入验证”和一段正文。
2. 使用 `open -n` 启动独立测试应用进程，通过 macOS 辅助功能获取 Finder 文件图标与应用窗口的位置，向应用窗口发送连续鼠标拖动事件。
3. 修复前：独立窗口仍显示“打开 Markdown 文档”，状态为“准备就绪”，无文档标签。
4. 修复后：独立窗口辅助功能树出现文档标签“独立文档.md”、正文标题“拖入验证”、正文“这是一篇独立文档。”，状态为“已打开 独立文档.md”。

`./start.sh --build-only` 完成 arm64 `.app`、ZIP 和 manifest 核验；修复后测试进程已退出，用户原有应用进程未被结束。此操作证明当前包的单文件拖入和正文呈现；文件夹拖入、其他拖放来源、多文件顺序、保存往返及用户场景仍需分别验证。

当前主程序/ZIP/manifest SHA-256：`4ecd75516f216856f66b663d38e2b42d827fd064f5b2e04f81cab241df3dfda9`、`e0131cb1dfc7be6fdcdc2d5eaf0198c450d5ba3a8adf68a3e93d2831d1c069a6`、`cda99f0c7bf3ab17d7d3711acdab282f3a7ad60cab8739978849a1acd3bee410`。
