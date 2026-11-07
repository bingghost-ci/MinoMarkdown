# T01 / G01 依赖与工程基线

日期：2026-11-07（Asia/Bangkok）  
状态：automatedVerified。此前的 npm 网络阻塞已由用户在普通终端安装依赖解除；原始失败记录保留在下方。

## 环境

| 工具 | 实际输出 |
| --- | --- |
| macOS | 27.0.1 |
| CPU | arm64 |
| Xcode | 27.1 (27A9275) |
| Node.js | v22.23.2 |
| npm | 10.9.8 |
| rustc / cargo | 1.99.1 |

## 当前产物

`package.json` 固定 React、Tauri JS API/CLI、Milkdown/Crepe、Vite、TypeScript 和 Vitest 的显式版本；用户在普通终端执行 `npm install --no-audit --no-fund`，安装 295 个包，生成 `package-lock.json`。已安装包的版本及许可证见 [dependency-licenses.tsv](dependency-licenses.tsv)，295 条均有许可证字段。`src-tauri/Cargo.toml` 固定 Tauri 2.12.4 和 tauri-build 2.7.3，`Cargo.lock` 已由 `cargo check --offline` 生成。`src-tauri/capabilities/main.json` 只为主窗口配置 `core:default`，暂未启用文件/网络插件。Tauri 图标是工程占位图，正式图标留给 T28。

`.nvmrc` 记录本次使用的 Node 22.23.2；`.gitignore` 排除依赖目录、Rust 产物、Tauri 生成的 schema 和前端产物。

