# T31 止血

状态：代码完成，自动化通过；原生实机 PENDING；用户验收 PENDING。

| 项 | 实现 | 自动化 |
| --- | --- | --- |
| 后台命令 | 含文件 IO、哈希、图片处理的命令改 `#[tauri::command(async)]`。窗口类操作、`release_*`、`take_open_intents`、`discard_open_intent` 保持同步。阻塞式对话框不在主线程 | `cargo check` 与 Rust 测试 |
| 草稿 | `draftScheduler` 1.5 s 节流、10 s 最大等待；每草稿保留 3 份快照；图片按哈希硬链接复用；写后不再 `list_drafts`；列表只读 manifest；`read_draft` 完整校验并回退上一份有效快照；预览不加载图片 | `draft-scheduler.test.ts`，`drafts.rs` 的保留、修剪、只读 manifest、损坏回退、未知图片测试 |
| 图片引用 | 输入路径从 ProseMirror 文档遍历 | 类型检查；真实编辑器路径待实测 |
| 磁盘检测 | 先比较 mtime 和 size，变化才读文件和哈希；组合输入结束不触发读盘 | `documents.rs` 测试 |
| 大小阈值 | `VISUAL_SIZE_LIMIT_BYTES` 统一按字节 | `markdown-codec.test.ts` |
| 工具栏/缩放 | 状态未变不触发 React 更新；缩放不再每帧写 settings | 类型检查；帧率待实测 |
| 关闭/退出 | 后台脏标签会切换后保存，未修改标签不切换不加载 | 无 UI 自动化，待实测 |
| 多窗口设置 | `update_settings(patch)` 串行合并并广播 | `settings-sync.test.ts`，`settings.rs` 测试 |

风险记录：同一草稿的多份快照通过硬链接共享未变化图片，单个图片文件损坏会同时影响这些快照，正文不受影响。
