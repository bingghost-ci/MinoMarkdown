# T69 体积与性能

日期：2026-11-11。层级：性能部分 automatedVerified（离屏 WKWebView），实机 PENDING；应用体积为发布构建实测。

## 结论

- T55 记录的“随包书宋使富内容长文每次滚动布局 0.45–0.64 s”**不是字体问题**。在不被系统降级的测量进程里，书宋、思源黑体、霞鹜文楷、系统字体的每步滚动耗时相同（259–261 ms），且这段时间里没有布局（滚动后读取 `offsetHeight` 为 0 ms）。
- 真实原因是**渲染层数量**：WebKit 为每个 `position` 不是 `static` 的元素建立渲染层，页面内部的滚动容器每滚动一步都要遍历文档里的全部渲染层重算合成。样例文档有 39,745 个定位元素，其中绝大多数只是 ProseMirror 与 Crepe 默认样式顺带加的 `position: relative`（表格单元格、列表项、分隔线）和每个表格常驻的 6 个隐藏把手。
- 修复是 `src/styles.css` 中的 4 条规则，让这些元素只在需要时定位或渲染。1.95 MiB 混合样例每步滚动从 **约 260 ms 降到约 20 ms**，命中测试从 56 ms 降到 9 ms，版面几何与截图逐字节不变。
- T55 的字体差异没有复现。仓库里的离屏测量程序在页面就绪后约 35 秒被系统降到后台优先级并释放缓存，之后的耗时主要是调度和整页重排，系统字体与书宋同样慢（中位 380–470 ms，停顿数秒到二十秒）。T55 当时四次运行为什么按字体分开没有查明，详见“T55 数字的来源”。

## 测量方法

环境：macOS 27.0.1（26A434），Apple M4 Max，系统 WebKit 22625.1.29。测量期间本机另有高负载任务（负载均值 26–52），所有数字只在同一批次内比较。

- 页面：Vite 开发页面 `?ui-preview=editor&ui-theme=<风格>&ui-sample=large`，窗口 1280×860。`large` 为 1.95 MiB 混合样例：1,104 份章节，各含一个代码块、表格、图片、两个列表、引用和分隔线；`.ProseMirror` 下 185,474 个元素。T55 写的“约 400 份”有误，实际为 1,104 份。`large-prose` 为 1.95 MiB 纯标题与段落。
- 修复前的数字来自工作区在修复前的一份快照（另起的 Vite，端口 1431），避免其他改动触发热更新打断测量；修复后的数字来自当前工作区（端口 1430）。
- 测量程序：`scripts/style-samples.swift` 的一份临时副本，只多了两处设置（未提交，脚本不在本任务允许修改的范围内）：
  - `ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical, .idleSystemSleepDisabled], …)`
  - `WKPreferences` 的 `pageVisibilityBasedProcessSuppressionEnabled = false`、`hiddenPageDOMTimerThrottlingEnabled = false`（用 `setValue(_:forKey:)` 设置）

  有这两处设置时，WebContent 进程全程保持优先级 47；仓库里的原版程序在约 35 秒后降到优先级 4（见下文）。
- 每步滚动：`scroller.scrollTop += 60`、`pm.offsetHeight`、`document.elementFromPoint(640, 400)` 三步分别计时，共 40 步，步与步之间用 `MessageChannel` 让出主线程（不用定时器）。表中“滚动”是第一步的耗时，“布局”是第二步，“命中”是第三步。
- 只改样式：改 `.ProseMirror` 上的 `--text` 后读取末尾元素的计算颜色和 `offsetHeight`，5 次取中位数。
- 整页重排：把 `.ProseMirror` 的 `padding-right` 改 1 px 后读取 `offsetHeight`，3 次，记中位数与最大值。
- 定位原因：对 WebContent 进程运行 `sample <pid> 75 5`，同时页面连续滚动 20 秒。
- 离屏窗口不触发 `requestAnimationFrame`，也不推进 CSS 过渡，因此**不能测帧率和绘制耗时**，以下均为主线程上的同步耗时。

