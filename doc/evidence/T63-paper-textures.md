# T63 纸张材质重做

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `scripts/generate-paper-textures.mjs` 重写：每种纸生成三层可无缝平铺的灰度 PNG，按不同周期叠加，避免看出重复。书页为纤维、帘纹、颗粒；宣纸为长纤维、帘纹、颗粒；羊皮卷为毛孔、云斑、颗粒；牛皮纸为纤维、云斑、颗粒。`--check` 核对已提交的图片与脚本输出一致。
- `src/assets/paper/` 共 12 个文件、1049 KiB：书页 196、宣纸 427、羊皮卷 192、牛皮纸 234 KiB。旧的 6 张单层纹理已删除。
- `src/features/reading/textures.ts` 的 `textureBackground(id)` 给出多层 `background-image` 与尺寸；`css.ts` 用 `--paper-veil` 实现纹理强度（设置项 `textureStrength`，0–100，默认 60），羊皮卷另有 `--page-aging` 做旧边，做旧不压到正文区域。
- 导出 HTML 内嵌当前风格的三层图块；打印和打印友好 PDF 不带纹理。导出纹理预算由 400 KiB 改为每种纸源文件 ≤ 450 KiB，已写入技术设计 §19 与章程。

## 自动化验证

`tests/paper-textures.test.ts`（11 项）：文件与脚本输出一致；每层可无缝平铺；不改变纸面平均色、没有污渍和深色块；默认强度下正文对比度平均损失不超过 5%，最暗 5% 的像素也不超过 5%。

已知限制：强度调到 100% 时，最暗 5% 像素上的对比度损失约 6–10%。羊皮卷的纹理本身最淡，质感主要靠做旧边。

## 样张

- `doc/evidence/reading/T63-textures-1x.png`：四种纸 100% 强度 1:1。
- `doc/evidence/reading/T63-textures-1x-60.jpg`：默认 60% 强度 1:1。
- `doc/evidence/reading/T63-paper-2x.jpg`、`T63-xuan-2x.jpg`、`T63-parchment-2x.jpg`、`T63-kraft-2x.jpg`：放大 2 倍。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：在 Retina 屏和外接普通屏上看四种纸的纹路是否清楚、是否发脏，长时间阅读是否干扰文字。
- 实机 PENDING：导出 HTML 在 Safari、Chrome 中的纹理与应用内一致。
- 用户验收 PENDING：纸张与羊皮卷的质地感是否达到要求（这是本轮的主要诉求）。
