# T18 文件操作代码阶段与 GATE-2 预审

2026-11-07。T18 当前层级：codeComplete；GATE-2：PENDING。

- 目录令牌范围内可新建 `.md`/`.markdown` 与子目录；名称排除隐藏、路径分隔符、控制字符、不支持扩展名和已存在目标。现有文件/空目录可同级重命名，已打开文档的后端路径授权随之更新。
- 删除仅调用 macOS `NSFileManager.trashItemAtURL`；非空目录拒绝，失败没有永久删除回退。当前文档移到废纸篓前通过未保存保护；成功后切到空白文档。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：16/16（名称校验、目录范围、分页与前序保存/恢复）。`npm run test -- --reporter=dot`：47/47；`npm run build`、`cargo check`：通过。

GATE-2 未放行：T03–T06、T09/T11/T15/T16/T18 的原生完成层级未达到；真实废纸篓、重命名大小写碰撞、只读/外部同步目录、目录树选中状态和当前文档行为尚待集中实测。代码阶段可继续 T19，但不得称本地编辑能力已通过验收。

2026-11-07 新建/重命名边界加固：macOS 在已打开的父目录句柄上用 `mkdirat` 或 `openat(O_EXCL|O_NOFOLLOW)` 创建；重命名用 `renameatx_np(RENAME_EXCL)` 避免检查后出现的目标被覆盖。仅大小写变化且目标指向同一文件时，经同目录隐藏暂存名完成两步排他改名，失败尝试恢复原名。完成后核对父目录及目标文件身份；目录位置变化返回 `COMMIT_UNCERTAIN`，前端提示先核对磁盘。定向 4/4、Rust 全量 39/39、arm64 构建通过；负例覆盖现有目标、符号链接目标和父目录链接。系统废纸篓 API 仍按路径执行，真实 Finder/大小写文件系统/外部并发留待集中实测，GATE-2 保持 PENDING。

同日废纸篓入口改为从当前路径生成短期 [Apple 文件引用 URL](https://developer.apple.com/documentation/foundation/nsurl/filereferenceurl%28%29)，并在调用系统 `trashItemAtURL` 前核对引用当前路径、文件 dev/inode 和父目录身份。Apple 文档说明文件引用 URL 可随同一文件对象移动而保持有效，但不能跨重启持久保存；这里只在本次操作内使用。Rust 39/39、arm64 构建通过；没有执行实际废纸篓移动，系统 API 在目标卷上的行为与非协作源文件瞬时替换仍待集中实测，GATE-2 PENDING。
