# T77 大文档快速打开

日期：2026-11-11。层级：codeComplete，automatedVerified（离屏 WKWebView 测量与单元测试）；原生实机验证 PENDING，用户验收 PENDING。

用户问：大文档能否只先加载前面几页（文件指针、内存映射）。

## 结论

- **读文件不是耗时所在。** 2 MiB 的文件在毫秒级读完；时间花在可视化编辑所需的 Markdown 分析、构建编辑器 DOM（1.95 MiB 富内容样例约 186,000 个节点）和排版上。按文件做部分读取或内存映射没有帮助，“先显示开头几页”改在渲染层实现。
- **分析用的 Web Worker 一直没有启动（长期存在的缺陷）。** micromark 的依赖 `decode-named-character-reference` 有一个 `browser` 构建，加载时调用 `document.createElement`；在 worker 里这会抛错，于是所有“后台”任务（分析、预览、导出渲染、字数统计）都悄悄回退到主线程，大文档时界面卡住。Vitest 发现不了，因为 Node 解析到的是不依赖 DOM 的构建。

## 实现

- worker 修复：`vite.config.ts` 用 resolve alias 指向不依赖 DOM 的构建，并新增构建检查 `workerWithoutDom`，DOM 构建再次进入 worker 产物时构建失败。
- 快速阅读：不少于 200,000 字符、且以阅读模式打开（文件的默认方式）的文件进入“快速阅读”。
  - 通过 worker 中经过净化的预览渲染器显示：先显示开头几页（约前 48,000 字符，在代码围栏之外的某个标题之前截断），整篇就绪后替换。
  - 此时不做分析、不加载编辑器。文档按“源码不变”的方式持有，文件内容不会被改动。
  - 用户开始编辑（`⌘⇧R` 或铅笔按钮）时才运行真正的分析并加载编辑器，状态提示“正在准备编辑器，大文档需要一些时间…”；阅读位置按比例带过去。分析结果要求源码保护时，文档照旧留在源码模式。
- 代码：`src/features/document/largeDocument.ts`；`src/app/useDocumentWorkspace.ts`（`quickDocument`、`deferredVisual`、先显示开头的预览 effect）；StatusBar、TabBar 中的标签。

## 自动化验证

- `tests/large-document.test.ts` 7 项：阈值、代替分析的占位结果、开头截断不落在代码围栏内、CRLF、找不到安全截断点的情形。
- worker 修复：生产构建的 worker 产物在真实的 WebKit worker 中加载成功，并完成了一次预览渲染任务。

## 测量

离屏 WKWebView，开发构建，1.95 MiB 富内容样例，同一台机器：

| 项目 | 之前 | 之后 |
| --- | --- | --- |
| 文档出现 | 约 27 s，期间主线程一直被占用 | 开头几页约 1.0 s，整篇约 4.5 s |
| 主线程停顿 | 全程 | 约 0.3 s 和约 1.2 s（插入 HTML 时） |
| DOM 节点 | 约 186,000 | 约 53,000 |
| 该文档切到编辑 | — | 约 26 s（代价未变，只在编辑时支付，有状态提示） |

## 样张

`doc/evidence/reading/T77-quick-reading.jpg`。

## 未验证与未解决

- 大型富内容文档进入编辑仍然慢。
- 快速阅读中使用查找会切到源码视图（与现有的源码保护文档相同）。
- 200,000 字符以下的文档行为不变。
- 以编辑状态（而非阅读）恢复的大文档会自动转入编辑器，不经过快速阅读。
- 以上测量来自离屏窗口和开发构建，没有在运行的桌面应用和发布构建中测过。

## 检查

2026-11-11，T74–T77 全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：41 个文件、448 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：100 项 PASS，2 项忽略。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 61.02 MiB（上一次为 60.94 MiB）。

未提交、未推送，没有运行 `./install.sh`。

## PENDING

- 实机 PENDING：从 Finder 打开一个真实的大文件，开头几页很快出现，余下内容加载期间可以滚动。
- 实机 PENDING：`⌘⇧R` 进入编辑，出现状态提示，阅读位置大致保留。
- 实机 PENDING：进入编辑后不改内容直接保存，文件逐字节不变。
- 用户验收 PENDING。
