# T55 字体与排版

日期：2026-11-11。层级：automatedVerified，原生实测与用户验收 PENDING。

## 依赖

- `@fontsource/noto-serif-sc` 5.3.1、`@fontsource/lxgw-wenkai` 5.3.0，精确版本，均为 OFL-1.1。`doc/evidence/dependency-licenses.tsv` 增加两行，`third-party-license-file-index.tsv` 已重新生成。没有新增其他依赖。

## 实现

- **思源宋体：** 只引用 400、700 的 woff2 分片（每个字重 101 个：编号分片加 latin、latin-ext、cyrillic、vietnamese；包中整体的 chinese-simplified 文件不引用），合计 6.5 MiB。`fonts.ts` 解析 `400.css?raw`、`700.css?raw` 得到各分片的 `unicode-range`。
- **霞鹜文楷：** 5.3.0 只有 300、500、700 三个字重，没有 400，且每个字重是单个 7–9 MiB 的 woff2，没有 Unicode 分片。应用使用 500（声明为 `font-weight: 100 599`）和 700（`600 900`）。章程 v0.2 写的“各 400/700、按区段分片”对文楷不成立，已在 v0.3 更正。
- 随包字体合计 20.4 MiB，未超过 32 MiB 预算。`vite.config.ts` 的 `fontBudget` 插件在构建时统计字体，超出预算或出现 woff/ttf/otf 即构建失败。
- `@font-face` 使用 `font-display: block`，只有 woff2 源。应用 CSP 已允许 `font-src 'self'`，未修改。
- **字体预设：** 自动（跟随风格）、书宋、文楷、黑体、系统。随包字体排在系统字体前，系统字体作为回退。旧设置文件若选过非系统字体，`fontPreset` 迁移为 `system` 并保留原 `editorFont`。
- **排版参数：** 段距紧凑/标准/宽松（0.5/0.9/1.3 em）；行宽 30/36/42 字/不限（不限沿用 1040px）；左对齐/两端对齐（`text-justify: inter-character`）；首行缩进 2 字，只作用于顶层段落。新安装默认 36 字，旧设置缺字段时为“不限”。
- 中文标点挤压与中西文间距用 CSS `@supports` 检测后启用，不支持时不生效（章程原写 `CSS.supports`，效果相同）。
- 只影响显示：排版设置只改 CSS 变量，不进入 Markdown。

## 应用体积

`npm run tauri -- build --bundles app`：`Mino.app` 从 15.67 MiB（16,048 KiB，T49–T50 构建）增至 **36.41 MiB**（37,292 KiB），增量 20.74 MiB，基本为随包字体与纹理。主可执行文件为 arm64。章程原估约 45 MiB。

收尾后重新构建（2026-11-11，加入代码高亮语法包、表格样式、开发态字体读取）：`Mino.app` **36.82 MiB**（37,712 KiB），比 36.41 MiB 增加 420 KiB（约 0.41 MiB），主要是按需加载的 `@codemirror/language-data` 语法分块。主可执行文件仍为 arm64。

## 收尾：长文档性能测量（2026-11-11，离屏 WKWebView，只算自动化证据）

方法：`scripts/style-samples.swift --print --memory` 在 Vite 开发页面（127.0.0.1:1430，未压缩的开发构建）中加载 `?ui-preview=editor&ui-sample=…`，窗口 1280×860。样例由 `src/app/previewSample.ts` 生成：`large-prose` 为 1.95 MiB 纯标题与段落；`large` 为 1.95 MiB、约 400 份完整样例（每份含代码块、表格、图片、列表、引用），约 18.5 万个 DOM 节点；`large-protected` 为 2.06 MiB，超过可视化上限。

- **首屏**：`readyMs` 为导航开始到文档出现的时间。离屏页面的定时器会被节流，精度为 20 ms 到约 1 s。
- **滚动**：离屏窗口中 `requestAnimationFrame` 不触发（每秒 0 次），因此**无法测帧率**。改为测量每次滚动 60 px 后强制样式、布局与命中测试的耗时（共 300 次），不含绘制。
- **内存**：页面所属 WebContent 进程的常驻内存（RSS）。

| 样例 | 风格（字体） | 首屏 | 每步滚动 中位 / P95 / 最大 | 内存 |
| --- | --- | --- | --- | --- |
| 样例文档 3 KB | 书页（书宋） | 0.8 s | ≤1 ms | 199 MiB |
| 样例文档 3 KB | 素白（黑体） | 0.8 s | ≤1 ms | 187 MiB |
| 纯文本 1.95 MiB | 书页（书宋） | 6.7 s | ≤1 ms | 842 MiB |
| 纯文本 1.95 MiB | 素白（黑体） | 6.2 s | ≤1 ms | 880 MiB |
| 混合 1.95 MiB | 书页（书宋） | 24.5 s | 640 ms / 3.8 s / 12.5 s | 2.32 GiB |
| 混合 1.95 MiB | 素白（黑体） | 24.6 s | 89 ms / 91 ms / 94 ms | 2.55 GiB |
| 混合 1.95 MiB | 书页（改用黑体） | 25.0 s | 88 ms / 91 ms / 93 ms | 3.88 GiB |
| 混合 1.95 MiB | 素白（改用书宋） | 24.8 s | 449 ms / 2.6 s / 13.5 s | 3.11 GiB |
| 源码保护 2.06 MiB | 书页 / 素白 | 1.0 s / 0.9 s | ≤1 ms | 233 / 229 MiB |

结论：

1. 纸张纹理、衬边与阴影不是瓶颈：同为黑体时，书页与素白的滚动耗时相同（88 与 89 ms）。
2. 纯文本长文在两种字体下滚动布局都在 1 ms 以内。
3. 富内容超长文（约 400 个代码块与表格）每次滚动都会触发整页重新布局：系统字体约 90 ms；随包思源宋体（224 条 `@font-face`，滚动中没有新字体加载，22 条已加载）使布局慢约 5 倍，偶发 12–13 s 的长停顿。哪个元素在滚动时让布局失效尚未查明。这在实机上很可能表现为明显卡顿，列为未解决风险，需实机复测。
4. jsdom 中同一混合样例：Markdown 分析 19.7 s，预览渲染 6.7 s（加代码高亮后 7.0 s，增加约 4%），编辑器创建 35 s；纯文本 1.3 MiB 分析 4.1 s，编辑器创建 2.7 s。

以上为开发构建与离屏窗口的测量，不代表实机帧率与发布构建的绝对时间。

## 自动化结果

`tests/reading-fonts.test.ts` 4 项 PASS：分片与字重、32 MiB 预算、`font-display: block` 且只用 woff2、按字符挑选分片。`tests/reading-styles.test.ts` 中排版变量与字体跟随规则 PASS。`settings.rs` 中旧设置迁移测试 PASS。

## 样张

`doc/evidence/reading/M2-font-song.jpg`（书宋）、`M2-font-kai.jpg`（文楷），书页风格下中英混排。

## PENDING

断网时随包字体正常显示；长文首屏与滚动（首次出现新分片时可能短暂留白）；各预设中英混排、两端对齐与标点挤压的实机效果；首行缩进；保存后文件逐字节不变；用户验收。
