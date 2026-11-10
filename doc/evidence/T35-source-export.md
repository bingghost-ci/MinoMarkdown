# T35 源码保护文档导出

任务：T35 / G35 · 日期：2026-11-10 · 输入版本：`4fd5f59` 之上的未提交工作区 · 运行环境：macOS arm64，Vitest，未启动原生应用。

## 变更

- `src/app/useDocumentWorkspace.ts`：`exportPage` 取消源码保护拦截；`captureSnapshot` 在源码模式下用 `recoveredAssets`，不再依赖编辑器实例。状态提示报告被移除的原始 HTML 数量。
- `src/features/export/snapshot.ts`：新增纯函数 `snapshotResources`。
- `src/features/export/renderHtml.ts`：新增 `exportBody`、`renderExport`。
- `src/core/markdown/analysis.worker.ts`、`analysisClient.ts`：导出渲染和图片引用解析进 Worker，避免 20 MiB 文档阻塞主线程。
- `src/app/components/FileControls.tsx`、`src/app/i18n.ts`、`README.md`：按钮和文案同步。

## 发现并修复

HTML/PDF 导出原先把 YAML front matter 当正文渲染，与技术设计 §6.1“HTML/PDF 默认不输出元数据”不符，可视化文档同样受影响。现由 `exportBody` 去除，BOM 和 CRLF 有用例。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：15 个文件、102 项 PASS，新增 4 项覆盖 front matter、恶意 HTML 与移除计数、无编辑器实例的快照路径、不可读图片拒绝。
- `npm run build`：PASS。
- 本任务未改 Rust。

## 限制

- 含远程图片的源码保护文档与可视化文档一致，导出 HTML/PDF 时拒绝并提示。
- 指令语法（`:::note`）按普通文本输出。公式在 T37 处理。
- 原生实测 PENDING：含原始 HTML 和本地图片的文档导出、离线打开 HTML、打印页。用户验收 PENDING。
