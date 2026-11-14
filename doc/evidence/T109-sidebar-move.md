# T109 文件栏整理与拖入证据

任务状态以 [开发进度](../06-开发进度.md) 为准，本文件只记录检查与实测结果。

## 自动化

2026-11-14：`npm run typecheck` PASS；`npm run test` 562 项 PASS、1 项跳过；`cargo test --lib` 153 项 PASS、4 项忽略。相关 Rust 测试：`workspace.rs` 的 `moving_entries_into_other_folders`、`renaming_a_folder_moves_everything_inside_it`、`removing_a_folder_covers_everything_inside_it`；`positions.rs` 的 `positions_follow_a_renamed_file_and_the_files_of_a_moved_folder`；`tests/document-kinds.test.ts` 的文件关联一致性检查。

## 实机

| 项目 | 结果 |
| --- | --- |
| 未打开文档时把文件拖进文件夹，状态栏显示“已移动” | PASS（2026-11-14，已安装版本） |
| 打开一个文档后再拖动 | FAIL：拖动不生效，关闭标签后恢复；原因待查 |
| 文件夹拖动、同名冲突、自动展开、Esc、保存写到新位置、非空目录重命名与废纸篓 | PENDING（用户手动实测） |
| 拖到 Dock 图标、访达“打开方式” | PENDING（需安装正式版） |
