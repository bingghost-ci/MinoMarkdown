# T40 文件夹全文搜索

任务：T40 / G40 · 日期：2026-11-10 · 输入版本：`4fd5f59` 之上的未提交工作区 · 运行环境：macOS arm64，Vitest 与 Rust 单元测试，未启动原生应用。

## 变更

- `src-tauri/src/workspace.rs`：`search_workspace`（`#[tauri::command(async)]`）和 `search_at`。只接受工作区根令牌，不跟随符号链接，每进一层目录都重新核对规范路径，沿用 `ignored` 规则和 20 MiB 上限，用 `read_no_follow` 读取。结果最多 500 条、每个文件 5 条；新查询或空查询会取消该窗口之前的搜索。结果只含工作区内的令牌和相对路径，不返回绝对路径。
- `src-tauri/src/lib.rs`：注册命令和 `SearchState`。
- `src/app/useDocumentWorkspace.ts`、`src/app/components/FileSidebar.tsx`、`src/styles.css`、`src/app/i18n.ts`：侧栏搜索框，IME 组合结束后才查询，250 ms 防抖，序号丢弃过期结果；点击后打开文档，用查找栏定位到对应匹配。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：19 个文件、156 项 PASS（本任务逻辑在 Rust）。
- `npm run build`：PASS。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：66 项 PASS，1 项计时测试默认忽略。新增 4 项覆盖大小写、BOM/CRLF、令牌复用、忽略目录、超限和非 UTF-8 文件、符号链接与环路、非根令牌、500 条截断、取消、空查询和超长查询。

## 固定样本耗时

在 `dist-package/performance-fixtures/directory` 的 10,000 个文件上运行，命令为 `MINO_SEARCH_FIXTURES=… cargo test --release --lib search_fixture -- --ignored --nocapture`：

| 查询 | 结果 | 耗时 |
| --- | --- | --- |
| 高频词 `Synthetic`，达到 500 条后提前结束 | 500 条，已截断 | 55 ms |
| 不存在的中文词，扫描全部文件 | 0 条 | 889 ms |

这是 Rust 测试进程内的单次耗时，运行前未清除系统文件缓存，不代表应用内端到端体验。

## 限制

- 按行匹配，跨行内容搜不到。
- 定位按源文本中的第几个匹配换算。可视化模式隐藏了链接地址等内容，所以匹配序号可能相差，会落到相邻匹配。
- 不做跨文件替换，不建持久索引。
- 原生实测 PENDING：大目录响应、中文查询、点击定位。用户验收 PENDING。
