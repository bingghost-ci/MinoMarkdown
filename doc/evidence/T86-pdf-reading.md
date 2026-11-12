# T86 PDF 阅读核心

日期：2026-11-12。层级：codeComplete，automatedVerified（Rust 分段读取与 PDF 解析有测试；界面有离屏 WebKit 样张）；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 渲染库 `pdfjs-dist` 6.5.438（Apache-2.0），使用 `legacy` 构建，只在打开 PDF 时动态加载：构建产物里是独立的 `pdf-*.js`（约 508 KB）、`pdf.worker-*.js`（约 1.27 MB）和 `PdfView-*.js`，不在启动包内。
- 字节来源：命令 `read_document_range(token, offset, length)`。每次调用取 `Grant`、确认是 PDF、用 `openat` + `O_NOFOLLOW` 打开、核对文件的 inode / 长度 / 修改时间与打开时一致（否则 `CHANGED`），单次最多 8 MiB。前端通过 `PDFDataRangeTransport` 每次取 256 KiB，关闭了自动预取和流式读取。
- **与 Goal 原文的差异：** Goal 写的是“自定义协议”。实际用的是 IPC 命令：`fetch` 自定义协议需要在 CSP 的 `connect-src` 里放行，IPC 已在允许范围内。授权复查和分段读取的要求不变，CSP 一个字没改。
- 字符映射与标准字体：PDF.js 默认用 `fetch` 取，同样会被 CSP 挡住。改为提供它的 `BinaryDataFactory`，经 `read_app_asset` 读随包文件；该命令的允许路径增加 `/pdfjs/cmaps/*.bcmap` 与 `/pdfjs/standard_fonts/*.(pfb|ttf)`。`useWorkerFetch: false`。
- WebAssembly：CSP 没有 `wasm-unsafe-eval`，所以 `useWasm: false`，JBIG2 与 JPEG 2000 用库自带的 JavaScript 解码器（`/pdfjs/wasm/*_nowasm_fallback.js`，由 worker 同源动态导入）；ICC 色彩管理因此不可用，颜色按设备色空间显示。`.wasm` 文件不随包。
- 构建：`scripts/pdf-assets-plugin.mjs` 把 169 个 CMap、16 个标准字体文件和 2 个解码回退脚本连同许可文件放进 `dist/pdfjs/`（2.9 MB），开发服务器下从 `node_modules` 提供。字体预算检查跳过 `pdfjs/`。
- 安全：不启用脚本（没有脚本沙箱）、`enableXfa: false`；链接注解不生成 `<a>`，外部地址交给 `safeLinkHref` + `open_external`，内部目标跳页。
- 视图 `src/features/pdf/PdfView.tsx`：所有页先按第一页尺寸占位，渲染到某页时改成它自己的尺寸；`IntersectionObserver`（上下各 400px）决定可见页，只保留可见页及前后各一页的画布，其余释放；画布按屏幕像素比放大，单页不超过 1600 万像素；文字层用库的 `TextLayer`。缩放 25%–400%，默认适应宽度；`⌘+` / `⌘-` / `⌘0` 在 PDF 上调缩放。
- 加密文件显示密码输入框；损坏文件、读取失败显示说明。
- 上限 200 MiB；`revision` 流式计算；磁盘上的 PDF 变化后自动重新载入。PDF 永远是阅读状态，保存、另存、导出、打印、格式、切换编辑都被拒绝（Rust 返回 `READ_ONLY`）。

## 自动化验证

- Rust `a_pdf_is_read_in_checked_ranges`：正常区间、越过末尾截断、起点越界、长度为 0 或超过 8 MiB、非 PDF 令牌、未知令牌、文件被替换（`CHANGED`）、被换成符号链接（`OUT_OF_SCOPE`）。`a_pdf_over_its_own_limit_is_refused_while_text_keeps_the_smaller_one`。`app_assets` 的允许路径测试。
- Vitest `tests/pdf-engine.test.ts`（13 项，Node 下用同一个 legacy 构建）：样例 PDF 只通过 `PdfSource` 读取且每次不超过 256 KiB；3 页的尺寸；提取出英文与中文文字，中文字符映射确实经 `readAsset` 取得且路径只落在 `cmaps` / `standard_fonts`；读取失败时打开立即以该错误码结束；非 PDF 被拒绝；缩放与画布像素上限的计算。

## 离屏 WebKit 样张

`doc/evidence/formats/pdf-reading.png`（白与淡黑）。页面里读到：3 页；第一页画布 1725×2233 像素（CSS 862×1116，即 2 倍像素比），前 500 行里有 22,320 个深色像素；文字层有英文与中文文字；2 个链接热区（外部地址与内部跳转）；大纲 3 项；淡黑风格下页面已调暗。

注意两点：离屏窗口是隐藏状态，`requestAnimationFrame` 不触发，而 PDF.js 靠它绘制，所以取样时在页面里用定时器代替了它，否则画布是空白的——这是取样工具的限制，真实窗口没有这个问题，但也因此**没有在真实可见窗口里看过 PDF**。另外开发预览不经过 Rust，也没有应用的 CSP：worker 加载、解码回退脚本的动态导入、`read_app_asset` 读 CMap 这三件事在打包后的应用里是否顺利，只有实机能确认。

## 未验证

打包后的应用里打开任何 PDF（上面所说的 CSP 下的三条路径）；加密 PDF（没有样例）；JBIG2 / JPEG 2000 图片；大文件的内存与滚动；`tauri dev` 下 CMap 读取（`read_app_asset` 在开发模式读不到这些文件，中文 PDF 可能缺字）。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。

## 2026-11-12 用户首次实机反馈后的修改

用户用 `./build.sh` 的包打开了真实 PDF：第一本正常显示（说明打包后 CSP 下的 worker、文字层可用）。报告的问题与处理：

- **同时打开第二本报错** “PDFWorker.create - the worker is being destroyed”。原因：所有文档共用一个 worker 端口，一本关闭或切换标签（视图会卸载重建）时端口处于销毁中，下一本建不起来。改为每个文档一个 worker（`openPdf` 的 `createWorker`），`closePdf` 结束文档并终止它的 worker。Vitest 新增 `opens a second document while the first is open, and another after one is closed`；离屏 WebKit 里用真实 worker 连续开、关、再开四次均为 3 页并能取到第 2 页文字。
- **换风格对 PDF 没有作用**。PDF 的字体和版式是文件自带的，改不了；能跟随风格的是纸色。浅色风格把页面以 `multiply` 叠在纸色上（白变纸色，墨色不变）；夜间风格把页面反相并保持色相后以 `screen` 叠在纸色上（白变纸色，黑字变浅色）。控制条的调色板按钮可切回 PDF 原本的颜色，替代了原来的“页面调暗”。没有使用 PDF.js 自带的 `pageColors`：它依赖 WebKit 不支持的 canvas 滤镜，实测不生效。夜间风格下图片也会被反相，这是这种做法的代价。纸张纹理不作用于 PDF。样张：`doc/evidence/formats/pdf-styles.png`（羊皮卷、淡黑、豆沙绿）。
- **字体、字号设置对 PDF 没有作用**：未改，属于格式本身的限制；PDF 的大小用缩放调整。

