# T70 AI 接入层

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src-tauri/src/ai.rs` 是全应用唯一发出网络请求的代码。使用 `ureq` 3.5.1（`native-tls`，即系统 TLS，不带 OpenSSL）向 OpenAI 兼容的 `/chat/completions` 发流式请求。预置 DeepSeek（`https://api.deepseek.com/v1`、`deepseek-chat`）和 OpenAI（`https://api.openai.com/v1`、`gpt-4o-mini`），也可自定义地址和模型。
- 配置存在应用数据目录的 `ai.json`，不含密钥。密钥按服务商存入 macOS 钥匙串（服务名 `app.mino.markdown.ai`，账户为服务商 ID），通过 `security-framework` 3.7.0 读写；密钥只在 Rust 内使用，不返回给前端，不写日志。
- 地址必须是 https；只有回环地址允许 http，并且可以不设密钥（供本机模型和测试使用）。不跟随重定向。
- 命令：`ai_get_config`、`ai_set_config`、`ai_set_key`、`ai_clear_key`、`ai_chat`、`ai_cancel`。事件：`ai-config-changed` 发给所有窗口；`ai-stream` 只发给发起请求的窗口。
- 错误码：`AI_DISABLED`、`AI_NO_CONSENT`、`AI_NO_KEY`、`AI_TOO_LARGE`、`AI_BUSY`、`AI_NETWORK`、`AI_HTTP_<状态码>`、`AI_BAD_RESPONSE`、`AI_CANCELLED`、`AI_INVALID_CONFIG`、`AI_INVALID_KEY`，以及实现时新增的 `AI_INVALID_REQUEST`、`AI_KEYCHAIN`。服务端返回的错误正文不透传，只报状态码。
- webview 的 CSP 和 `capabilities/main.json` 与上一版逐字节相同（`git diff` 为空）。

## 自动化验证

Rust 测试 19 项，全部对本机回环上的模拟服务或内存中的假密钥库运行，没有使用真实密钥：

- SSE 解析：任意分块边界、UTF-8 被拆开、CRLF、没有 `[DONE]` 的结尾、非流式响应。
- 请求内容：`Authorization` 头、模型、`stream` 标志、消息。
- 失败情形：401 只报状态码、重定向不跟随、连接被拒、服务端不响应时超时、流格式错误。
- 取消：流进行中取消能及时停止；并发上限与释放。
- 开关顺序：未开启、未同意、无密钥依次拒绝；回环地址可无密钥。
- 配置：地址校验表、读写往返、损坏文件按默认值读取、符号链接的配置文件被忽略、切换服务商时使用该服务商的默认地址和模型（T76 起改为各服务商分别记住上次的地址和模型，见 `T76-ai-settings.md`）。
- 密钥：格式校验；任何返回值和事件里都不出现密钥。

## 样张

`doc/evidence/reading/T70-ai-settings.jpg`：设置对话框的 AI 页。

## 未验证

- 没有真实 API 密钥，**没有对 DeepSeek 或 OpenAI 发过真实请求**；真实 HTTPS 握手、证书校验、两家服务的实际流格式都未实测。
- 没有在运行的 Tauri 应用里调用过这些命令（自动化测试直接调用 Rust 函数）。
- 应用未签名，重新构建后二进制变化，macOS 可能再次弹出钥匙串授权。
- 只有设置了 `HTTPS_PROXY` 等环境变量时才走代理，不读取系统偏好设置里的代理；从 Finder 启动的应用通常没有这些环境变量。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：填入真实密钥，对 DeepSeek 和 OpenAI 各发一次请求，流式输出、取消、错误密钥（401）、断网的提示。
- 实机 PENDING：钥匙串弹窗的出现次数；“钥匙串访问”里条目的服务名和账户。
- 实机 PENDING：用抓包或 Little Snitch 确认 AI 关闭时应用没有任何出站连接。
- 用户验收 PENDING。
