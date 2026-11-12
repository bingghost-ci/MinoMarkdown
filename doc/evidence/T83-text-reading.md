# T83 TXT 阅读

日期：2026-11-12。层级：codeComplete，automatedVerified（渲染逻辑有测试；界面有离屏 WebKit 样张）；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 文本文档的 `mode` 固定为 `source-protected`，`kind` 为 `text`，不做 Markdown 分析，永不进入可视化编辑器。
- `src/features/text/textDocument.ts` 把文本转成阅读页：所有字符转义；输出只有 `div`、`section`、`p`、`br`、`h1`、`h2`。在 `analysis.worker.ts` 里执行。
- 分段：手工折行的文本（多数行不超过 100 字符、由空行分块、多行块占一半以上）按空行分段，段内换行保留为 `br`；其他文本每行一段，行首有缩进的段落固定首行缩进 2em，其余跟随“首行缩进”设置。段内空格按原样保留。
- 章节：“第…章 / 回 / 节 / 幕 / 话”为二级标题，“第…卷 / 部 / 篇 / 集 / 册”与 Part / Book / Volume 为一级标题，另有序章、楔子、后记、尾声、Chapter N、Prologue 等；整行不超过 40 字符且不以句读结尾。大纲取自预览里的标题，源码编辑状态下用 `textOutline` 按偏移生成。
- 20 万字符以上：先显示开头约 4.8 万字符，再换成全文；全文每 80 段一个 `section`，用 `content-visibility: auto` 让屏幕外的部分不参与排版（打印时关闭）。
- 阅读位置：`src-tauri/src/positions.rs` 把位置存到应用数据目录的 `reading-positions.json`，键是路径的 SHA-256（文件里没有路径明文），最多 500 条。位置是“第一个可见段落的序号 / 段落总数”，所以换字号、换宽度后仍准确。Markdown 不记录（维持本次运行内记住）。

## 自动化验证

- Vitest `tests/text-document.test.ts`（11 项）：章节识别的正反例；Markdown 与 HTML 字符按字面输出；含 `<script>`、`<img onerror>`、`javascript:` 的输入只产生白名单标签；小说每行一段并记住缩进；手工折行文本的分段；CRLF、CR、BOM 结果相同；分节；开头截断点落在换行处；大纲偏移（LF 与 CRLF）；位置的序号与比例互换、二分查找。
- Rust `positions::tests`（4 项）：新位置替换旧位置、上限 500 条、越界位置被拒绝且不返回、记录里没有路径、未知令牌不可用。

## 离屏 WebKit 样张与测量

用 `scripts/style-samples.swift` 在离屏 WKWebView 里打开开发预览（`?ui-preview=editor&ui-file=novel-utf8.txt`，开发构建专用，读的是 `tests/fixtures/formats` 的样例，不经过 Rust）。

- `doc/evidence/formats/txt-reading.png`：书页与淡黑两种风格。页面里读到的结果：1 个一级标题、4 个二级标题、8 段正文；大纲 5 项；页面内只有 `H1`、`H2`、`P` 三种元素；带缩进的段落 `text-indent` 为 32px；状态栏“纯文本 · UTF-8”。
- 生成的长文本（开发服务器、离屏、含应用启动时间，单次测量，仅作量级参考）：

| 字符数 | 开头出现 | 全文出现 | 段落 | 分节 | 滚到中部 | web 进程常驻内存 |
| --- | --- | --- | --- | --- | --- | --- |
| 30 万 | 1340 ms | 1403 ms | 4,772 | 62 | 1 ms | 381 MiB |
| 200 万 | 1374 ms | 1436 ms | 31,429 | 403 | 1 ms | 830 MiB |
| 600 万 | 1849 ms | 2355 ms | 93,312 | 1,196 | 3 ms | 1,786 MiB |

内存偏高：600 万字符（UTF-8 约 17 MiB）时 web 进程接近 1.8 GiB。这是开发构建的数字，发布构建没有测；它说明 20 MiB 上限附近的 TXT 很吃内存，需要在实机上确认是否可接受。

## 未验证

真实小说的排版观感；从 Finder 打开大文件的体感；退出重开后回到原位（位置存取只有 Rust 单元测试，整条链路没有跑过）；`content-visibility` 在较旧的 macOS WebKit 上不生效时的性能。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。
