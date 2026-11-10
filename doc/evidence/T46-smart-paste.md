# T46 智能粘贴

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/features/editor/smartPaste.ts`：制表符文本解析、粘贴地址判定、建表和加链接的事务，都有纯函数入口。
- 链接：选区非空、位于同一普通文本块、不含行内代码，且剪贴板恰好是一个 `http`、`https` 或 `mailto` 地址，并通过 `safeLinkHref`。其余按普通文本粘贴。
- 表格：至少 2 行 2 列，每行列数相同，上限 500 行、30 列。首列全空的内容视为制表符缩进的代码，按普通文本粘贴。不在代码块或表格内建表。单元格内容是纯文本，序列化时转义 `|` 和 Markdown 符号。
- 判定顺序：规则的制表符文本 → 图片 → 链接。表格软件复制时常同时提供单元格截图，所以表格优先于图片；纯截图没有制表符文本，不受影响。技术设计 §16 已同步。
- 规则只在 `view.hasFocus()` 为真且非 IME 组合时生效，粘贴到代码块（CodeMirror）时保持原文。每次粘贴一步撤销。

## 自动化结果

`tests/smart-paste.test.ts` 21 项，包含用真实 Milkdown schema 和序列化器验证 GFM 输出、竖线转义、恶意协议、不规则行、超限、代码块和表格内拒绝。`npm run typecheck` PASS，`npm run test` 232 项 PASS，`npm run build` PASS。未涉及 Rust。

## PENDING

从浏览器粘贴网址、从 Excel 和 Numbers 粘贴表格（包括剪贴板实际提供的格式）、代码块内粘贴、截图粘贴，用户验收。
