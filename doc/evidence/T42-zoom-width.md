# T42 文本缩放与居中加宽

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/app/textZoom.ts`：字号边界 13–22、默认 15、步进 1 的纯函数。设置页的加减按钮复用同一函数。
- “视图”菜单新增放大、缩小、还原（`Cmd+=`、`Cmd+-`、`Cmd+0`），经 `menu-action` 修改 `settings.editorFontSize`。没有新增设置字段，持久化和多窗口同步沿用现有链路。浏览器开发模式走 `!desktop` 的 keydown。
- `src/styles.css`：可视化、源码、预览三处的 860px 收敛为 `--editor-centered-width: 1040px`，内边距不变，宽屏规则和导出样式未改动。
- 标题使用 `em`，Crepe 代码块使用 `--crepe-base-font-size`，均随 `--editor-font-size` 缩放；界面字号不使用该变量。

## 自动化结果

`tests/text-zoom.test.ts` 覆盖步进、边界、还原和动作识别。`npm run typecheck` PASS，`npm run test` 173 项 PASS，`npm run build` PASS，`cargo test --lib` 69 项 PASS（1 项计时测试默认忽略）。

## PENDING

快捷键和菜单缩放的实际效果、边界停止、重启保持、多窗口同步、WebKit 中 1040px 的显示、窄窗口无横向滚动，用户验收。
