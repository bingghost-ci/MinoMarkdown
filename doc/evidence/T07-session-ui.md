# T07 / G07 正式界面与会话代码阶段

日期：2026-11-07（Asia/Bangkok）。原计划前置 GATE-1 仍为 PENDING；按用户“先完成全部代码、最后集中实测”的新安排，继续实现，但本记录不宣称技术路线验收通过。

## 已实现

- 文档栏、文件/导出操作区、正文布局、状态提示与折叠的编辑器验证入口。单文件模式默认隐藏文档栏。
- `DocumentSession` 以 generation、revision、savedRevision、persistence 和 diskRevision 分离“未保存、保存中、失败、冲突”；保存 N 时又编辑到 N+1 保持未保存。
- 保存回调携带 generation/revision，旧 generation 结果不能更新当前会话或当前文档。Rust 已通过主窗口标签和会话令牌限制当前文件/图片/HTML 命令；没有通用路径读写 IPC，也没有授权给打印 iframe 运行脚本。

## 自动化

- `npm run typecheck`：PASS。
- `npm run test`：40 项 PASS，其中 3 项覆盖保存期间编辑、旧 generation 返回和失败/冲突状态。
- `npm run build`：PASS；主 JS 1,779.46 kB，待 T27 处理体积与加载指标。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：3 项 PASS，其中伪造文档令牌和非主窗口标签被拒绝。

## 待完善

目录树与系统入口在 T17/T23；统一错误对象与更细粒度会话/资源作业契约在后续 T09–T22 中收敛。当前打印页为无脚本 iframe；独立打印 WebView 的隔离与原生行为留待 T21/T22 集中验证。未经原生实测不能宣称整体 UI 可用或 GATE-1 通过。

2026-11-07 产品范围复核发现首次启动仍装载“编辑验证”样本，与方案 §4 的空页面入口不符。现初始文档为空，首次显示新建、打开文件、打开文件夹和最近使用；进入文档后才挂载编辑器，验证样本保留在折叠区。`npm run typecheck`、前端 58/58、arm64 构建通过；未启动当前应用，空页面及后续编辑焦点留待原生验收。

2026-11-07 正式界面收敛：验证样本折叠面板现在仅在 Vite 开发模式显示，生产包从普通文件入口打开 `tests/fixtures/markdown/` 副本进行验收。`./start.sh --build-only` 与 manifest 核验 PASS；生产 `dist/assets/*.js` 中搜索“编辑器验证样本”“输入验证”“MinoMarkdown 编辑验证”均无匹配。此为构建产物静态检查，不替代原生界面审阅。
