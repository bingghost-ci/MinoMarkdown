# T04 / G04 单文件与图片代码阶段

日期：2026-11-07（Asia/Bangkok）  
阶段：代码先行；原生操作留待用户集中测试。目标 `nativeVerified` 尚未达到。

## 已实现

- Rust `documents.rs` 使用系统文件对话框选择 Markdown，建立仅本次会话有效的文档令牌；前端不能用任意路径调用读写命令。
- 文件读取限制为 `.md`/`.markdown`、UTF-8、10 MB。保存以预期 SHA-256 校验磁盘版本；临时文件写入并同步后替换正文。新文件目标已存在时拒绝覆盖。
- 编辑器接收真实粘贴图片和图片选择回调，使用临时 blob URL 预览；保存前把文件字节经 IPC 交给 Rust，在文档旁 `assets/` 写入按内容命名的独立附件，再将正文中的 blob URL 改为相对引用。图片不合法或写入失败则正文不提交。
- 重开时仅从被授权文档的 `assets/` 目录读取附件并恢复图片预览。取消保存时编辑器内容与待保存图片仍保留在当前会话。

## 自动化结果

- `npm run build`：PASS。
- `cargo check --manifest-path src-tauri/Cargo.toml`：PASS。
- `npm run test`：35 项 PASS。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：2 项图片附件测试 PASS。
- `./start.sh --build-only`：PASS，11.96 MiB 未签名 `.app`，主可执行文件 `arm64`，SHA-256 `7d42bb357fe20e93d308d8f3a833d6ceb403e2a600591f0160fb82f1c4281205`。

## 集中验收与后续代码

未运行真实 Tauri 粘图、首次保存、关闭重开、中文路径和失败注入；这些不因构建通过而记为通过。当前草稿只在应用存活期间保留，跨异常退出恢复留待 T12 完整实现。原子替换的元数据保留、跨进程竞争与恢复日志留待 T10/T25。图片节点和复杂 Markdown 路径的完整往返留待 T08/T14/T15。原生结果统一在功能开发完成后补录。
