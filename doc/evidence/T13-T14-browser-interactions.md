# T13/T14 浏览器编辑交互记录

日期：2026-11-07。环境：macOS arm64、Node arm64、Google Chrome universal（含 arm64）、Python Playwright 1.60.0。使用 `npm run dev -- --host 127.0.0.1 --port 1421` 和 `http://127.0.0.1:1421/`；1420 已由另一项目 Floatime 的 Vite 占用，故未占用或终止其进程。检查完成后关闭了本项目的 1421 服务。仅操作浏览器内的临时文档和项目自带 F05 样本，没有修改用户文件。

## 观察结果

| 操作 | 结果 | 范围 |
| --- | --- | --- |
| 页面加载、编辑器和独立工具栏出现 | PASS | Chrome 浏览器 |
| 新建文档输入中文文本，选区加粗、撤销、重做 | PASS | DOM 中 `strong` 数量依次 1、0、1，正文保留 |
| 选区建立链接、再次打开弹层编辑已有链接 | PASS | 输入框回显原 URL，目标由 `/a` 更新为 `/b` |
| 输入 `# ` 快捷规则 | PASS | 产生 H1 节点 |
| 插入表格、加行、加列、居中 | PASS | 可编辑表格从 3×3 变为 4×4，首格为居中 |
| F05 表格修改后切源码 | FAIL（修复前） | 将首格 `中文` 改为 `中文补充` 后，其他单元格 `A\|B 与 **粗体**` 被序列化成 `A|B 与 **粗体**`，重新解析可能多出一列 |

F05 检查共 3 次：首次因样本选择器在折叠区内超时，第二次未真正修改单元格，第三次用键盘在单元格追加文字后复现表格序列化缺陷。按用户要求，到此停止同一浏览器检查的重复尝试。上述浏览器 PASS 不证明 macOS WebView、系统中文输入法或原生文件工作流。

## 根因与修复

Milkdown 的自定义 `text` 序列化 handler 对“没有 `*`、`_`、反斜杠且以空格结尾”的文本直接返回原文。`A|B 与 ` 命中该分支，竖线未进入 Markdown 安全转义。`src/features/editor/markdownStringify.ts` 将竖线加入直通条件的排除字符，并由 `EditorAdapter` 配置该 handler。`tests/table-stringify.test.ts` 用含 `A|B 与 **粗体**` 的两列表格验证输出含 `A\|B`，再解析仍为两列。

修复后代码级结果：定向 Vitest 1/1、全量前端 58/58、类型检查和 arm64 应用构建 PASS；当前包哈希见 [T28](T28-package.md)。**修复后的 F05 浏览器编辑往返未重跑**，T13/T14 的自动化目标层级仍为 PENDING；集中验收时应优先复测此场景及中文输入、真实 WebView 焦点与撤销。

2026-11-07 后续复核：原 F05 浏览器检查已用满 3 次，依用户“同一自测最多 3 次”的约定，没有再次启动浏览器。静态调用链确认 `EditorAdapter` 在创建 Crepe 时把 `safeTextHandler` 注入 `remarkStringifyOptionsCtx`，正式 `getMarkdown()` 走该编辑器实例；`tests/table-stringify.test.ts` 只证明该 handler 的表格再解析保持两列，尚不能代替修复后的真实编辑器往返。T13/T14 保持 `codeComplete`，集中测试时再填写浏览器/WebView 结果。
