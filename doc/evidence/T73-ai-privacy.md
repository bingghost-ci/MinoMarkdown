# T73 隐私与离线边界

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- AI 默认关闭。关闭时不显示 AI 悬浮按钮，`ai_chat` 直接返回 `AI_DISABLED`，应用不发出任何网络请求。
- 第一次开启时弹出确认框（`AiConsentDialog`），写明：只有在用户点击提问、摘要或处理选中文字时才发送；发送的是当前文档的标题和正文、用户的问题和本次对话里之前的问答；发送到哪家服务和哪个主机；图片和其他文件不发送；密钥保存在钥匙串；对方如何保存和使用由该服务的条款决定。未同意时 Rust 返回 `AI_NO_CONSENT`，这道检查在 Rust 里，不依赖前端。
- 抽屉顶部每次都显示目的地。
- webview 仍没有网络权限：CSP 的 `connect-src` 仍只有 `ipc:` 和 `http://ipc.localhost`，`capabilities/main.json` 未改。请求只由 Rust 发出。
- 密钥不写入 `ai.json`、设置文件、日志、草稿或导出文件；代码、测试和文档里没有真实密钥。
- 产品定位在 `doc/01`、`02`、`05`、`08`、根 `README.md` 和 `CLAUDE.md` 中改为“默认离线，AI 为用户主动开启的可选联网功能”。

## 自动化验证

- Rust `gates_are_checked_in_order`：未开启、未同意、无密钥依次被拒，且被拒时没有连接到模拟服务。
- Rust `key_is_validated_and_never_leaves_the_secret_store`、`config_round_trips_and_bad_files_read_as_defaults`：配置文件和返回值里没有密钥。
- `tests/ai-assistant.test.ts`：第一次请求前先要求确认，确认前不发送任何内容；确认后才保存“已开启”和“已同意”；保存失败时确认框保持打开并报错。
- 原有的导出与预览净化测试全部通过，回答走同一条净化路径。

## 样张

`doc/evidence/reading/T73-ai-consent.jpg`：首次开启的确认框。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：AI 关闭状态下用抓包工具观察应用启动、打开文档、导出的全过程，确认没有出站连接。
- 实机 PENDING：开启后只有点击操作时才有连接，且只连到配置的主机。
- 实机 PENDING：确认框的文字在英文界面下完整、可读。
- 用户验收 PENDING：提示文字是否足够明确。
