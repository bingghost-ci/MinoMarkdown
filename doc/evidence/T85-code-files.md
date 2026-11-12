# T85 代码与配置文件

日期：2026-11-12。层级：codeComplete，automatedVerified（渲染逻辑有测试；界面有离屏 WebKit 样张）；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src/features/text/codeDocument.ts`：每行一个 `span.l`，行号由 CSS 计数器生成（复制文字时不带行号）；跨行的记号（块注释、多行字符串）在每个换行处闭合再打开。高亮用 Markdown 代码块同一套记号类名和配色（`syntaxRoles.ts`），语言由文件名决定（`LanguageDescription.matchFilename`）。超过 50 万字符不做高亮；超过 2 MiB 不生成预览，直接用源码编辑器只读显示。
- `.log`、`.csv`、`.conf` 等没有对应语言的文件只有行号，没有颜色。
- HTML、XML、Vue 等只作为文本逐字符转义后显示。
- CSV / TSV：`src/features/text/delimited.ts` 解析（引号内的分隔符、换行、双引号转义；空行跳过），表格最多 5,000 行、200 列，超出时标出“已显示 / 总数”。阅读模式右侧多一个“显示原文 / 显示为表格”按钮。
- 编辑用 `SourceEditor`，按文件名加载语言高亮。

## 自动化验证

Vitest `tests/code-document.test.ts`（11 项）：逐行输出与原文一致；末尾换行不多出一行；JSON 的记号类名只来自固定集合；跨行记号每行自成完整元素；`page.html`（含 `<script>`、事件属性、远程图片）输出里只有 `code`、`div`、`pre`、`span`；无语言与超大文件不上色；18 种扩展名能找到语言；CSV 的引号、换行、转义、缺行尾、BOM、参差行；行数与列数上限；单元格按文本输出。

## 离屏 WebKit 样张

- `doc/evidence/formats/json-reading.png`：`config.json`，6 行、14 个着色记号，行号来自计数器，标签栏“代码与数据”，状态栏“JSON · UTF-8”。
- `doc/evidence/formats/csv-table.png`：`table.csv`，4 行、表头 4 列，悬浮按钮里有“显示原文”。
- `page.html` 在页面里显示 8 行源码，`window.hacked` 没有被设置，预览里没有 `script` 或 `img` 元素。

## 未验证

各语言高亮在各风格下的观感；代码文件用页面宽度还是宽屏更合适（现在代码预览不限宽）；编辑保存。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。
