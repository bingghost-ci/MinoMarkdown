# T27 轻量指标准备

状态：代码准备完成，原生测量 PENDING。`scripts/generate-scale-fixtures.mjs` 能生成固定的 100 KiB、1 MiB/1 万行、5 MiB 文档，1 万条目录和 20 张合成图片，并对锁定 manifest 校验。不得以更小样本替代。

2026-11-07 实际运行 `node scripts/generate-scale-fixtures.mjs dist-package/performance-fixtures`：PASS，生成 10,023 个文件、共 24,511,362 字节；manifest SHA-256 `4db0dd87dc7d3936a4f0efc44ec4a7b1c8fa4d4d021a3ac8d0490a891ad53c34`，与锁定期望一致。样本保留在 `dist-package/performance-fixtures/`，集中测试可直接使用。此结果只验证生成器和固定输入，不是运行时性能结果。

当前可静态测量的 arm64 产物（加入正式图标后重新构建）：`.app` 13,696 KiB，压缩包 6,156 KiB；均低于技术设计中的建议体积值。这只是包体积，不代表运行时轻量目标通过。

F04 图片修复后的当前构建：`.app` 13,700 KiB、ZIP 6,156 KiB；运行时指标仍未测。

待集中实测：同一构建 20 次启动时间、启动后 60 秒的应用及专属 WebView 总常驻内存、100 KiB 输入事务 p95、1 MiB 打开 p95、1 万条目首屏、20 图 HTML 准备与内存峰值。T06 尚未冻结实测口径和数值；原生测试后记录 p50/p95、系统缓存条件、测量工具与版本，再决定优化点。G27 不标为 nativeVerified。

2026-11-07 G27 开发准备复核：固定样本 manifest SHA-256 `4db0dd87dc7d3936a4f0efc44ec4a7b1c8fa4d4d021a3ac8d0490a891ad53c34` 与锁定值一致。当前 arm64 构建 `.app` 为 13,760 KiB，ZIP 为 6,156 KiB；主程序/ZIP SHA-256 见 [T28 最后一段](T28-package.md)。这些只是可复现样本与包体积，启动、内存和输入指标仍 PENDING。

## 同构建测量记录入口

新增 `scripts/performance-session.mjs`。初始化时校验当前 arm64 主程序 SHA-256、F10 锁定 manifest 和 10,023 个样本文件的字节/hash；记录与报告时拒绝应用或 manifest 改版。每条数据必须写入测量方法，报告按最近秩计算 p50/p95，样本数不足显示 PENDING；脚本不自动判定性能门槛。

```sh
mkdir -p /tmp/mino-performance
node scripts/performance-session.mjs init /tmp/mino-performance/M4-0.1.0.json 'M4 macOS 本机'
node scripts/performance-session.mjs record /tmp/mino-performance/M4-0.1.0.json startup-ms 1800 '屏录逐帧，打开至可输入' '第 1 次；注明缓存条件'
node scripts/performance-session.mjs report /tmp/mino-performance/M4-0.1.0.json
```

可记录的指标为 `startup-ms`、`idle-rss-mib`、`input-ms`、`open-1mib-ms`、`directory-first-screen-ms`、`html-20-images-ms`、`html-peak-rss-mib`。启动、输入和打开至少各 20 个独立样本；其余至少 1 个，实际报告需注明 WebView 进程范围、计时起止点、系统缓存和是否严格冷启动。上例数字只是命令格式示意，不是测量结果；实际会话应存于测试者专用目录，禁止把示例值写入正式报告。

脚本自身的本地 CLI 检查：在 `/tmp/mino-perf-session.X1E0Fo/` 对当前包执行 `init` 和空白 `report` PASS，所有指标均为 PENDING；另用明确标记为 synthetic 的单条 `record` 验证写入路径，该临时数据不进入项目性能证据。当前仍没有真实运行指标，G27 维持 `codeComplete`。

2026-11-07 G28 最低系统版本声明调整后重新构建：当前 `.app` 13,736 KiB、ZIP 6,156 KiB，主程序 SHA-256 `74fc449abf5a7fc9019d55d50917eb29ec403308002c39f7071c8062019dc2b8`。此前临时性能会话绑定旧主程序，会被脚本拒绝继续记录；正式集中测试应对当前包重新运行 `init`。没有采集真实启动/内存/输入数据。

2026-11-07 当前编辑器生命周期修复包的静态体积复核：`du -sk` 得 `.app` 13,736 KiB、ZIP 6,156 KiB；对应主程序 SHA-256 `fe4d3dc64fdaa242261636116acc2d736f525b679781bea12302fff6d47e9458`，包的完整哈希见 [T28](T28-package.md) 最后一段。体积低于技术设计 §12 的 100 MiB/40 MiB 建议值；启动、内存、输入及多图处理仍无当前包实测值，T27 继续 `codeComplete`。

2026-11-07 大文档源码边界版本重新构建后，`.app` 13,736 KiB、ZIP 6,156 KiB，当前主程序 SHA-256 `ce4e563d3b41ca328abf0c92f1d4081418d3162547216524acbc6b9866d6f8df`。性能会话必须从此版本重新 `init`；仍没有当前版本的真实启动、内存或输入数据。

2026-11-07 构建更新后复核：`dist-package/` 中没有正式 `*session*` 性能会话文件，未发现需要保留或迁移的真实记录。当前主程序 SHA-256 `74d11f4d8c0a6a66d73d6aa753791c60308f5c0c95d943cc6451ea84d7396ca2`；集中实测前按上面的 `init` 命令新建与该包绑定的会话。此处只核对文件和包版本，不代表完成性能测量。