按官方资料确定方向：[Tauri 项目创建](https://v2.tauri.app/start/create-project/)、[Milkdown Crepe 安装](https://milkdown.dev/docs/guide/using-crepe)。已安装发行包核对：Milkdown Crepe 7.22.3（MIT），Tauri JS API/CLI 2.12.4（Apache-2.0 OR MIT）；Crepe 主入口 `lib/esm/index.js`、TopBar 和 Toolbar 的导出文件均存在。`src/` 与 `index.html` 中未检出运行时 HTTP(S)/CDN 引用。

## 已执行检查

1. `cargo check --offline --manifest-path src-tauri/Cargo.toml`：首次失败，原因是 Tauri 默认寻找 `src-tauri/icons/icon.png`；补齐占位图后重跑通过。
2. `npm install --prefer-offline --fetch-retries=0 --fetch-timeout=8000 --no-audit --no-fund`：失败，`getaddrinfo ENOTFOUND registry.npmjs.org`，首先缺少 `@milkdown/crepe`。没有生成 `package-lock.json`，没有 `node_modules`。
3. `curl -I --max-time 5 https://registry.npmjs.org/@milkdown%2fcrepe` 曾收到 HTTP 200；另一轮 curl 查询出现 `Could not resolve host`。说明网络路径不稳定，不能据一次 HEAD 成功推定 npm 可安装。
4. `cargo build --offline --manifest-path src-tauri/Cargo.toml`：通过，生成 `src-tauri/target/debug/mino-markdown`；这是 Rust 可执行文件构建，不是包含已编译前端的完整桌面应用包。
5. 下一轮 `npm install --prefer-offline --fetch-retries=1 --fetch-timeout=10000 --no-audit --no-fund`：仍以相同的 `getaddrinfo ENOTFOUND registry.npmjs.org` 失败；进程已退出，未生成前端锁文件。已确认 npm registry 配置为 `https://registry.npmjs.org/`，本机 npm 缓存没有 `@milkdown/crepe`。
6. `npm install --offline --ignore-scripts --no-audit --no-fund --package-lock-only`：失败，`ENOTCACHED`，本地缓存没有 `@milkdown/crepe` 的 registry 元数据。检查常用本地 pnpm/bun 缓存和其他项目，也未发现可复用的 Crepe 安装。此轮确认网络恢复或提供可用的完整本地镜像/缓存是完成前端锁定与构建的必要输入。
7. 再次核对：当前执行环境的 `node:dns.lookup("registry.npmjs.org")` 返回 `ENOTFOUND`，但 `curl -fsSI https://registry.npmjs.org/@milkdown%2fcrepe` 返回 HTTP 200。仓库服务可响应；受限执行环境对 Node/npm 的 DNS/网络访问是优先排查点，不能仅凭此断定用户普通终端也存在 DNS 故障。
8. `sh -n scripts/check-apple-silicon.sh && sh scripts/check-apple-silicon.sh`：通过。`uname -m` 为 `arm64`，Node 运行时为 `darwin/arm64`，Node 可执行文件、Rust host (`aarch64-apple-darwin`) 与已编译的 MinoMarkdown Rust 可执行文件均为 arm64。Tauri CLI 原生包尚未安装，待 npm 依赖恢复后复验。可通过 `npm run archcheck` 重跑。
9. 进一步隔离网络限制：本执行沙箱中 Node `dns.lookup` 对 `registry.npmjs.org` 和 `www.npmjs.com` 均返回 `ENOTFOUND`；Python `socket.getaddrinfo` 同样失败；Node `net.connect` 对公网 `1.1.1.1:443` 和本机 `127.0.0.1:9` 均直接返回 `EPERM`。同一环境的 `curl -fsSIL https://registry.npmjs.org/@milkdown%2fcrepe` 返回 HTTP 200。这说明通用进程的网络连接受执行沙箱限制，curl 使用了可用的受控通道；不能把它诊断为 M4 芯片或 Intel 二进制兼容问题，也不能推断普通终端会失败。
10. 用户在普通终端执行 `npm install --no-audit --no-fund`：成功，安装 295 个包。首次 `npm run archcheck` 报缺少 `node_modules/@tauri-apps/cli-darwin-arm64/tauri`；排查确认这是本地检查脚本的错误路径。Tauri 2.12.4 的原生模块实际是 `cli.darwin-arm64.node`，`file` 与 `lipo -archs` 均确认为 arm64，`npm run tauri -- --version` 返回 `tauri-cli 2.12.4`。脚本已修正，重跑 `npm run archcheck` 全项通过。
11. `npm run typecheck` 与 `npm run build`：通过，Vite 7.3.0 构建 29 个模块。`npm run tauri -- build --bundles app --no-sign`：通过，生成 `src-tauri/target/release/bundle/macos/MinoMarkdown.app`（9.64 MiB）；其主可执行文件经 `file` 和 `lipo` 检查为 arm64。本地构建跳过签名，未启动应用或验证交互。
12. `npm run test`：退出码 1，原因是当前骨架尚无测试文件（Vitest 提示 `No test files found`）；T01 未要求具体业务测试，T02 起添加有意义的用例后复跑。

## Apple Silicon 兼容性与弹窗定位

M4 机器上的本项目采用原生 arm64 工具链。`npm run archcheck` 已确认 `@tauri-apps/cli-darwin-arm64` 中的 Node 原生模块为 arm64；完整 `.app/Contents/MacOS/` 中的主可执行文件也已确认 arm64。若后续检查发现 x86_64 组件，应定位其具体路径和所属包，再替换为 arm64 发行包或对应源码构建，不将 Rosetta 设为项目运行前提。

用户提到的 Intel 程序弹窗目前没有可识别的程序名或路径，因此不能归因于本项目。当前 `npm install` 的直接失败点是 npm 解析 `registry.npmjs.org` 时的 `ENOTFOUND`，发生在下载依赖和运行其原生程序之前；弹窗与该阻塞没有已证实的因果关系。拿到弹窗中的程序名或截图后，再用程序路径、`file`/`lipo -archs` 和所属安装包定位触发者。

本次产物 SHA-256：`Cargo.lock` 为 `eb5964deb3a713c7480045657a0559c3212f2316ac08cad6136c6bd73d2334e6`，`package-lock.json` 为 `f383dbc49beadce67d7012d2eceabba7168458f0dea797139af4139ff5d051d3`，应用主可执行文件为 `65fbdff2ffa3436339178afd885e06c9b02e045e3018c597b4aa4a819f576b56`，`scripts/check-apple-silicon.sh` 为 `8e30ddbfcb06d69e01a5b6082d7c6a556519e4a29f1b72d3ce9b9ea24751150e`。

## 后续验证

- T02 建立语法样本和有意义的自动化测试；T03 起进行原生编辑、中文输入和交互验证。
- T28 使用正式图标并验证本地安装与签名状态；当前 `.app` 是未签名的骨架构建，不代表可发布产品。

当前没有运行桌面应用，也没有建立远程 Git 仓库。
