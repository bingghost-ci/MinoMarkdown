# T38 Mermaid 图形渲染

任务：T38 / G38 · 日期：2026-11-10 · 输入版本：`4fd5f59` 之上的未提交工作区 · 运行环境：macOS arm64，Vitest（jsdom 用于净化测试），未启动原生应用。

## 变更

- `src/features/diagrams/mermaid.ts`：按需加载 Mermaid，`securityLevel: 'strict'`，串行渲染；`sanitizeDiagramSvg` 用独立的 DOMPurify 实例，只留本地 `#` 引用并去掉远程 CSS；`renderMermaidPreview` 接到 Crepe 代码块预览，打字时只渲染最新内容；`renderDiagramsForExport` 用于导出。
- `src/core/markdown/diagrams.ts`：`mermaidSources`、`mayContainMermaid`、`rehypeEmbedDiagrams`。
- `src/features/export/renderHtml.ts`、`analysis.worker.ts`、`analysisClient.ts`、`src/app/useDocumentWorkspace.ts`：导出把已净化的静态 SVG 放进页面；失败的图保留代码，状态提示数量。
- `src/features/editor/EditorAdapter.ts`：`CrepeFeature.CodeMirror.renderPreview`。保存路径不变，文件中仍是 `mermaid` 代码块。
- `package.json`、`package-lock.json`：`mermaid@11.17.2`、`dompurify@3.4.17`（与 Mermaid 依赖同版本）；开发依赖 `jsdom@26.1.0`，用于恶意标签测试。

## 按需加载与体积

构建后 `EditorAdapter` 和两个 `index` 入口 chunk 中没有 Mermaid 图类型代码，Mermaid 在独立 chunk 中，只有文档含 `mermaid` 代码块时才 `import()`。

`dist` 从 T37 的 4,552 KiB 增至 7,996 KiB，Mermaid 约增加 3.4 MiB。技术设计 §12 的预算为压缩包 ≤ 40 MiB、应用目录 ≤ 100 MiB，未超；未重新打包，实际 `.app` 大小待集中测试。

## 检查

- `npm run typecheck`：PASS。首次因 `RETURN_DOM` 返回类型失败，修复后 PASS。
- `npm run test`：18 个文件、142 项 PASS，新增 `tests/mermaid.test.ts`。覆盖围栏识别、文件模型、恶意 SVG、导出嵌入和错误图保留代码。首次失败是净化器移除了本地 `use`，已放行并由后处理限制为 `#` 引用。
- `npm run build`：PASS。
- 本任务未改 Rust。

## 限制

- Mermaid 依赖真实布局，jsdom 中无法实际绘图。真实 `mermaid.render` 只能在 WebKit 中验证。
- 源码保护文档的预览仍显示代码；它的 HTML/PDF 导出会绘图。
- 原生实测 PENDING：图形显示、修改源码、错误图提示、离线 HTML 和 PDF、包体积。用户验收 PENDING。