## 修复前后（1.95 MiB 混合样例，中位 / P95 / 最大，单位 ms）

| 风格（中文字体） | 修复前 滚动 | 修复后 滚动 | 修复前 命中 | 修复后 命中 | 布局 |
| --- | --- | --- | --- | --- | --- |
| 书页（思源宋体，101 个分片/字重） | 259 / 261 / 262 | **19 / 21 / 21** | 56 | 9 | 0 |
| 素白（系统苹方） | 261 / 270 / 272 | **20 / 21 / 28** | 56 | 9 | 0 |
| 书页改霞鹜文楷（单文件字体） | 259 / 263 / 267 | **20 / 22 / 22** | 55 | 10 | 0 |
| 书页改思源黑体（101 个分片/字重） | 未测（1000 KiB 样例为 104，与其他字体相同） | **20 / 21 / 22** | — | 9 | 0 |
| 纯文本 1.95 MiB，书页 / 素白 | 0 / 1 / 1 | 0 / 0 / 0 | 0 | 0 | 0 |

定位元素数量（按计算样式统计）：修复前 39,745，其中约 36,400 个有渲染层；修复后 14,353，其中约 4,400 个有渲染层（引用与图片块），其余约 9,900 个是 `display: none` 的表格把手、拖动预览与按钮组，没有渲染层。

没有随修复变化的项目（修复前 → 修复后，书页）：

| 项目 | 修复前 | 修复后 |
| --- | --- | --- |
| 首屏（导航到文档出现） | 26.5 s | 25.9 s |
| 只改样式 | 682 ms | 555 ms |
| 整页重排（中位 / 最大） | 385 / 1473 ms | 347 / 1410 ms |

## 原因

`sample` 的调用栈（连续滚动 20 秒，`setScrollTop` 共 499 个采样）：

```
Element::setScrollTop                                               499
  RenderLayerScrollableArea::scrollToOffset → … → ScrollableArea::scrollPositionChanged
    RenderLayerScrollableArea::updateCompositingLayersAfterScroll   477
      RenderLayerCompositor::computeCompositingRequirements         302
      RenderLayerCompositor::updateBackingAndHierarchy              175
```

同一次运行中 `offsetHeight` 平均 0.0 ms，`elementFromPoint` 平均 58.5 ms。也就是说滚动不触发布局，时间花在滚动后的合成层更新上，它与命中测试都要遍历滚动容器内的全部渲染层。

每个章节修复前有 36 个定位元素，其中 33 个有渲染层（另外 3 个是 `display: none` 的拖动预览和按钮组）：

| 来源 | 每章数量 | 规则出处 |
| --- | --- | --- |
| 表格单元格 `th`、`td` | 16 | `@milkdown/prose/lib/style/tables.css`：`position: relative`，供选中遮罩和列宽把手定位 |
| 表格把手（行、列把手各 1，行、列线把手各 1，加号按钮 2） | 6 | Crepe `table.css`：`position: absolute`，平时 `opacity: 0` |
| 列表项 `li` | 5 | `@milkdown/prose/lib/style/prosemirror.css`：`position: relative` |
| 图片块（外框、操作按钮、缩放把手） | 3 | Crepe `image-block.css` |
| 引用、分隔线、代码块 | 各 1 | Crepe `reset.css`、`code-mirror.css` |

### 对照实验（1000 KiB 混合样例，540 章，19,441 个定位元素，书页风格；每项只改一处）

