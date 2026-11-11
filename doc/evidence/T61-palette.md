# T61 配色体系重定

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 窗口界面改为中性灰，不再随纸色变化：`src/features/reading/styles.ts` 只保留浅色、深色两套界面色（`lightUi`、`darkUi`），风格只决定纸面颜色和一个强调色。纯黑风格另有更暗的界面色（T74 已移除纯黑；现在淡黑与中灰各有自己的界面色）。
- 页面是一张圆角卡片（`PAGE_RADIUS = 14`，左右内边距 88 px），放在灰色桌面上，带轻阴影。
- 强调色只用于链接、一二级标题和控件的选中状态；三级及以下标题用加深的正文色。新增 CSS 变量 `--title`、`--ui-text`、`--ui-secondary`、`--ui-muted`。
- 编辑器、源码保护预览、HTML 导出、打印仍由 `css.ts` 从同一份风格数据生成。

## 自动化验证

`tests/reading-styles.test.ts`（18 项）：每种风格正文、次要文字、链接、标题、代码文字对纸面的对比度；界面文字对界面底色的对比度；界面色不取纸色。测试发现浅色 `--ui-secondary` 对比度不足，已改为 `#575d67`，不再有例外清单。

## 样张

`doc/evidence/reading/T74-all-styles.jpg`：各风格同一文档的总览（离屏 WKWebView，Vite 开发页面）。原样张 `T61-all-styles.jpg`（九种风格，1280×860 窗口）已删除，由 T74 的 12 种风格总览取代。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：在真实窗口和显示器上看九种风格的界面灰度、卡片阴影和圆角。
- 实机 PENDING：切换风格时编辑器不重建（光标、撤销历史、滚动位置保留）。
- 用户验收 PENDING：整体观感是否达到用户以微信读书为参照的预期。
