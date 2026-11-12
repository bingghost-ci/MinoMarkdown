# T99 设置、菜单与启动

状态：automatedVerified（计划层级 nativeVerified，实机 PENDING）。2026-11-12。

原生菜单和启动过程不能在测试里运行，本任务把“要不要动菜单”的判断抽成纯函数来测试，菜单调用本身靠代码审阅。

## 逐项结果

| 编号 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| P8-1 每次写设置都重建菜单 | `update_settings` 无条件在主线程重设全部菜单文字（约 60 项），并读 `recent.json`、检查最多 20 个路径、重建“最近打开”。前端在拖动窗口、面板、滑块时约每 0.5 秒发一次补丁 | 合并前后比较语言（`menu_follows`），只有语言变了才更新菜单文字和“最近打开” | 达标，保留 |
| P8-2 无人监听的事件 | 每次写设置发出 `language-changed` | 已删除（`src/` 中没有监听者；`settings-changed` 照常发出） | 保留 |
| P8-3 启动时的重复读取 | 窗口出现前 `settings.json` 被读三次；`setup` 把刚按该语言建好的菜单再重设一遍；在主线程同步检查最近文件的路径 | 建菜单时读一次并记下语言（`native_menu::built_in`）；`setup` 不再重设菜单；最近文件列表在另一个线程读取，读完回主线程填入菜单；`refresh_menu` 用记下的语言，不再重读设置文件 | 保留（代码审阅） |
| P8-4 每次聚焦都重设菜单状态 | `set_menu_state` 每次都遍历菜单设置约 60 项的可用状态 | 记住上次应用的文档类型，相同则直接返回 | 达标，保留 |

P8-3 之后，启动到窗口出现之前 `settings.json` 的读取由三次减为一次（前端的 `get_settings` 是另外一次，未变）。“最近打开”菜单在启动后的瞬间可能还是空的，列表读完即填入。

## 测试

Rust 新增 3 项（`cargo test --lib` 共 133 项通过、4 项忽略）：

- `settings::tests::only_a_change_of_language_reaches_the_native_menu`：窗口尺寸、侧栏宽度、字号、风格、与当前相同的语言这五种补丁都不触发菜单更新；改成另一种语言触发。
- `native_menu::tests::the_menu_is_set_again_only_when_the_kind_of_document_changes`：同一类型的第二、第三次上报不再应用；类型变化时应用。
- `native_menu::tests::the_language_the_menu_was_built_in_is_remembered`。

`tests/settings-sync.test.ts`（多窗口设置同步）未改，通过。

没有自动化覆盖的：菜单文字、“最近打开”的实际更新，以及启动顺序（`.menu` 的回调先于 `setup` 执行，这是按 Tauri 2 的构建流程判断的，未在运行中的应用里确认）。

## 改动的文件

`src-tauri/src/settings.rs`、`native_menu.rs`、`recent.rs`、`lib.rs`。

## 检查

`cargo check --locked --offline` PASS，无警告；`cargo test --lib` 133 项 PASS；`npm run typecheck`、`npm run test` 未受影响（本任务没有改前端）。

## 实机 PENDING

- 启动后菜单是设置里的语言，“新建窗口”的 Dock 菜单项也是；“最近打开”在启动后出现；
- 切换语言后菜单文字与“最近打开”的空项文字更新；打开文件后“最近打开”更新；
- 拖动窗口大小、面板宽度、调字号时无停顿；
- 在 Markdown、文本、PDF 文档的窗口之间切换时，菜单项的启用与置灰正确；
- 冷启动时间与改前对比。
