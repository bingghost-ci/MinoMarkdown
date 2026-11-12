# T103 Rust 冗余清理

状态：automatedVerified。2026-11-12。

合并安全相关的函数之前，逐处比对了标志位和错误码；合并后各处返回的错误码与原来相同，原有的符号链接、越界、目录被替换等测试全部通过。

## 规模

| | 清理前（T101 之后） | 清理后 |
| --- | ---: | ---: |
| `src-tauri/src` 的 rs | 7,119 行，415,683 字节 | 7,058 行，406,716 字节 |

（T91 基线是 6,830 行；T99–T101 新增的功能代码与测试约 290 行。）

## 已做

- **窗口校验：** `lib.rs` 新增 `require_workspace_window`（及按标签判断的 `require_workspace_label`）。五个模块各自的 `main_window` / `require_main` / `guard`、以及 19 处内联的 `if !crate::is_workspace_window(...) { return Err("OUT_OF_SCOPE") }` 全部改为调用它，共 62 处调用，定义只有一份。
- **未被调用的命令：** 删除 `export_source_markdown`、`list_recent`、`remove_recent`、`reorder_recent` 及其在 `generate_handler!` 里的注册。删除前确认 `src/` 与 `tests/` 都没有调用。按方案 §5 的默认值执行；如果将来要做“最近文件”管理界面，可从提交历史取回。
- **应用记录的保存：** “读出现有文件 → 求哈希 → 提交”的写法原有 6 处（设置、AI 配置、最近文件 4 处，其中 2 处随上一项删除），改为 `atomic_write::replace_record(path, bytes, limit)`。`positions.rs` 读取时就同时得到记录与哈希，不重复读，保持原样。
- **SHA-256 十六进制：** 已在 T100 合为 `fs::sha256_hex` / `fs::hex`。各模块里一行的本地名字（`revision`、`digest`、`hash`）保留，它们只是转调。
- **不跟随链接地打开目录：** 按路径打开的 9 处（表达式逐字相同）合为 `fs::open_directory`；按已打开目录的句柄打开子目录的 7 处（标志位相同，错误码各异）合为 `fs::open_directory_at`，它返回系统错误，各调用处按原样映射成自己的错误码（`OUT_OF_SCOPE`、`CORRUPT_DRAFT`、`NOT_FOUND`、`ASSET_NOT_FOUND`）。
- **`drafts.rs` 内部：** 三份相同的 C 字符串文件名函数和两份相同的 `same_entry` 各留一份（在 `macos_tree` 里），其余处引用它。
- **菜单项：** `lib.rs` 里 46 行 `MenuItem::with_id(app, "id", native_menu::label("id", english), true, native_menu::accelerator("id"))` 改为 `native_menu::item(app, "id", english)`，每行的 id 由三处减为一处。
- **图片类型表：** `open_intents.rs` 的 `mime_for` 改为按扩展名调用 `documents::asset_mime`，表只剩一份。
- 合并后不再使用的 `use` 一并清理；仍被非 macOS 回退分支使用的 `OpenOptions` 改为带 `cfg` 的导入。

## 核对后没有做的，及原因

- **有界读取（6 处）：** 各处的上限、读取对象（路径、句柄、`take` 的流）和超限时的错误码都不同，抽成一个函数需要四五个参数，不比现在清楚。
- **`label()` 与 `MENU_ITEMS` 合成一张表：** `label()` 还覆盖不是菜单项的 id（子菜单标题、“无最近文件”等），合并要改写约 60 行的匹配表，而菜单无法在这里运行验证。只做了上面的 `item()`。
- **`DiskAsset` 定义两次、`AssetUpload` / `DraftAsset` / `SnapshotAsset` 字段相同：** 它们是三个命令各自的入参类型，字段可见性和派生不同，合并会让模块互相依赖，收益是三行。
- **`macos_read` 的 `name()`：** 错误码是 `CORRUPT_DRAFT`，与其他三份不同，保留。`entries()` 的两份同理。
- **“保存对话框 → 规范父目录 → 拼接 → `TARGET_EXISTS`”的 6 处收尾：** 每处的对话框过滤器、类型判断和先后步骤不同，不是同一段代码。
- **非 macOS 的回退分支：** 不在本批范围（方案 §5）。

## 测试

没有新增测试：本任务不改变行为，依靠既有测试。`cargo test --lib` 140 项通过、4 项忽略，其中覆盖被合并代码的包括：`atomic_write` 的 10 项（含父目录被替换、符号链接目标）、`app_data` 的目录链接测试、`asset_directory`、`bounded_file`、`drafts` 的 13 项（含链接快照、链接草稿目录、丢弃时的越界）、`documents` 的窗口标签测试、`native_menu` 的标签与快捷键测试、`file_kinds` 与 `settings` 的前后端一致性测试。

## 改动的文件

`src-tauri/src/lib.rs`、`native_menu.rs`、`documents.rs`、`drafts.rs`、`recent.rs`、`settings.rs`、`ai.rs`、`snapshots.rs`、`workspace.rs`、`windows.rs`、`staging.rs`、`positions.rs`、`open_intents.rs`、`system_fonts.rs`、`app_assets.rs`、`fs/mod.rs`、`fs/atomic_write.rs`、`fs/asset_directory.rs`、`fs/bounded_file.rs`、`fs/app_data.rs`。

## 检查

`cargo check --locked --offline` PASS，无警告；`cargo test --lib` 140 项 PASS；`npm run typecheck` PASS。

## 实机 PENDING

原生菜单各项的文字与快捷键与改前一致；打开、保存、另存、导出、草稿恢复与丢弃、文件栏、拖入文件与图片各走一遍。
