# T96 编辑器插件

状态：automatedVerified。2026-11-12。

## 逐项结果

| 编号 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| P5-1 表格数字列 | 每次修改文档都遍历全部表格、读取每个单元格的文字并重建装饰集 | 修改没有碰到任何表格时只做 `previous.map`；碰到表格（单元格内输入、表格增删）时照旧重算。300 个表格 × 20 行：表格外按一次键由 5.4–7.1 ms 降到 0.04–0.09 ms | 达标，保留 |
| P5-2 图表连续渲染 | 多个图表在一条 promise 链上连续渲染，中间没有宏任务 | 每个图表渲染前让出一次主线程（`setTimeout 0`），顺序不变 | 达标，保留 |
| P5-3 关闭标签后的清理 | 关闭后台标签不通知编辑器池，编辑器实例和 DOM 留到下次激活可视文档；滚动位置、阅读位置、自动保存停用标记、草稿上传记录按文档累积，从不清除 | 关闭、分离标签时 `forgetDocument`：立即释放该文档的编辑器，并删除上述各项记录（含 T93 新增的草稿文本记录） | 达标，保留 |

P5-1 的判断方式：逐个检查事务里每一步改动的旧区间和新区间，区间内有表格、或区间起点位于表格内，就算碰到。未碰到时映射后的装饰集与对新文档重新计算的结果逐项相同，测试对此做了断言。

P5-2 每个图表增加一次 0–4 ms 的等待，换来图表之间输入与滚动可以插入。

## 测试

新增 `tests/editor-plugins.test.ts`（4 项）：

- 在表格前、后的段落里输入，删除、新增表格外的段落：`touchesTable` 为假，映射后的装饰与重新计算的一致。
- 在单元格里输入（数字列变成非数字列，装饰消失）、删除整个表格、插入新表格：`touchesTable` 为真，结果与重新计算的一致。
- 300 个表格时，表格外按键的耗时小于一次完整重算（输出两者的毫秒数）。
- 三个图表排队渲染时，另一串定时器任务在第一个与最后一个图表之间至少执行两次，渲染顺序不变。

`tests/app-shell.test.ts` 新增 1 项：预览里新建一个标签后关闭后台的那个标签，页面上的编辑器由 2 个立即变为 1 个。**反向验证**：去掉 `forgetDocument` 里的 `drop` 后该项失败（仍是 2 个），恢复后通过。

`tests/table-display.test.ts`、`tests/mermaid.test.ts`、`tests/mermaid-restyle.test.ts`、`tests/editor-pool.test.ts` 未改，全部通过。

## 改动的文件

`src/features/editor/numericColumns.ts`、`src/features/diagrams/mermaid.ts`、`src/app/useDocumentWorkspace.ts`、`tests/editor-plugins.test.ts`（新）、`tests/app-shell.test.ts`。

## 检查

`npm run typecheck` PASS；`npm run test` 530 项 PASS、1 项跳过。

## 实机 PENDING

含 20 个以上表格的文档里打字无迟滞；含 10 个图表的文档打开时可以滚动；分离标签到新窗口后原窗口与新窗口都正常。
