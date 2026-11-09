# T30 体验与性能基线

状态：自动化基线已记录；原生运行指标 PENDING。

方法：`node scripts/perf-baseline.mjs <输出.json>`，在系统临时目录生成样本，不接触用户文档。运行环境为 Node 22.23.2，不是 WebKit，数值只用于同口径前后对比。

| 指标 | 改进前 `T30-baseline-before.json` | 全部改动后 `T34-baseline-after.json` | 说明 |
| --- | ---: | ---: | --- |
| 100KiB `prepareMarkdown` | 756 ms | 493 ms | 单次测量，未控制机器负载 |
| 1MiB `prepareMarkdown` | 6598 ms | 2481 ms | 同上；解析算法本身未重写，差值不能归因于某项优化。现已移入 Worker，不阻塞界面 |
| 3MiB `prepareMarkdown` | 16911 ms | 11 ms | 不是解析变快：超过 2 MiB 后直接进入源码保护，跳过解析 |
| 1MiB `imageUrlsIn`（无图） | 1685 ms | 0 ms | 无 `![` 时快速返回；输入路径已不调用，改为遍历 ProseMirror |
| 20 图文档 `imageUrlsIn` | 5 ms | 1 ms | 单次测量 |
| 20×1MiB 转 `number[]` JSON | 1424 ms / 71 MiB | 995 ms / 71 MiB | 仅为旧方式的参考成本，新链路已不走此方式 |
| dist 总体积 | 4216 KiB | 3332 KiB | |
| dist 最大文件 | 1838 KiB | 1172 KiB | 现为按需加载的编辑器 chunk |
| KaTeX 文件 | 59 | 0 | |

## 原生测量入口

`scripts/performance-session.mjs` 已存在，在 `dist-package/performance-fixtures`（T27 生成）上工作：

```sh
./start.sh --build-only
node scripts/performance-session.mjs init /tmp/mino-performance/T34.json '机器描述'
node scripts/performance-session.mjs record /tmp/mino-performance/T34.json startup-ms <数值> '测量方法' '备注'
node scripts/performance-session.mjs report /tmp/mino-performance/T34.json
```

启动、空闲内存、输入延迟、1MiB 打开、目录首屏、20 图 HTML 导出：PENDING，未实测。F10 的 5 MiB 样本现在超过可视化上限，只能用于源码模式指标。
