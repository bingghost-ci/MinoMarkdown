# T23 系统文件选择器死锁修复

日期：2026-11-07。平台：macOS arm64，独立启动的当前未签名 `.app`。

## 原因与范围

点击“打开文件夹”调用同步 Tauri 命令 `choose_workspace`，随后调用 `blocking_pick_folder()`。独立窗口复现后进程仍在，但没有可操作窗口。`sample` 的主线程栈显示 `workspace::choose_workspace → tauri_plugin_dialog::blocking_pick_folder → Receiver::recv → semaphore_wait_trap`。Tauri dialog 插件源码明确要求阻塞式选择器不能在主线程运行；同步命令在此路径占用主线程，选择器无法完成。

同类风险还覆盖打开文件、最近文件/文件夹、未保存确认、首次保存、另存为和导出：这些入口也曾在同步命令里调用 `blocking_*`。已将所有 11 个包含阻塞式对话框的命令改为 Tauri 异步命令，使阻塞等待在后台命令执行器中进行；文件校验、授权令牌与保存逻辑未改变。

## 原生验证

1. 修复前，独立应用窗口点击欢迎页“打开文件夹”，窗口消失且不响应；进程采样得到上述等待栈。
2. 修复后，`cargo check --locked --offline` 与 `./start.sh --build-only` 通过。
3. 重新独立启动 `.app`，点击同一按钮，辅助功能树显示窗口内的系统文件夹选择 sheet，含 `Cancel` 与 `Open` 按钮。
4. 在选择器中导航到 `/tmp/mino-drag-repro` 并点击 `Open`；sheet 关闭，主窗口侧栏显示目录名 `mino-drag-repro` 与子文件 `独立文档.md`。

这次原生检查覆盖文件夹选择与根目录加载；其他对话框虽已按同一规则修改并编译通过，实际选择、取消和保存结果尚未逐项实测。测试应用进程已退出。

当前主程序/ZIP/manifest SHA-256：`29b429f8b087dd86dcd3c77bdf370ca114f6f23cd81ccc6411bac81e94c2fb94`、`6ddab950947f0c0a45c2c4a0446ce86692ea07e5370db8efd3984f24f4781d15`、`39a422eb3b1eebabffec69d229d4fd649cb5cb24ef04ab458f31bbe12d43b7be`。
