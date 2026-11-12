# T90 代码字体

日期：2026-11-12。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 设置 `codeFont`（默认 `auto` = JetBrains Mono），前端与 `settings.rs` 用同一条规则校验。
- 字体面板新增“代码”页签，“本机”页签可把任意已装字体用于代码。打开代码文件时面板默认停在“代码”。
- 六款登记字体：

| 字体 | 来源 | 特点 |
| --- | --- | --- |
| JetBrains Mono（默认） | 随包 | 字形偏高，长时间看代码不累 |
| Fira Code | 随包（新增） | 带连字，`=>`、`!=`、`>=` 连成一个符号 |
| Source Code Pro | 随包（新增） | 字形端正，间距宽松 |
| SF Mono | 系统 | 与 Xcode、终端一致 |
| Menlo | 系统 | 经典的 macOS 代码字体 |
| Monaco | 系统 | 小字号下很清楚 |

- 作用范围：Markdown 的代码块与行内代码、代码与配置文件的阅读页、源码编辑器（原来写死为系统等宽字体）、导出的 HTML 与打印页。纯文本（TXT）仍用正文字体。
- 新增依赖 `@fontsource-variable/fira-code` 5.3.0、`@fontsource-variable/source-code-pro` 5.3.1（OFL-1.1），只打包 latin 与 latin-ext 分片，约 172 KB；已写入两份 npm 许可清单。

## 自动化验证

- Vitest `tests/reading-fonts.test.ts`：随包字体由 10 族变为 12 族且文件都在磁盘上；新增 `T90 code fonts` 3 项——六款字体的 ID、类别与 ID 字符规则；`codeFontStack` 对 `auto`、登记字体、`sys:` 字体、未知取值和不安全名字的结果；`--code-font` 随 `codeFont` 变化。
- Rust `settings.rs` 测试：`codeFont` 默认 `auto`，接受登记 ID 与 `sys:` 名字，拒绝带引号、空名和不合规的取值。
- 离屏 WebKit（开发预览打开 `settings.yaml`）：把 `codeFont` 设为 `fira-code`、`source-code-pro`、`menlo` 时，代码行的首选字体分别是 `Mino Fira Code`、`Mino Source Code Pro`、`Menlo`，且字体已加载。

## 检查

`npm run typecheck` PASS；`npm run test` 502 项 PASS、1 项跳过；`cargo test --lib` 130 项 PASS、2 项忽略；`./build.sh` 结果见进度表。

## 未验证

字体面板“代码”页签的实际点击、切换时编辑器不重建、重启后保留、导出页里的字体，以及 SF Mono 在没有装 Xcode 的机器上是否可用（不可用时回退到系统等宽字体）。

## 2026-11-12 换字体卡顿

用户反馈“换字体的时候明显感觉程序非常的卡”。在离屏 WebKit 里逐项测量（开发服务器，本机 332 个字体族）：

| 操作 | 修改前 | 修改后 |
| --- | --- | --- |
| 打开字体面板的“中文”页签时被加载的整包字体 | 霞鹜文楷、朱雀仿宋、寒蝉活宋（共约 24 MiB，各阻塞主线程 114–192 ms） | 无 |
| 打开“本机”页签 | 630 ms | 29 ms |
| 已加载字体之间切换（300 行以内的文档） | 5–20 ms | 不变 |

原因：每个字体按钮都用自己的字体画名字。三款中文字体是单个 5–12 MiB 的文件，为了画四个字就要整包解码；“本机”页签一次用几百种字体排版。改为：分片加载的字体仍直接预览；整包字体（`FontOption.heavy`）和本机字体的按钮先用界面字体，指针停留 220 ms 后才换成自己的字体，已选中的那一个照常预览。

没有消除的：第一次真正切换到这三款整包字体之一时，仍有一次约 0.1–0.2 秒的加载（每次启动每款一次）。

这是按测量推断的原因，没有在打包后的应用里复现和确认；修改后的体感实机 PENDING。Vitest 新增 1 项，校验 `heavy` 标记与“没有按字符范围分片”一致。

