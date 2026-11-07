# T02 / G02 Markdown 语法与兼容性基线

日期：2026-11-07（Asia/Bangkok）  
状态：automatedVerified；仅证明基础解析链和合成样本，尚不证明可视化编辑器或 macOS 实机行为。

## 输入与实现

- T01 为 `automatedVerified`；`package-lock.json` 固定 `unified 11.0.5`、`remark-parse 11.0.0`、`remark-stringify 11.0.0`、`remark-gfm 4.0.1`，已作为项目直接依赖声明。离线 `npm install` 无 registry 元数据而返回 `ENOTCACHED`，因此仅将已安装且已锁定的版本提升为直接依赖，并用 `npm ls --depth=0` 核对；在网络可用的普通终端可再次执行 `npm install` 校验锁文件。
- `src/core/markdown/compatibility.ts`：严格 UTF-8 解码，保留 BOM、CRLF/LF、末尾换行约定及 front matter 原文；使用 GFM AST 执行 parse → serialize → parse，并比较结构语义。原始 HTML、脚注等未支持节点，以及可识别的数学/自定义指令标记，报告源码片段并进入 `source-protected`。不以 HTML 渲染相同充当语义往返证明。
- `tests/fixtures/manifest.json`：每个静态样本记录原始字节 SHA-256、预期模式和语义检查点；所有文档是合成内容。PNG/JPEG 为本地生成，WebP 是 [libwebp 官方测试数据的 1×1 像素](https://github.com/webmproject/libwebp-test-data/blob/main/small_1x1.webp)，用于格式覆盖，无私人内容。F07、F11、F12 的 JSON 定义后续原生/安全/故障场景，现阶段不声称这些业务行为已通过。
- `tests/fixtures/F10-scale.json` 固定 F10 的数量、总字节、文档 hash 和生成 manifest hash；`scripts/generate-scale-fixtures.mjs` 固定生成 100KiB、1MiB/1 万行、5MiB 文档、1 万条目目录及 20 张 512×512 PNG，生成后自动对照该记录。大型临时样本不提交到源码目录。

## 实际检查与结果

| 检查 | 结果 |
| --- | --- |
| `npm run test` | PASS，35 项；逐份核对静态 fixture SHA-256 和模式，已支持文档的 AST 语义往返均通过 |
| front matter 故意删除/改写 | `FRONT_MATTER_CHANGE` 被检出 |
| 链接目标/代码内容故意改写 | `SEMANTIC_CHANGE` 被检出 |
| HTML/未知扩展与无效 UTF-8 | 进入源码保护；未知源片段保留，未生成可视化序列化候选 |
| BOM、CRLF、无末尾换行、空文件、混合换行 | 原始元信息/模式检查通过；混合换行保守进入源码保护 |
| `npm run typecheck`、`npm run build`、`npm ls --depth=0` | PASS |
| `node scripts/generate-scale-fixtures.mjs /private/tmp/minomarkdown-f10-20261107` | PASS，生成 10,023 个文件，总字节数 24,511,362；生成 manifest SHA-256 `4db0dd87dc7d3936a4f0efc44ec4a7b1c8fa4d4d021a3ac8d0490a891ad53c34`；首图经 `sips` 检查为 512×512 |
| `node scripts/generate-scale-fixtures.mjs /private/tmp/minomarkdown-f10-verify-20261107` | PASS，第二次生成结果与 `F10-scale.json` 锁定值一致，输出 `verified: true` |

F10 三份文档的字节数及 SHA-256：100KiB `102400 / 473b5579eceb8f6c3487c9e24b293fa892b11c66c12137a55aff4562a89ebecd`；1MiB `1048576 / 0001e9403a32e0929de0f8cb0a9bd035d7ac1c05d1df97896b947c61704fbc27`；5MiB `5242880 / dad57d9941babbf2679c802332a18f0182c1baf53fb4d99f279fe12beac1023d`。

本次输入 SHA-256：`package-lock.json` 为 `0908f3c24c242cbfae71c0f2ae50460c2c2c8c03563a1bd0636317dd8b236eb7`，静态 fixture manifest 为 `8c54c4ac1d1fc5877e9b3e56e21ff7417aba2f27566edb7287d2f4814a8c4311`，F10 生成器为 `00efc92c1f37614ce4fb1fd0d61d22da6a4661d993abd5ec03b99fa44afb2305`。

## 边界与下一项

该检查使用 remark/GFM 的 AST 语义，不等同于 Crepe 编辑器内部 ProseMirror 往返；T03 必须用实际原生编辑器检验常见样本、选区、撤销和系统中文输入。T08 应把此兼容性判断接入文件打开/保存，并增加未知方言检测；当前标记识别是保守基线，不保证识别未来所有 Markdown 扩展。F06 图片持久化、F07 草稿迁移、F10 性能、F11 权限与净化、F12 文件故障均留给相应任务实际验证。

下一项：T03 / G03。
