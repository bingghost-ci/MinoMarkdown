# T65 风格与字体弹出面板

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src/app/components/AppearancePanel.tsx`：从悬浮按钮弹出，包含字号滑块、九个风格色块、纹理强度（仅纸张风格显示）、行距、页面或宽屏显示、字体选择。设置对话框“外观”页用同一组 `StyleSwatches`。
- `src/app/components/FontPicker.tsx`：中文、西文、本机三个页签；“随风格”使用风格推荐的字体。
- 改动只写 `<html>` 上的 `data-theme` 和 CSS 变量（`src/app/appearance.ts`），不重建编辑器。

## 自动化验证

`tests/reading-fonts.test.ts`、`tests/reading-styles.test.ts` 覆盖面板背后的数据：`documentTypography` 给出的变量、字体栈、纹理强度取值范围。面板本身的交互没有组件测试。

## 样张

`doc/evidence/reading/T68-font-panel.jpg`：白、羊皮卷、深色三种风格下打开的面板。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：拖动字号和纹理滑块时页面即时变化、不卡顿；点面板外部或按 Esc 关闭。
- 实机 PENDING：切换风格、字体后光标位置和撤销历史保留。
- 用户验收 PENDING。
