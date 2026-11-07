# T13 工具栏代码阶段

2026-11-07。当前层级：codeComplete，未达到计划的 automatedVerified。

`src/features/editor/EditorAdapter.ts` 使用 Milkdown 命令完成段落、H1–H6、强调、删除线、行内代码、列表、引用、分割线、代码块、清格式和撤销/重做；`src/app/App.tsx` 展示独立工具栏，订阅选区和历史状态，按钮按下时保持编辑器选区，组合输入期间禁用命令及草稿写入。Markdown 快捷输入继续使用 Crepe/Milkdown 自带输入规则。

`npm run typecheck`、`npm run build` 通过；`npm run test -- --reporter=dot` 45/45 通过，但现有测试未覆盖真实选区、IME、工具栏点击和历史事务。这些需浏览器集成检查及集中原生验收。不能据此将 T13 标为 automatedVerified。

2026-11-07 复核图片说明弹层：打开前保存图片节点选区，确认时先恢复再执行 `updateImageCommand`，避免输入框夺走焦点后命令作用于错误位置。`npm run typecheck` 和 arm64 构建 PASS；原生选区/撤销行为仍待集中验收。

2026-11-07 复核链接弹层：打开时从编辑器当前选区捕获链接地址，与选区一起保存；确认时根据这份捕获值选择更新已有链接或创建链接，不再依赖弹层取得焦点后可能变化的工具栏缓存。`npm run typecheck`、arm64 构建 PASS。未运行真实焦点、选区和撤销集成检查，仍为 `codeComplete`。

随后补充跨文本选区的已有链接查找，与 Milkdown 的更新命令遍历范围一致；类型检查及 arm64 构建再次通过。运行时交互结论不变。

同日以 ARM 原生 Chrome + Playwright 对临时文档做浏览器交互：新建、输入、选区加粗/撤销/重做、已有链接更新及 H1 快捷规则均观察到通过。详细命令、边界及 T14 表格失败见 [T13/T14 浏览器记录](T13-T14-browser-interactions.md)。此结果尚不足以替代 WebView/IME 与完整集成验收，状态仍为 `codeComplete`。