| 假设 | 改动 | 滚动 中位/P95/最大 | 命中 | 只改样式 | 整页重排 |
| --- | --- | --- | --- | --- | --- |
| 基线 | 无 | 103 / 108 / 110 | 28 | 339 | 184 |
| (a) `unicode-range` 分片数量 | 系统字体（0 个分片） | 103 / 110 / 112 | 27 | 323 | 176 |
| (a) | 霞鹜文楷（单文件） | 105 / 110 / 111 | 28 | 347 | 184 |
| (a) | 思源黑体（同样 101 个分片） | 104 / 109 / 110 | 27 | 347 | 196 |
| (c) 标点挤压与中西文间距 | `text-autospace: no-autospace; text-spacing-trim: space-all` | 103 / 107 / 107 | 27 | 322 | 165 |
| (c) 对齐与断词 | `text-justify: auto; hyphens: none` | 105 / 110 / 116 | 27 | 338 | 734 |
| (d) | `font-synthesis: none` | 102 / 104 / 105 | 27 | 319 | 193 |
| (f) 表格 | `table { width: auto }`，去掉数字列对齐 | 103 / 107 / 107 | 27 | 340 | 128 |
| (g) 纸张纹理与阴影 | 去掉背景图、阴影、边框 | 104 / 107 / 109 | 27 | 329 | 180 |
| 渲染层 | 单元格 `position: static` | 51 / 53 / 54 | 14 | 365 | 210 |
| 渲染层 | 表格与图片把手 `display: none` | 65 / 67 / 67 | 21 | 245 | 173 |
| 渲染层 | 全部定位元素改为 `static`，把手隐藏（仅诊断，会破坏功能） | **3 / 4 / 4** | 1 | 241 | 175 |
| `content-visibility: auto` | 加在所有顶层块上 | 27 / 28 / 29 | 8 | 323 | 22 |
| `content-visibility: auto` | 只加在表格、代码、图片、列表、引用上 | 15 / 17 / 24 | 5 | 313 | 52 |

说明：

- (a)(c)(d)(f)(g) 都不改变滚动耗时。(b) 代码字体回退没有单独的实验：系统字体与三种随包字体下滚动耗时相同，且滚动时没有布局，文字测量不在这条路径上。
- (e) CodeMirror：Crepe 的代码块是懒加载的，离开视口的代码块只是一个 `<pre>` 占位。测量时文档里只有 1–3 个 CodeMirror 实例，其余 1,100 个是占位，CodeMirror 不是原因。
- `content-visibility: auto` 也有效，但未被渲染过的块按估计高度占位，文档总高度随之改变（814,339 px 变为 858,215 或 958,742 px），大纲跳转、查找定位和滚动位置恢复会受影响；减少渲染层的效果更好且不改变版面，所以没有采用。
- `text-justify: auto; hyphens: none` 那一行的整页重排变慢是它让全部文字重新断行造成的，与本问题无关。

候选修复的逐项效果（同一样例）：

| 规则 | 滚动 | 命中 |
| --- | --- | --- |
| 只让单元格不定位 | 51 | 14 |
| 只让列表项、分隔线不定位 | 88 | 23 |
| 只隐藏表格把手 | 67 | 22 |
| 以上三项 | 12 | 5 |
| 再加图片把手不渲染 | 9 | 4 |
| 再加图片外框、未打开的代码块不定位 | 4 | 2 |

## 修复

`src/styles.css`，紧跟代码块规则之后的 4 条规则（没有改动其他文件）：

```css
.editor-root .milkdown .ProseMirror :is(th, td):not(.selectedCell):not(:has(.column-resize-handle)) { position: static; }
.editor-root .milkdown .ProseMirror :is(li, hr):not(.ProseMirror-selectednode) { position: static; }
.editor-root .milkdown .ProseMirror .milkdown-table-block:not(:hover):not(:has([data-show="true"])) .handle { display: none; }
.editor-root .milkdown .ProseMirror .milkdown-code-block:has(> .milkdown-code-block-placeholder) { position: static; }
```

- 单元格在被选中（`.selectedCell::after` 遮罩）或出现列宽把手时仍是 `relative`。
- 列表项、分隔线在被整体选中时仍是 `relative`（分隔线的选中样式用绝对定位的 `::before`）。
- 表格把手在指针位于该表格上、或任一把手、按钮组、拖动预览处于 `data-show="true"` 时照常渲染；Crepe 在显示线把手前要先量它的尺寸，这个条件保证量的时候把手已经渲染。
- 代码块在 CodeMirror 挂载后（占位被移除）恢复 `relative`，语言选择器等绝对定位的工具不受影响。
- 不支持 `:has()` 的 WebKit（macOS 12.3 之前）会忽略整条规则，行为与修复前相同。
- 字体注册、`@font-face`、`facesForText` 的分片挑选和导出内嵌字体都没有改动；没有移除任何字体。

