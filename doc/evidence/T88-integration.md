# T88 功能接入

日期：2026-11-12。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- AI：`useAiAssistant` 新增可选的 `prepareDocument`，在提问、预设、生成推荐问题之前调用。PDF 在这里提取文字（最多 200 万字符，每页前有“[第 N 页 / Page N]”标记），按文档缓存；提取结果平均每页不足 12 个非空白字符时判为无文字层，抛出 `PDF_NO_TEXT`，不发任何请求，状态栏说明原因。TXT 与代码文件直接取源文本。截断与分段仍由 `prompts.ts` 处理，请求仍只经 `ai.rs`。“插入文档”对 PDF 不可用（PDF 始终是阅读状态）。
- 菜单：命令 `set_menu_state(kind)` 在主线程启用或置灰菜单项，前端在文档类型变化和窗口获得焦点时调用。PDF 置灰保存、另存、三种导出、打印、切换源码、阅读模式和整个格式菜单；TXT 与代码置灰“导出 Markdown 与图片”“导出仅正文 Markdown”“切换源码”和格式菜单。前端的 `runFileAction`、`saveDocument`、`exportPage` 等各自再拒绝一次。
- 导出：TXT 与代码文件的 HTML 导出和打印用各自的渲染结果作正文（`ExportPageOptions.bodyHtml`），样式里包含文本、代码、表格的规则。
- 文案：`i18n.ts` 新增界面文字 30 余条、状态文字 17 条；`native_menu.rs` 没有新增菜单项。

## 自动化验证

- Vitest `tests/ai-assistant.test.ts` 新增 3 项：提问、预设、推荐问题都先准备再读文档，发出的消息里是准备好的文字；`PDF_NO_TEXT` 时三种入口都不发请求、没有对话记录、状态里有“没有文字层”“不做文字识别”；文档未就绪时不发请求。
- Rust `native_menu::tests::menu_items_follow_the_kind_of_document`：三种类型下各菜单项的启用状态；现有的菜单文案与快捷键测试通过。

## 没有自动化测试的部分

前端对各动作的拒绝、`set_menu_state` 的调用时机、TXT 导出 HTML 的整条流程，只经过类型检查。

## 未验证

用真实密钥对 TXT 和 PDF 提问；扫描件的提示；菜单在各类型下的实际状态（多窗口时菜单跟随获得焦点的窗口）；英文界面。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。

## 2026-11-12 用户首次实机反馈后的修改

用户报告 AI 的“选中文字”操作对 PDF 无效。原因是取选区的函数只认编辑器。现在 PDF 视图记住页面上最近一次选中的文字（点进 AI 栏不会丢，点回页面空白处才清除），作为选区交给助手；前后文为空。没有自动化测试，实机 PENDING。“改写”“续写”的结果不能写回 PDF。

