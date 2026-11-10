# T47 选中文本转换

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/features/editor/textTransform.ts`：大写、小写、单词首字母大写、中英文之间加空格、标点转全角、标点转半角。“格式 > 转换文本”子菜单通过 `transform-*` 动作触发，文案同步到 `native_menu.rs`。
- 只处理选区内的文本节点，按节点替换以保留加粗、链接等 mark，链接地址不变。行内代码、代码块、公式和其他 atom 把文本分段，不被改动，空格也不会跨过它们。
- 中英文加空格是幂等的。位于标记边界的空格只带两侧共有的 mark，避免出现 `**中 **` 这种无法闭合的 Markdown。
- 转全角时保留 `3.14`、`1,000`、`12:30`、`example.com`、`https://` 和 `...` 中的 ASCII 标点。直双引号成对转换，单引号因和撇号相同而不转。
- 无选区、结果无变化或 IME 组合时不执行，也要求焦点在正文。每次转换一步撤销。

## 自动化结果

`tests/text-transform.test.ts` 22 项覆盖转换规则、跨 mark 的单词、幂等、超出基本平面的字符、标记边界空格、跳过代码和公式、选区保持。`tests/format-actions.test.ts` 核对转换菜单项。`npm run typecheck` PASS，`npm run test` 257 项 PASS，`npm run build` PASS，`cargo test --lib` 69 项 PASS。

## PENDING

菜单实际操作，含加粗、行内代码和链接的选区转换，撤销，保存重开，用户验收。
