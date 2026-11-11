# T57 图片呈现

日期：2026-11-11。层级：automatedVerified，原生实测与用户验收 PENDING。

## 实现

- 图片居中，最大宽度不超过行宽，小图不放大。纸张风格为 6px 浅色衬边加轻投影，护眼与夜间风格为 1px 细边框。
- **图注：** 预览与导出由 `src/core/markdown/figures.ts`（rehype 插件）把独占一段的图片包成 `<figure class="mino-figure">`，用 title、否则用 alt 生成 `<figcaption>`，只作为纯文本输出，不改 Markdown。行内图片不加图注。编辑器中使用 Crepe 图片块自带的说明文字，阅读模式隐藏空说明。设置可关闭图注。
- **夜间降亮：** 夜间风格默认 `filter: brightness(.9)`，可在设置关闭。
- **放大查看：** 阅读模式下点击图片打开灯箱，背景压暗，Esc 或再次点击关闭。
- 导出保留同样的衬边与图注；打印时图片不跨页。

## 与章程的差异

编辑器只有 alt、没有 title 的图片不显示图注：Crepe 的说明框读写的是 title，用 alt 填充会在编辑时写回文档，违反“只改呈现”。预览与导出不受影响。

## 自动化结果

`tests/export-style.test.ts` 中“图注由 title 或 alt 生成、只输出文本、行内图片不加、可关闭”PASS；导出 HTML 无外部引用 PASS。

## 样张

`doc/evidence/reading/M3-reading-mode.jpg`、`M4-*-print-*.jpg` 中的“图 1　晴日远山”。

## PENDING

衬边、图注、夜间降亮、放大查看的实机效果；导出与屏幕一致；用户验收。
