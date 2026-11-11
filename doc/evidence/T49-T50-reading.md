# T49–T50 页面视图与主题修订

日期：2026-11-11。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/styles.css`：每个主题新增 `--desk`、`--page-edge`、`--page-shadow`、`--code-ink`。`data-editor-width="centered"` 下，编辑区与预览区背景为桌面色，`.ProseMirror` 和 `.markdown-preview-content` 显示为纸张，宽度为 `min(1040px, 100% - 64px)`；窄窗口媒体查询缩小纸张边距。行内代码改用 `--code-ink`，不再固定为 Crepe 的红色。
- 纸张纹理：`--paper-grain`（细颗粒）与 `--paper-fiber`（低频纤维斑）为内联 SVG `feTurbulence` 噪点，透明度约 3%–5%，经 `--paper-texture` 用于暖纸、护眼绿、护眼黄、水墨屏的纸面；浅色、科技蓝白和深色系不加纹理。
- 主题配色：护眼绿（`mint`，纸面 `#dcebd9`）、护眼黄（`butter`，纸面 `#f3e9d2`）、夜间护眼（`graphite`，纸面 `#25221e`，暖色文字）、水墨屏（`eink`，浅灰白纸面 `#f4f2ec`、墨色文字、无彩色强调）；暖纸和科技蓝白微调并补齐桌面色。设置页色块同步。
- `src/app/appearance.ts`、`src/app/i18n.ts`：主题改名与排序，主题 ID 不变；“居中”文案改为“页面”。设置字段与 `settings.rs` 白名单未改动。

## 自动化结果

`npm run typecheck` PASS，`npm run test` 279 项 PASS，`npm run build` PASS。用 WKWebView 离屏加载 `?ui-preview=editor`，分别在 1280×800 和 1728×986 窗口下截取九个主题的页面视图：纸张边界和两侧桌面可见，浅色主题之间正文底色可明显区分，水墨屏无彩色。

## PENDING

实机各主题观感、护眼主题长时间阅读舒适度、窄窗口无横向滚动、源码保护预览中的纸张显示、旧设置启动后主题正确，用户验收。
