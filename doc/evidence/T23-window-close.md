# T23 窗口关闭与应用退出

日期：2026-11-07。用户反馈点击窗口红色关闭按钮后程序未退出。

## 原因与修复

前端 `onCloseRequested` 先调用 `preventDefault()`，完成各 Tab 未保存内容检查后只调用 `window.destroy()`。Tauri 的 `destroy()` 强制销毁该窗口，不表示请求退出 macOS 应用。关闭流程现改为调用 `@tauri-apps/api/app` 的 `exit(0)`，主窗口能力增加 `core:app:allow-exit`；取消、保存失败时仍保留窗口。关闭循环移除不必要的 `requestAnimationFrame` 等待，切换到其他 Tab 时使用事件循环定时器等待状态更新。

## 验证

- `npm run typecheck`：通过。
- `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml`：通过。
- `./start.sh --build-only`：通过，arm64 `.app`、ZIP 和 manifest 校验通过。
- 原生操作：启动本次构建的 `.app`，通过 macOS 辅助功能点击唯一窗口的 close button；3 秒后 `pgrep -x mino-markdown` 无结果。此次验证使用无修改的初始窗口；未保存的多 Tab 取消/保存分支仍待用户集中实测。

最终主程序 SHA-256：`5a75ec80617a38ea59b2a6f3216efbaaacbb6aedaef0fb4ec79d8585e83cb5cc`；ZIP：`7990acda6d9f1612d5ebc658dbc0a146940c189de03a77f3ca05d91191204255`；manifest：`76c109e48ee77dbfc12257fe53a7c9936bf7a6d206b22159d5f11dcb415ecd23`。
