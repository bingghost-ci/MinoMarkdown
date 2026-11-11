# T53 纸张材质库

日期：2026-11-11。层级：automatedVerified，原生观感与用户确认 PENDING。

## 实现

- `scripts/generate-paper-textures.mjs`：只用 Node 自带模块（`zlib`、`fs`、`path`），固定随机种子生成 256×256 无缝 PNG 图块；`--check` 模式比较已提交图块与重新生成结果。纤维为与纸面同色相、略亮或略暗的细线，颗粒为高频噪点，不生成低频暗斑。
- 图块：`src/assets/paper/` 下 paper（书页）、xuan（宣纸，长而浅的纤维）、kraft（牛皮纸，短密纤维加颗粒）、parchment（羊皮卷）、newsprint（再生纸）、butter（暖黄）。单张 51–72 KiB，合计 354 KiB（预算：单张 ≤ 150 KiB，合计 ≤ 1 MiB）。素白与其余护眼、夜间风格无纹理。
- 羊皮卷的做旧只是纸张四角的 CSS 径向渐变，不压在正文区。
- 应用内纹理以 Vite 内联 data URI 加载（`textures.ts`），导出时随样式内嵌。

## 自动化结果

`tests/paper-textures.test.ts` 6 项 PASS：每种有纹理的风格各有一张按其纸色生成的图块；重新生成与提交的图块逐字节一致；体积预算；平铺接缝处像素差不超过相邻像素差；只有细颗粒、32 px 以上尺度无斑块（防“脏”）；按最暗 5% 分位计算的正文对比度仍达标。

## 收尾：纹理性能（2026-11-11）

离屏 WKWebView 测量（方法与完整数据见 T55 证据）：1.95 MiB 富内容样例在同一字体（黑体）下，书页（有纹理、衬边、阴影）与素白（无纹理）每次滚动的布局耗时为 88 与 89 ms，1.95 MiB 纯文本为 1 ms 以内，纹理不是瓶颈。离屏窗口不触发 `requestAnimationFrame`，绘制与帧率未测，需实机确认。

## 样张

`doc/evidence/reading/M2-texture-crops.jpg`：六种纸张在编辑器中 360×360 的 1:1 局部（2× 像素）。

## PENDING

各纸张实机 1:1 观感无污渍；2 MiB 长文滚动流畅；用户逐个确认样张，未通过的风格删除或返工。
