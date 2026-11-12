# T91 测量基线与守护

状态：automatedVerified。2026-11-12，基于提交 `0f53d30`，没有改动任何运行时代码。

## 做了什么

- `scripts/perf-baseline.mjs` 增加 `t91` 与 `entry` 两组指标（方案 P0-1）。
- Rust 增加两个 `#[ignore]` 的计时测试（P0-2）：`fs::atomic_write::tests::timing_sha256_64_mib`、`text_encoding::tests::timing_decode_utf8_20_mib`。
- 记录了入口包组成（P0-3）。

## 测量办法

```sh
npm run build
node scripts/perf-baseline.mjs doc/evidence/T91-baseline-before.json
cargo test --release --lib --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture timing_
```

脚本在 Node 22.23.2（V8）里运行，取 5 次中位数；Rust 计时用 release 构建，取 5 次中位数。两者都只用于同口径的改前改后对比，不代表 WKWebView 或应用里的实际耗时。测量时没有控制机器负载。

## 改前数值

完整输出在 [T91-baseline-before.json](T91-baseline-before.json)。

| 指标 | 改前 | 对应改进项 |
| --- | ---: | --- |
| 1 MiB + 20 张图：`rewriteImageUrls` | 375 ms | P1-3、P1-4 |
| 1 MiB + 20 张图：`imageUrlsIn` | 350 ms | P1-1、P1-2、P1-4 |
| 1 MiB：`findInText('的')` | 1 ms，13,618 处 | P3-1、P3-4 |
| 2000 个含 `$` 的段落：首次序列化 | 193 ms | P1-6 |
| 2000 个含 `$` 的段落：之后各次序列化 | 140 ms | P1-6 |
| 2000 处非规范公式：`analyzeMarkdown` | 559 ms | P1-7 |
| 入口包 `index-*.js` | 3,122,055 字节 | P7-1 至 P7-7 |
| 分析 worker 主包 | 779,682 字节 | P7-5 |
| SHA-256，64 MiB（Rust release） | 118 ms | P9-1 |
| UTF-8 `decode`，20 MiB（Rust release） | 18 ms | P9-3 |
| `src/` 的 ts、tsx、css | 10,076 行，636,804 字节 | T102 |
| `src-tauri/src` 的 rs | 6,830 行，396,113 字节 | T103 |

## 入口包组成

| 内容 | 大小 | 来源 |
| --- | ---: | --- |
| 纸张纹理 PNG 的 base64 | 1,432,588 字节 | 本次对入口包直接统计 |
| 字体的 base64（woff2） | 34,020 字节 | 本次对入口包直接统计 |
| Fontsource CSS 原文（493 个 `@font-face`） | 约 507 kB | 审查时带 source map 的构建按模块归属统计 |
| `@codemirror/*` 与 `@lezer/*` | 约 316 kB | 同上 |
| `prosemirror-*` | 约 188 kB | 同上 |
| `react-dom` | 约 182 kB | 同上 |
| micromark、mdast、character-entities | 约 170 kB | 同上 |
| 应用代码及其他 | 约 280 kB | 同上 |

## 对方案估计的两处修正

- **查找的扫描本身很快。** 1 MiB 文本里找单个字符只要 1 ms。P3-1 的防抖对“扫描”的收益很小，查找卡顿的成本在装饰重建（P3-2）和循环步进（P3-3）上，T94 按此判断各项门槛。
- **SHA-256 的基线是 118 ms / 64 MiB**，约 540 MiB/s。P9-1 的门槛是降到 59 ms 以下。

## 未做

- 入口包体积守护（方案 §2.2）在 T98 加入：现在加入会让当前构建失败。
- 主线程解析计数、渲染计数、菜单重建的测试随 T92、T95、T99 各自加入。

## 检查

`npm run build` PASS；两个 Rust 计时测试 PASS。本任务没有改运行时代码，未重跑 `npm run test`。
