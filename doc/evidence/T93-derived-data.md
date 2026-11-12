# T93 光标移动与派生数据

状态：automatedVerified。2026-11-12。

本任务新增了应用级测试夹具 `tests/helpers/appHarness.tsx`：在 jsdom 里按浏览器预览方式挂载整个 `App`（含编辑器），用来数监听器注册和渲染次数。此前主 hook 没有任何组件级测试。

## 逐项结果

| 编号 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| P2-1 编辑器的派生值 | `outline()`、`plainText()`、`referencedImageUrls()` 每次调用都遍历整个文档；只移动光标也在 300 ms 后全部重算，并对全文重新统计字数 | `EditorAdapter` 按文档对象的身份保存这三个结果（ProseMirror 文档不可变），文档没变时返回同一个对象；`createWordCounter` 在文本没变时只统计选区 | 达标，保留 |
| P2-2 大纲状态 | `setOutlineItems` 每次给新数组 | 内容相同（级别、文字、目标）时保留旧数组，不触发渲染 | 达标，保留 |
| P2-3 切换标签 | 每次离开标签都完整序列化文档；有未保存内容时每次都重写草稿 | 序列化结果同样按文档身份保存，文档没变时 `crepe.getMarkdown` 调用 0 次；草稿的文本、文件名和磁盘版本与上次写入的相同时不再重写 | 达标，保留；做法与方案不同，见下 |
| P2-4 渲染时的全文编码 | 0.7–2 M 字符的文档每次渲染执行一次 `TextEncoder.encode` | `useMemo`，文本不变不重算 | 保留（代码审阅，无单独测试） |
| P2-5 版式判定 | 源码模式下每次刷新文本都重算，版式可能在编辑中途翻转 | 只在文档标识或磁盘版本变化时计算，与该处注释“随打开或上次保存时的文本”一致 | 保留（代码审阅，无单独测试） |
| P2-6 键盘监听 | effect 没有依赖数组，每次渲染拆掉重挂 | 只订阅一次，处理函数经 ref 取最新状态 | 达标，保留 |
| P2-7 表格尺寸选择、状态栏 | 指针每移动一次重渲染 80 个格子；状态文字每次渲染翻译两遍 | 悬停格没变时保留旧状态；翻译一次 | 保留（代码审阅） |

## P2-3 与方案的差别

方案写的是“记住上次捕获的修订号，相同则跳过”。实现时发现编辑器把修改通知延后约 200 ms 才发出，修订号在这段时间里还没有增加：如果按修订号判断，刚输入完就切换标签会拿到旧文本。改为按文档对象的身份缓存序列化结果，文档一变缓存即失效，没有这个时间窗。草稿的跳过条件也因此不用修订号，而是直接比较要写入的文本。丢弃草稿时清掉对应记录。

## 测试

新增 `tests/derived-data.test.ts`（4 项）：

- 文本不变、只换选区时，全文只统计 1 次。
- `sameOutline` 对相同与不同的大纲的判断。
- 真实编辑器：移动选区后 `outline()`、`referencedImageUrls()`、`getMarkdown()` 返回同一对象，`crepe.getMarkdown` 只被调用 1 次；编辑后重新计算。
- 应用级：挂载后再触发多次渲染，`window` 上 `keydown` 的注册次数不变。

新增 `tests/app-shell.test.ts`：整个应用能在测试环境里挂载并显示编辑器。

草稿跳过（P2-3 后半）只在桌面应用里生效，测试环境没有 Rust，未被自动化覆盖。

## 改动的文件

`src/features/editor/EditorAdapter.ts`、`src/features/document/derived.ts`（新）、`src/app/useDocumentWorkspace.ts`、`src/app/TableSizePicker.tsx`、`src/app/components/StatusBar.tsx`、`tests/derived-data.test.ts`（新）、`tests/app-shell.test.ts`（新）、`tests/helpers/appHarness.tsx`（新）。

## 检查

`npm run typecheck` PASS；`npm run test` 516 项 PASS、1 项跳过。

## 实机 PENDING

在 1 MiB 文档里连续点击、方向键移动光标无迟滞；两个大文档之间切换标签立即完成；有未保存内容时切换标签，草稿内容仍是最新的。
