# T48 源码编辑器升级

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/features/source/SourceEditor.ts` 封装 CodeMirror 6，向工作区提供与 textarea 相近的接口（`value`、选区、`readOnly`、`reveal`、`replaceRanges`）。`SourceEditorView.tsx` 负责挂载，按需懒加载，正文不进入 React 状态。
- 行号、Markdown 高亮、Tab 缩进和独立撤销历史。字号、行高、居中宽度和颜色沿用 CSS 变量；深色和石墨主题使用深色高亮。
- `src/features/source/sourceText.ts` 处理字节保真：单一换行风格的文件以干净的行编辑，读取时还原原换行；混合换行的文件把 `\r` 保留为可见字符，未改动的行不变。偏移在已保存字符串与 CodeMirror 位置之间换算，查找和大纲继续使用字符串偏移。
- 旧的 textarea 会把 CRLF 规范化为 LF，这次一并消除了这个差异。
- 查找替换、大纲、字数、草稿、保存和导出都读取同一个 `value`。程序写入不算用户编辑，全部替换为一步撤销。

## 自动化结果

`tests/source-text.test.ts` 覆盖 LF、CRLF、CR、混合换行、BOM、无尾换行、空文档和编辑后换行风格，以及偏移换算。`tests/source-editor.test.ts` 在 jsdom 中覆盖真实的 `SourceEditor`：原文读取、用户编辑上报、程序写入、CRLF 选区、一步撤销、只读、销毁后调用、主题切换。jsdom 没有布局，滚动定位未被覆盖。

`npm run typecheck` PASS，`npm run test` 279 项 PASS，`npm run build` PASS。未涉及 Rust，最终全量 `cargo test --lib` 69 项 PASS（1 项计时测试默认忽略）。

构建体积：`dist/assets` 替换前后均为 8016 KB（`du -sk`），新增的 `SourceEditorView` 分块约 8 KB。没有新增依赖版本。

## PENDING

中文输入法、CRLF 文件保存后逐字节比对、接近 20 MiB 文档的响应、查找和大纲跳转的滚动位置、`Cmd+Z` 走 CodeMirror 历史还是系统撤销、包体积，用户验收。在同一次会话里混合换行文件的 `\r` 会显示为特殊字符标记。
