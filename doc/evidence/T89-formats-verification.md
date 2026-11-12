# T89 测试、样例与文档

日期：2026-11-12。层级：automatedVerified（本任务的计划层级）。T81–T88 的原生实机验证与用户验收均为 PENDING，见各自的证据文件。

## 样例

`tests/fixtures/formats/` 共 16 个文件，由 `scripts/generate-format-fixtures.py` 生成并登记在 `tests/fixtures/manifest.json`（`id` 以 `FMT-` 开头，`mode` 为 `asset`，现有的基线测试会校验每个文件的 SHA-256）。`--check` 比较磁盘文件与应生成的内容。`.gitattributes` 把这个目录标为 `-text`，避免 git 改动 CRLF 和非 UTF-8 字节。

| 文件 | 用途 |
| --- | --- |
| `novel-utf8.txt`、`novel-gb18030.txt`（CRLF）、`novel-utf16le-bom.txt`、`novel-utf8-bom.txt` | 同一段带卷、章、序章、尾声的小说，四种存法；含必须按字面显示的 `*`、`#`、`<b>` |
| `essay-big5.txt` | 繁体中文，Big5 |
| `wrapped-english.txt` | 手工折行的英文 |
| `config.json`、`settings.yaml`、`server.log`、`page.html` | 代码与配置；HTML 含脚本、事件属性和远程图片 |
| `table.csv`、`table.tsv` | 引号内的逗号与换行、双引号转义 |
| `sample.pdf` | 3 页两种尺寸；未嵌入的标准字体；经预定义 CMap 的中文；嵌套书签；外部与内部链接 |
| `scanned.pdf` | 2 页只有图形，没有文字层 |
| `archive-named.txt`、`not-a.pdf` | 扩展名受支持而内容不符 |

没有加密 PDF、含 JBIG2 / JPEG 2000 图片的 PDF 和大体积 PDF 的样例。

## 检查结果（2026-11-12）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test` | 46 个文件中 45 个通过、1 个跳过；498 项 PASS，1 项跳过（原有的样张生成测试）。本批新增 50 项 |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | 130 项 PASS，2 项忽略（原有）。本批新增 28 项 |
| `python3 scripts/generate-format-fixtures.py --check` | 16 个样例一致 |
| `npm run build` | PASS；随包字体 42.6 MiB / 48 MiB（PDF 的替代字体不计入，见 T86） |
| `./build.sh` | PASS（退出码 0），产出 `Mino.app` 与 `dist-package/Mino-0.1.0-macos-arm64-unsigned.zip` |

每个检查点都是第一次或修正后一次通过，没有用到“三次仍失败则记录”的规则。开发过程中出现并已修正的失败：UTF-16 与 UTF-8 的识别顺序、带地区提示时 Big5 被判成 GBK、读取失败时 PDF 打开流程不结束、若干测试里数错的预期值。

Vitest 配置新增了一条 `onUnhandledError`：Node 下 PDF.js 把 worker 代码跑在测试线程里，中途停止加载时 worker 内部会留下一个未处理的 “Worker was terminated”。只忽略消息与调用栈都匹配的这一种。

## 包体积

| 项 | 数值 |
| --- | --- |
| `Mino.app` | 63.56 MiB（预算 80 MiB；上一次记录为 60.94 MiB） |
| 主可执行文件 | 66,538,048 字节，arm64 |
| ZIP | 53.10 MiB |
| `dist/pdfjs/`（CMap、标准字体、解码回退） | 2.9 MB |
| PDF.js 主模块 / worker | 约 508 KB / 1.27 MB（按需加载） |

`Info.plist` 里有四组文档类型：Markdown（Editor）、纯文本（Editor）、代码与数据（Editor，50 个扩展名）、PDF（Viewer），全部 `Alternate`。可执行文件里能找到 `pdfjs/cmaps/UniGB-UCS2-H.bcmap`，说明字符映射已嵌入。

## 打开耗时

- 大 TXT：见 [T83](T83-text-reading.md) 的表（离屏、开发服务器、单次；600 万字符全文约 2.4 秒，含应用启动约 1.3 秒）。
- 大 PDF：**没有测**。没有大体积 PDF 样例，离屏工具里 PDF.js 的绘制又依赖被代替的 `requestAnimationFrame`，测出的数字没有意义。留给实机。

## 没有做的验证

这次构建的应用**没有被启动过**。以下全部是 PENDING：从 Finder、对话框、拖入打开各类文件；CSP 下 PDF 的 worker、解码回退脚本和 CMap 读取；编码询问；阅读位置的整条链路；菜单置灰；AI 对 TXT / PDF 的真实请求；大文件体感。

## 文档

已更新：产品方案 §3.11、技术设计 §22（含 §22.9 实现记录）、开发计划 T81–T89、Goal 列表 G81–G89、验收 §8H、进度表、`doc/README.md`、`CLAUDE.md`、根目录 `README.md`。
