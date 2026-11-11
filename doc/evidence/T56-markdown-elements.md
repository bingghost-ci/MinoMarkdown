# T56 Markdown 元素呈现

日期：2026-11-11。层级：automatedVerified，原生实测与用户验收 PENDING。

## 实现

- `css.ts` 的 `documentElementCss` 为编辑器与 `.mino-doc` 生成同一组元素样式：标题模数约 1.25 且用正文字体加粗；列表标记用次要色；任务列表去掉圆点只留勾选框；引用为左侧细线，书页、宣纸、羊皮卷加左上角大引号；代码块为纸面加深的底色、圆角 4px；行内代码随风格着色；表格为三线表、占满行宽；分隔线为细线，宣纸和羊皮卷为居中花饰（❦），一级标题居中；链接加 1px 下划线，水墨屏只用下划线。
- 编辑器内列表项、表格单元格中的段落去掉段距，表格行高与列表间距和预览一致；Crepe 自带的分隔线底色已清除。
- **代码高亮：** 编辑器中 CodeMirror 的 oneDark 主题换为 `codeTheme.ts` 的变量主题，浅色、暖色、夜间三套配色（`--syntax-*`）。
- **Mermaid：** 使用 `base` 主题，`diagramVariables(styleId)` 由风格数据生成配色；导出时按导出风格重新绘制，打印友好模式下夜间风格的图改用浅色。
- **KaTeX：** 继承正文颜色。

## 收尾：预览与导出的代码高亮（2026-11-11）

- `src/core/markdown/highlight.ts`：`loadCodeParsers` 按文档中围栏代码的语言名，从 `@codemirror/language-data` 按需加载解析器；`rehypeHighlightCode` 在净化之后运行，只把 `pre > code` 的文本按解析结果切成 `<span class="tok-角色">`，类名是固定的 11 个角色，不带任何来自文档的属性，净化规则未改。未知语言、未标语言的代码保持纯文本；单块超过 100,000 字符或全文累计超过 500,000 字符的部分不高亮。
- `src/core/markdown/syntaxRoles.ts`：编辑器（`codeTheme.ts`）与预览、导出共用同一份“CodeMirror 默认高亮色 → 角色”映射；`.mino-doc pre .tok-角色` 取 `--syntax-角色`，因此浅色、暖色、夜间三套配色与编辑器一致，打印友好模式下夜间风格改用浅色配色。
- 预览：worker 先 `await loadCodeParsers(source)` 再同步渲染；导出：`renderExport` 内加载。`vite.config.ts` 把 worker 改为 ES 模块格式（`worker.format: 'es'`）以支持按需加载，worker 创建方式本来就是 `type: 'module'`。worker 主文件 745 kB，语言解析器为按需加载的独立分片。
- 依赖：把已安装的 `@codemirror/language-data` 6.5.2、`@lezer/highlight` 1.2.5 声明为直接依赖，版本与锁文件一致，锁文件只在根依赖列表增加这两行；两者已在 `dependency-licenses.tsv`（MIT）中。
- 测试 `tests/code-highlight.test.ts` 5 项 PASS：语言名提取、只加载已知语言、固定类名且代码文本仍转义（`<script>` 不出现）、无解析器或超限时为纯文本、导出页高亮与 CSS 规则。

## 收尾：表格样式与数字列（2026-11-11）

- 设置“排版”页新增“表格：三线表 / 全框线”（`tableStyle`，`three-line` / `grid`），只改变 `--table-edge`、`--table-frame`、`--table-cell` 三个 CSS 变量，切换不重建编辑器；导出与打印套用同一设置。`settings.rs` 白名单加入该字段，旧设置文件缺字段时为 `three-line`（与升级前一致），未知值被拒绝，均有测试。
- 数字列右对齐：一列的所有非空正文单元格都是数字（允许正负号、货币符号、千分位、小数、% 和 ‰）时，该列表头和单元格右对齐并使用等宽数字。Markdown 中已写明对齐的列保持原样。预览与导出由净化之后的 `rehypeNumericColumns` 加固定类名 `mino-num`；编辑器用 ProseMirror 节点装饰（`src/features/editor/numericColumns.ts`），不修改文档。编辑器里新建的表格带显式左对齐，因此不自动右对齐，这与保存后重新打开的行为一致。
- 测试 `tests/table-display.test.ts` 4 项 PASS：数字识别；预览与导出只给数字列加类名、显式对齐列不变；两种表格样式的变量；编辑器装饰正确且 `getMarkdown()` 不变。Rust 70 项 PASS。

## 收尾：切换风格时重绘 Mermaid（2026-11-11）

- Crepe 只在代码块内容变化时调用预览钩子，切换风格不会触发。`src/features/diagrams/mermaid.ts` 记录每个已绘制图表元素的源码与风格，新增 `restyleDiagrams(root, theme)`：在原元素内按新风格重绘（优先用缓存），不经过 ProseMirror 事务，因此文档、未保存状态、撤销栈和编辑器实例都不变。代码块节点视图没有可编辑内容 DOM，ProseMirror 忽略其中的 DOM 变化，与 Crepe 自己异步写入图表的方式相同。
- `useDocumentWorkspace.ts` 在风格变化时，只有页面上已有图表才按需加载该模块并重绘；没有图表的文档不加载 Mermaid。绘制中途代码块被编辑或再次切换风格时放弃旧结果；语法错误的图与风格无关，不重绘。
- 源码保护预览本来就不绘制 Mermaid（显示为代码），不涉及。
- 测试 `tests/mermaid-restyle.test.ts` 1 项 PASS（用替身代替 Mermaid 库）：按新风格在原元素内重绘，非本模块绘制的元素不动，同一风格不重复绘制，回到旧风格时用缓存。

## 与章程的差异

（无。v0.3 §16 中的代码高亮、表格两项已在收尾中完成。）

## 自动化结果

全量 Vitest 306 项 PASS，包含 Mermaid 净化、导出 HTML 结构与本任务相关的 CSS 生成。

## 样张

- `doc/evidence/reading/M3-reading-mode.jpg`：书页、宣纸、夜读三种风格下同一篇含全部元素的样例（阅读模式）。
- `doc/evidence/reading/M3-preview.jpg`：同一样例加一段公式，在编辑器中的显示。
- `doc/evidence/reading/M1-14-styles.jpg`：14 个风格的首屏。
- 收尾后重新生成（2026-11-11）：`M3-reading-mode.jpg`、`M3-preview.jpg`（样例表格改为不写对齐、增加定价列，可见数字列右对齐）；新增 `M3-grid-table.jpg`（书页与夜读的全框线表格）、`M4-paper-grid-print-print.pdf/.jpg`（全框线打印）；`M4-*` 导出 PDF 已带代码高亮与数字列右对齐。

## PENDING

各风格下全部元素可读；代码高亮；图表与公式配色；用户验收。
