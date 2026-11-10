# T37 数学公式可视化

任务：T37 / G37 · 日期：2026-11-10 · 输入版本：`4fd5f59` 之上的未提交工作区 · 运行环境：macOS arm64，Vitest，未启动原生应用。

## 变更

- `src/features/editor/EditorAdapter.ts`：启用 `CrepeFeature.Latex`，`trust: false`。
- `src/core/markdown/math.ts`：`remarkDemoteCurrency` 和 `mathValues`。
- `src/core/markdown/compatibility.ts`、`src/features/preview/renderMarkdownPreview.ts`、`src/features/export/renderHtml.ts`、编辑器：四处都用 `remark-math` 加同一个降级规则。
- `src/core/markdown/renderMath.ts`：净化之后用 KaTeX 渲染，`trust: false`；`src/features/export/katexStyles.ts`：只有含公式的页面才内嵌样式和 WOFF2 字体。
- `src/features/editor/markdownStringify.ts`：只在 `$` 真的会被读成公式时才转义。
- `vite.config.ts`：构建时去掉 KaTeX 的 WOFF/TTF 副本；测试放行 KaTeX CSS。
- `package.json`、`package-lock.json`：直接依赖 `katex@0.19.1`、`remark-math@6.0.0`，均为已安装的 Crepe 依赖版本。

## 所锁 Crepe 7.22.3 的问题及处理

| 问题 | 不处理的后果 | 处理 |
| --- | --- | --- |
| `remark-math` 把 `$5 和 $6` 读成公式 | 价格显示成公式 | 按 Pandoc 规则降级为文本，并还原其中的行内格式 |
| 输入规则在输入 `$5 和 $` 时立刻转公式 | 打字打断 | 创建后替换为严格规则 |
| 保存时把文本里所有 `$` 转义成 `\$` | 含价格的文档被改写 | 只在会形成公式时转义 |
| ` ```latex ` 代码块保存成 `$$` | 代码变公式 | 整篇退回源码保护 |
| `$$x$$` 行内写法、未闭合块公式、带 meta 的块公式保存时被规范化 | 公式原文改变 | 整篇退回源码保护 |

打开后再次比较公式 fragment，编辑器若改变任一公式，文档转入源码保护。

## CSP 变更

`tauri.conf.json` 增加 `font-src 'self' data:`。打印 iframe 使用 `srcdoc`，会继承应用 CSP；不放开 `data:`，打印页无法加载内嵌公式字体。字体不能执行脚本。导出 HTML 自身的 CSP 只在含公式时从 `font-src 'none'` 变为 `font-src data:`。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：17 个文件、135 项 PASS，新增 `tests/math.test.ts`。测试用 Crepe 自身的公式 schema 和解析插件做往返。`tests/markdown-codec.test.ts` 原断言“公式进入源码保护”，按 T37 改为可视化，指令仍受保护。
- `npm run build`：PASS。`dist` 由 T34 基线的 3,332 KiB 增至 4,552 KiB，含 T35–T37 全部增量。
- `cargo check --locked --offline`：PASS。

## 限制

- 含 ` ```latex ` 代码块的文档以前可视化，现在进入源码保护，这是 Crepe 行为决定的取舍。
- 测试环境无 DOM，没有运行公式 tooltip 编辑、KaTeX DOM 渲染和真实 WebKit 字体加载。
- 原生实测 PENDING：WebKit 中编辑公式、中文混排、保存重开、PDF 公式显示。用户验收 PENDING。
