# T28 第三方许可原文覆盖审查

日期：2026-11-07。范围：当前本机安装的 npm 包与 Cargo registry 源包；此记录只核对可取得的许可原文文件，不作发布合规结论。

输入清单：`dependency-licenses.tsv`（296 条，SHA-256 `e7ea0ac5d205449e0193e7d1a5eaec9c63e8991e5b76755ef09409e3e35d09bd`）、`rust-dependency-licenses.tsv`（258 条，SHA-256 `02540691eedcd8b80c41a3fded078e3f0d057826eb971470582f88d2b1f986bc`）。逐项检查对应 `node_modules/<package>` 或 `~/.cargo/registry/src/*/<crate>-<version>` 根目录中以 `LICENSE`、`LICENCE`、`COPYING`、`NOTICE` 开头的文件，文件名大小写不敏感。

| 来源 | 清单条目 | 本地根目录有许可原文 | 未找到原文 |
| --- | ---: | ---: | ---: |
| npm | 296 | 291 | 5 |
| Cargo registry | 258 | 243 | 15 |

npm 未找到原文：`@esbuild/darwin-arm64`、`@rollup/rollup-darwin-arm64`、`@tauri-apps/cli-darwin-arm64`、`remark-math`、`stackback`。

其中三个原生二进制包有本地同版本主包可追溯：`@esbuild/darwin-arm64@0.27.7` 与 `esbuild@0.27.7` 均声明 MIT，后者有 `LICENSE.md`；`@rollup/rollup-darwin-arm64@4.68.0` 与 `rollup@4.68.0` 均声明 MIT，后者有 `LICENSE.md`；`@tauri-apps/cli-darwin-arm64@2.12.4` 与 `@tauri-apps/cli@2.12.4` 均声明 `Apache-2.0 OR MIT`，后者有 `LICENSE-APACHE-2.0` 与 `LICENSE-MIT`。这仅提供后续核对的同版本上游文本线索；索引仍把三个原生包记为缺原文，未未经确认地替换其来源或减少缺口数。

Rust 未找到原文：`alloc-stdlib`、`block2`、`dispatch2`、`objc2`、`objc2-app-kit`、`objc2-core-foundation`、`objc2-core-graphics`、`objc2-encode`、`objc2-exception-helper`、`objc2-foundation`、`objc2-io-surface`、`objc2-quartz-core`、`objc2-web-kit`、`selectors`、`tauri-plugin`。

上游出处复核（2026-11-07）：[remark-math 仓库根目录的 `license`](https://github.com/remarkjs/remark-math/blob/main/license) 提供项目级文本，但此处尚未核对 `remark-math@6.0.0` 的对应提交；[objc2 仓库的许可说明](https://github.com/madsmtm/objc2/blob/main/LICENSE.md) 明确区分不同 crate 的许可，不能用一份通用文本不加核对地替代上述缺失的 crate 文件；[stackback 上游归档仓库](https://github.com/defunctzombie/node-stackback) 的当前根目录文件列表没有独立 `LICENSE`，本机安装包也没有。以上是定位线索，不改变本地原文缺失计数，也不构成对应锁定版本的最终 notices 审计。

已生成可重建的[许可文件索引](third-party-license-file-index.tsv)（SHA-256 `b95d4140c70ccd4e3877b7041dbed23aa3a3c4c530247a45d32a2421f1157f33`）和[本地原文合集](third-party-license-texts.txt)（2,862,975 字节，SHA-256 `aed5f348e0b2b73983ae6cfd124d3ea2f03f80cb73da6f87cc6f3a8bcc9bb7db`）。合集保留每个本地原文的 UTF-8 内容并以包名、版本、文件名和原文件 SHA-256 分隔；索引把缺失项标成 `missing`。`python3 scripts/generate-license-text-bundle.py --write` 生成，`--verify` 对照当前已安装源包复查，均 PASS。两份文件仅在仓库的审查资料中，尚未打入 `.app`/ZIP；缺失原文仍需发布前处理。

清单包含开发依赖，不能据此确定最终二进制实际包含哪些包；根目录未找到原文也不能证明上游没有许可文本。项目根目录当前没有 `LICENSE`/`NOTICE`，`package.json` 与 `Cargo.toml` 也未声明项目自身许可。项目授权方式属于产品所有者决策，不能由依赖的 MIT/Apache 元数据推定。对外分发前需确定项目自身授权、补齐实际随包依赖的许可原文和 notices，并核对字体/图标/样式资源；当前未签名本地测试包不标为已完成发布许可审计。