### 行为核对（离屏页面，自动）

| 检查 | 结果 |
| --- | --- |
| 有规则与去掉规则后全部元素的 `getBoundingClientRect`（3 KB 样例 122 个元素；400 KiB 样例 25,922 个元素，宣纸风格、网格表格） | 0 个不同 |
| 6 个坐标的 `elementFromPoint` | 相同 |
| 书页、夜间风格的截图（表格居中） | 有规则与无规则逐字节相同 |
| 单元格加 `.selectedCell` | `relative`，`::after` 为绝对定位并盖满单元格 |
| 单元格内出现 `.column-resize-handle` | `relative`，把手与单元格等高；移除后回到 `static` |
| `li`、`hr` 加 `.ProseMirror-selectednode` | `relative`，`hr::before` 为绝对定位 |
| 把某个把手设为 `data-show="true"` | 该表格的行、列把手与线把手都恢复渲染且有尺寸；改回后不再渲染 |
| `npm run typecheck` | PASS |
| `npx vitest run tests/reading-fonts.test.ts tests/reading-styles.test.ts tests/export-style.test.ts tests/reading-mode.test.ts` | 4 个文件 48 项 PASS |

与修复前的一处可见差异：表格的线把手原来在指针离开表格后用 0.2 秒淡出，现在指针离开且把手收起时直接消失。淡入不变。

## T55 数字的来源

用仓库里的原版测量程序（不加上面两处设置）和带定时器等待的脚本重复 T55 的做法，当前代码，未加修复，1.95 MiB 混合样例：

| 运行 | 每步“滚动 + 布局 + 命中” 中位 / P95 | 什么都不改，只读布局并做命中测试 中位 / 最大 | 只改样式 中位 / 最大 | 改 `padding-bottom` 后读布局 |
| --- | --- | --- | --- | --- |
| 书页（书宋），第 1 次 | 418 / 3,992 ms | 312 / 3,403 ms | 661 / 671 ms | 41 ms |
| 书页（书宋），第 2 次 | 383 / 3,622 ms | 424 / 16,171 ms | 696 / 4,919 ms | 42 ms |
| 素白（系统字体） | 465 / 3,285 ms | 2,850 / 20,918 ms | 1,938 / 4,625 ms | 116 ms |

- 三次运行里 WebContent 进程的优先级都在启动后约 35 秒（文档就绪后）从 47 降到 4。书页第 2 次运行降级后的 5 分钟只得到约 12 秒 CPU 时间；素白那次在 4 与 47 之间来回。
- 降级后的调用栈：定时器回调里 `offsetHeight` → `Document::updateLayout` → 整页布局，含 `computeIntrinsicLogicalWidths` 与 CoreText 整形（`CTFontShapeGlyphs`、`OTL::GDEF`）；另有 `MemoryPressureHandler::releaseMemory` → `WebCore::releaseMemory`。也就是说，不可见页面的进程被系统抑制并释放缓存后，读取布局会触发整页重排，这在不被降级的进程里不出现（滚动后 `offsetHeight` 为 0 ms）。
- 这种方法下系统字体与书宋同样慢，停顿同样达到数秒到二十秒，数字随本机负载和降级时机变化。**T55 表中“书宋 449–640 ms、系统字体约 90 ms”的对应关系没有复现**，在两种测量方法下都没有。T55 的 90 ms 与这里合成层遍历的耗时相近（细分计时的运行中，前十几步为 73–91 ms，之后稳定在约 260 ms）。

能确定的是：不被降级的进程里四种字体没有差别，滚动路径上没有布局；T55 的方法测到的主要是进程被抑制后的调度与重排。T55 当时四次运行为什么恰好按字体分开，没有查明。

