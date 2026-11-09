# T32 图片与大文档

状态：代码完成，自动化通过；原生实机 PENDING；用户验收 PENDING。

- 图片读取走 `mino-asset` 自定义 URI，URL 含随机 `asset_key`，每次请求在 Rust 侧重新校验授权范围、符号链接和窗口。写入走 `stage_binary` 原始 IPC 请求体，保存、草稿、导出、标签分离只传暂存引用，不再使用 `number[]`。
- CSP 唯一放宽：`img-src` 增加 `mino-asset:`，供编辑器和预览显示已授权本地图片。`connect-src`、`script-src` 未放宽。
- 打开文档先显示正文，图片随后加载；加载失败的图片有 `data-missing` 占位和状态提示。
- 兼容性分析和 `renderMarkdownPreview` 在 Web Worker 运行，4096 字符内同步，Worker 不可用时回退同步，预览有加载状态。
- 可视化上限由 5 MiB 下调到 2 MiB，依据是 T30 的 1MiB 约 2.5–6.6 s（Node）。
- 超限文档使用非受控 textarea，输入时不触发 React 更新。

自动化：`asset-url.test.ts`、`staging.rs`、`documents.rs`、`markdown-codec.test.ts`。未验证：真实 WebKit 中 `mino-asset` 加载、Worker 加载、大图体感，均 PENDING。
