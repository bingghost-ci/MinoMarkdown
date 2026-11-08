# T23 Dock 新建窗口与双语界面

日期：2026-11-08。环境：开发机 macOS Apple Silicon，未签名 arm64 本地包。

## 实现与验证

- Dock 图标右键菜单新增“新建窗口”，复用“文件 > 新建窗口”的窗口创建入口。系统最近文件和窗口列表仍显示。
- 在打包后的原生应用中，辅助功能树读到 Dock 菜单“新建窗口”；点击后窗口数由 1 增至 2。
- 设置页新增“界面语言”，可选中文和 English；选择写入现有 `settings.json` 的 `language` 字段。旧设置缺少字段时默认中文，只接受 `zh-CN` 和 `en-US`。
- 原生界面切换到英文后，辅助功能树读到 `No Folder Open`、`Open a Markdown Document`、`Settings`、`Interface Language`、`Theme` 等英文项；原生“File”菜单读到 `New Document`、`New Window`、`Open File…`、`Save` 等英文项；Dock 右键读到 `New Window`。切回中文后菜单项恢复中文。
- `npm run typecheck`、前端 59/59、Rust 52/52、`./start.sh --build-only` 与打包 manifest 校验通过。测试结束后已退出应用并把语言设回中文。

## 范围

文档正文、文件名和系统提供的 Dock 菜单项不随应用语言翻译。Milkdown/Crepe 自带编辑器提示遵循其组件实现；用户仍需验收长篇编辑、系统选择器和所有边缘错误路径的英文措辞。