## 仍然慢的地方（未在本任务修复）

- 1.95 MiB 混合文档首屏约 26 s、只改样式约 0.55 s、整页重排 0.35 s（偶发 1.4 s）、WebContent 内存 2–3 GiB。这些随文档节点数（18.5 万）增长，与字体和本次修复无关。后续：T77 让以阅读模式打开的大文档先进入快速阅读（离屏测量开头约 1.0 s、整篇约 4.5 s），并修复了分析 worker 从未启动的缺陷；进入编辑的耗时（约 26 s）未变。见 `doc/evidence/T77-large-documents.md`。
- 修复后每步滚动仍有约 20 ms、命中 9 ms，来自图片块（每个 3 个渲染层）、引用和已挂载的代码块。实验表明让图片把手在指针不在图片上时不渲染、图片外框不定位，可再降到约 10 ms，但图片操作按钮和缩放把手的 0.2 秒淡入淡出会消失，因此没有采用。
- 整页重排的调用栈里，行内 `inline-block` 的 `code` 元素计算最小内容宽度占比较大（Crepe 把 `code` 设为 `inline-block`），未进一步处理。
- 被系统抑制的不可见窗口在释放缓存后读取布局会整页重排；这是在离屏测量进程里观察到的，应用窗口被遮挡或最小化后是否同样如此没有验证，没有处理。

## 应用体积

`npm run tauri -- build --bundles app`（2026-11-11，release，arm64，未签名）：`Mino.app` **60.94 MiB**，T55 收尾时为 36.82 MiB，增加 **24.12 MiB**，在 80 MiB 预算内（余 19.06 MiB）。前端资源嵌在主可执行文件里（`Contents/MacOS/mino-markdown` 60.84 MiB），所以下表的分项按构建产物 `dist/` 中的文件统计，不是从应用包内逐项量出的。

| 项目 | 大小 | 相对上一版的增量 |
| --- | --- | --- |
| `Mino.app` 总计 | 60.94 MiB | +24.12 MiB |
| 随包字体（`dist/` 中全部 woff2） | 42.64 MiB | 约 +22.2 MiB（上一版 20.4 MiB） |
| 其中新增中文字体 | 思源黑体 4.65、朱雀仿宋 4.58、寒蝉活宋 11.99 MiB | +21.22 MiB |
| 其中新增西文字体 | Source Serif 4、Literata、EB Garamond、Inter、JetBrains Mono 合计 1.01 MiB | +1.01 MiB |
| 纹理 | 12 个分层 PNG 共 1.02 MiB（内联进脚本，`dist/` 中没有单独的 PNG） | 未与旧 6 张纹理单独对比 |
| AI 相关依赖及其余代码 | 未单独测量 | 总增量减去字体后约 1.9 MiB，包含纹理、`ureq`、`native-tls`（使用系统 TLS，不带 OpenSSL）、`security-framework` 和新界面代码 |

`dist/` 合计 54.25 MiB，其中脚本 10.18 MiB。`vite.config.ts` 的字体预算为 48 MiB，实际 42.42 MiB（按源文件计）。

## PENDING（实机）

- 实机 PENDING：在可见窗口中滚动 1.95 MiB 混合样例与真实长文，确认滚动跟手、无白块；离屏测量没有帧率和绘制耗时。
- 实机 PENDING：发布构建下的同一测量（以上均为未压缩的开发构建）。
- 实机 PENDING：表格操作在编辑模式下照常工作：指针移入表格出现行、列把手和线把手，拖动行列、点加号插入行列、拖动列宽、拖选多个单元格显示选中遮罩；指针离开后把手消失。
- 实机 PENDING：整体选中列表项、分隔线时的选中样式；代码块进入视口后语言选择器位置正确。
- 实机 PENDING：窗口被遮挡或最小化一段时间后回到前台，长文的第一次滚动是否有明显停顿。
- 实机 PENDING：macOS 12.0–12.2（不支持 `:has()`）上规则被忽略、行为与修复前相同，未在该系统上运行。
