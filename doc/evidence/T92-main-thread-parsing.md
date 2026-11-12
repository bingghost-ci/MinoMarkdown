# T92 消除主线程重复解析

状态：automatedVerified。2026-11-12。测量办法见 [T91](T91-baseline.md)；解析次数用 `tests/main-thread-parsing.test.ts` 统计（替换 `unified`，对每次 `parse` 计数）。

## 逐项结果

| 编号 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| P1-1 保存时的 `imageUrlsIn` | 每次保存在主线程解析全文一次（1 MiB + 20 图：350 ms），可视模式下结果不被读取 | 可视模式不计算；源码模式只在有恢复图片时计算，并且在 worker 里 | 达标，保留 |
| P1-2 写草稿时的 `imageUrlsIn` | 没有活动编辑器的文档每次写草稿解析全文一次 | 只在草稿里已存有图片、文档有恢复图片、或可视文档有磁盘图片时计算，在 worker 里；文本不含 `![` 时直接返回空 | 达标，保留 |
| P1-3 保存时的 `rewriteImageUrls` | 含本地图片的文档每次保存在主线程解析全文一次（375 ms） | 保存改用 `EditorAdapter.persistableMarkdown()`，改写在 worker 里；同步的 `getPersistableMarkdown` 留给其他同步调用方 | 达标，保留 |
| P1-4 打开时的两次解析 | worker 分析完后主线程再解析两遍（350 + 375 ms） | 新的 `hydrate` worker 任务：分析之后用一次解析同时找出并改写图片地址（`replaceImageUrls`） | 达标，保留 |
| P1-5 片段复查移到 worker | 主线程一次序列化加一次解析 | 未改 | **放弃，与红线冲突**，见下 |
| P1-6 `$` 段落的序列化缓存 | 2000 段：首次 193 ms，之后每次 140 ms（缓存从不命中） | 首次 197 ms，之后每次 10 ms（首次的 5%，门槛 20%） | 达标，保留 |
| P1-7 问题行号 | 2000 处问题的 `analyzeMarkdown` 559 ms | 250 ms，下降 55%（门槛 50%） | 达标，保留 |
| P1-8 相邻加粗的预筛 | 每个可视文档多解析一次 | 文本不含该模式时解析 0 次 | 达标，保留 |
| P1-9 `prepare` 回复瘦身 | 回复里有 `source`、`body`、`serialized` 三份文档副本（`semantics` 此前已去掉） | `PreparedMarkdown.analysis` 的类型改为不含这四个字段的 `PreparedAnalysis`，主线程与 worker 两条路径一致；快速阅读用的替身分析也不再带两份全文 | 达标，保留 |

顺带改动：主 hook 里其余几处同步解析（分离标签、接收分离的标签、恢复草稿、切到可视模式）也换成了 worker 版本，于是主 hook 不再直接调用任何同步的图片解析函数，测试对此做了断言。

## P1-5 为什么放弃

片段复查（`fragmentsSurvived`）必须在用户能往编辑器里输入之前得出结论：复查不通过时文档要退回源码保护，否则编辑器会改写原始 HTML、公式或脚注。改成异步后，用户可以在结果回来之前输入；此时复查若不通过，既不能丢掉用户的输入，也不能让文档继续留在可视模式。这与“保存的字节保真”红线冲突，按方案 §2.3 放弃，并在代码里加了注释说明它为什么是同步的。它只影响含原始 HTML、公式或脚注的文档，每次打开一次。

## 测试

新增 `tests/main-thread-parsing.test.ts`（8 项）：

- 主 hook 的源码里没有对 `imageUrlsIn`、`rewriteImageUrls`、`replaceImageUrls`、`hydrateMarkdown` 的直接调用，保存走 `persistableMarkdown()`，`referenced` 只在 `!visual && recoveredAssets.size` 时计算。
- `replaceImageUrls` 只解析 1 次，结果与“先 `imageUrlsIn` 再 `rewriteImageUrls`”逐字节相同（行内、尖括号、引用式、远程图片）。
- 不含图片的文本、空的替换表：解析 0 次。
- `hydrateMarkdown` 与旧的打开流程结果相同；链接与图片共用引用时判为失败并退回源码保护。
- 分析结果不含 `source`、`body`、`serialized`、`semantics`。
- 第二次序列化解析 0 次，输出与第一次相同；只有一个 `$` 的段落解析 0 次。
- 行号与逐个数换行的旧算法一致。

两处既有断言随 P1-9 删除：`tests/markdown-codec.test.ts` 与 `tests/large-document.test.ts` 里对 `analysis.source` 的断言，该字段已不在准备结果里。`analyzeMarkdown` 本身仍返回这些字段，`markdown-baseline` 的往返测试未动。

主 hook 没有组件级测试（T89 记录的既有缺口），所以 P1-1、P1-2 的“调用 0 次”是用对源码的断言加上被调函数的计数测试来保证的，不是在运行中的 hook 上数出来的。

## 改动的文件

`src/features/export/snapshot.ts`、`src/features/document/hydrate.ts`（新）、`src/core/markdown/analysis.worker.ts`、`analysisClient.ts`、`codec.ts`、`compatibility.ts`、`cjkEmphasis.ts`、`src/features/editor/markdownStringify.ts`、`EditorAdapter.ts`、`src/features/document/largeDocument.ts`、`src/app/useDocumentWorkspace.ts`、`tests/main-thread-parsing.test.ts`（新）、`tests/markdown-codec.test.ts`、`tests/large-document.test.ts`。

## 检查

`npm run typecheck` PASS；`npm run test` 511 项 PASS、1 项跳过；`npm run build` PASS（`workerWithoutDom` 检查通过）。入口包 3,123,280 字节（+1.2 kB，新增的 worker 调用封装），worker 主包 782,010 字节。

## 实机 PENDING

打开 1 MiB 带 20 张图的文档、编辑并等自动保存时输入不停顿；Web Inspector 时间线里保存时没有超过 50 ms 的主线程任务。
