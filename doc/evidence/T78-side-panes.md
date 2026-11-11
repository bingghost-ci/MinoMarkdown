# T78 侧栏拖动与隐藏

日期：2026-11-11。层级：codeComplete，automatedVerified（设置校验有测试，界面交互只有离屏脚本验证）；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src/app/components/PaneResizer.tsx`：侧栏内侧边缘的拖动条。拖动时直接改侧栏宽度，松开后写入设置；双击恢复默认；方向键每次 16 px。用于文件栏（右边缘）、文档大纲和 AI 栏（左边缘）。
- 设置新增 `outlineWidth`（180–520，默认 240）、`aiWidth`（300–640，默认 400）；`sidebarWidth` 范围放宽为 170–520。`settings.rs` 校验相同范围，旧设置文件没有新字段时取默认值。
- 文件栏标题的“打开文件夹”图标改为“隐藏文件栏”；隐藏后标签栏左端出现“显示文件栏”按钮。
- 未打开文件夹时不再显示文件夹图标和“尚未打开文件夹”的说明，只留一个“打开文件夹”按钮（菜单和拖入文件夹仍可用）。
- 大纲：顶层标题加粗，第三层及更深的标题用次要颜色和略小字号，缩进每层 14 px；标题过长时省略，可拉宽大纲查看。
- AI 栏空白时写明：文档只在提问时随问题一起发送，打开面板不发送任何内容。发送时机本身没有改动：复核代码确认打开面板、显示本地生成的推荐问题都不发请求。

## 自动化验证

- Rust `pane_widths_default_and_are_range_checked`：旧文件取默认宽度、上限值可读、越界值不被接受。
- 离屏 WKWebView 脚本（合成指针事件，不是自动化测试套件的一部分）：文件栏 230 → 拖动 +90 → 320 并保存；大纲 240 → 拖动 → 360 并保存；点击隐藏后文件栏消失，点击标签栏按钮后恢复。

没有针对 `PaneResizer` 的组件测试；真实鼠标拖动没有验证。

## 样张

- `doc/evidence/reading/T78-side-panes.jpg`：文件栏 300、大纲 320 宽。
- `doc/evidence/reading/T78-sidebar-hidden-ai.jpg`：文件栏隐藏、标签栏左端的显示按钮、AI 栏的说明文字。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：41 个文件、448 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：101 项 PASS，2 项忽略。
- `npm run build`、`npm run tauri -- build --bundles app`：PASS，`Mino.app` 61.02 MiB。

## PENDING

- 实机 PENDING：用鼠标拖动三个侧栏的边缘，跟手、不误选文字、不卡顿；窄窗口下不能把编辑区挤没。
- 实机 PENDING：退出重开后三个宽度保留；多窗口之间同步。
- 实机 PENDING：隐藏文件栏后从标签栏按钮和菜单恢复；阅读模式下的表现。
- 用户验收 PENDING。
