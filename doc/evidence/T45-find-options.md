# T45 查找增强

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/features/editor/find.ts`：增加区分大小写、全词匹配、正则三个选项，`findInDoc` 和 `findInText` 共用同一扫描逻辑，所以两种文档模式规则一致。选项存入 ProseMirror 插件状态，文档变化时沿用。
- 全词匹配用匹配后过滤实现，不依赖 lookbehind，因为 macOS 12 的 WebKit 不支持。中日韩字符不算单词的一部分，所以 `编辑` 能在 `编辑器` 中命中，`API` 能在 `API接口` 中命中。
- 正则先用 Unicode 模式编译，失败再用传统模式，两者都失败才报无效。零长度匹配不计入。替换支持 `$1`、`$&`、`$<name>`、`$$`；非正则查找的替换文本保持原样。
- 全部替换是一个事务并用 `closeHistory` 断开，构成一步撤销。
- 源码超过 2 MiB（`exceedsVisualLimit`）时禁用正则，按钮禁用并在提示中说明原因。可视化文档本身不超过该限制。
- 从文件夹搜索结果跳转时重置选项，因为该查询是字面文本。

## 自动化结果

`tests/find-diff.test.ts` 新增 9 项，覆盖大小写、全词（含中日韩）、字面替换、分组展开、非法正则、宽松转义、零长度匹配和文档匹配。`npm run typecheck` PASS，`npm run test` 211 项 PASS，`npm run build` PASS。未涉及 Rust。

## PENDING

三个选项在 WebKit 中的组合、中文查询和输入法、非法正则提示、两种文档模式的实际结果，用户验收。单个超长段落上的灾难性正则仍可能短暂阻塞主线程，只有超过 2 MiB 的源码被拦截。
