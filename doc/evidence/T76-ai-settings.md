# T76 AI 设置：两家密钥与模型选择

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

用户要求：“在设置里面实现配置 OpenAI 和 DeepSeek 的 API key 的方式，并且可以自由选择指定的模型”。未签名包重新构建后钥匙串再次弹窗的问题，用户要求暂不处理。

## 实现

- 设置的 AI 页：每个服务商一行密钥（DeepSeek、OpenAI；“自定义”在正在使用或已有密钥时显示），含“已保存 / 未设置”、输入框、“保存”、“删除”，当前使用的一家带“当前使用”标记。模型是可自由填写的输入框，附一份列表（常用模型建议加上从服务取回的模型）和“获取模型列表”按钮。
- 后端 `src-tauri/src/ai.rs`：
  - `AiConfigView` 增加 `keys: { deepseek, openai, custom }`，以及可选的 `providers`（每家记住的 `{ baseUrl, model }`，不含密钥）。
  - `ai_set_key { key, provider? }`、`ai_clear_key { provider? }`。
  - 新命令 `ai_list_models` → `string[]`：带 Bearer 密钥 GET `<baseUrl>/models`，不发送任何文档内容。检查项与顺序同对话：`AI_DISABLED`、`AI_NO_CONSENT`、`AI_NO_KEY`（回环地址除外）；只允许 https（回环地址除外）；不跟随重定向；最多 500 个模型 ID；响应正文不超过 1 MiB；整个请求有超时。没有新增错误码。
  - 模型按服务商记忆：DeepSeek → OpenAI → DeepSeek 切换后恢复 DeepSeek 原来的模型。没有 `providers` 的旧 `ai.json` 照常读取。
- AI 抽屉显示“服务商 · 模型 · 主机名”。

## 自动化验证

- Rust `ai::` 25 项通过，其中 6 项为新增：取模型列表成功；数量上限与超大响应；各项检查不通过时不建立连接；失败情形（401、格式错误、重定向、连接被拒、服务端不响应）；按服务商存取密钥；模型记忆与旧文件读取。全部对本机回环上的模拟服务或内存中的假密钥库运行。
- Vitest：`ai-client` 15 项、`ai-assistant` 36 项、`ai-prompts` 31 项通过。

## 样张

`doc/evidence/reading/T76-ai-settings.jpg`：设置对话框的 AI 页，数据是预览用的固定内容，页面没有发出请求。

## 未验证

- 没有真实密钥，**没有对 OpenAI 或 DeepSeek 的 `/models` 或对话接口发过真实请求**。
- 没有在运行的桌面应用里操作过这一页。
- 未签名包重新构建后钥匙串再次弹窗的问题按用户要求暂缓，未处理。

## 检查

2026-11-11，T74–T77 全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：41 个文件、448 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：100 项 PASS，2 项忽略。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 61.02 MiB（上一次为 60.94 MiB）。

未提交、未推送，没有运行 `./install.sh`。

## PENDING

- 实机 PENDING：分别保存 DeepSeek 与 OpenAI 的真实密钥，各取一次模型列表、各发一次对话；删除密钥后状态变为“未设置”。
- 实机 PENDING：在两家之间来回切换，各自的模型保持；手动填写列表之外的模型名。
- 实机 PENDING：错误密钥、断网时“获取模型列表”的提示。
- 用户验收 PENDING。
