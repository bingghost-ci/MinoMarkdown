# T71 AI 面板

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src/app/components/AiDrawer.tsx`：页面右侧的“AI 问书”抽屉。顶部写明内容会发送到哪家服务和哪个主机；预设操作有全文摘要、要点、关键概念、背景解读；可自由提问，可让 AI 根据文档提出建议问题；回答流式显示，可停止、复制、插入到文档。
- `src/features/ai/prompts.ts`：组装消息；长文档按预算截断或分段后逐段处理再汇总，截断不会切开一个字符（代理对）；解析建议问题。
- `src/features/ai/client.ts`：对 `ai_chat`、`ai_cancel`、`ai-stream` 的封装，传输层可替换。`src/app/aiAssistant.ts` 的 `useAiAssistant` 保存抽屉状态；IPC 仍只在 `useDocumentWorkspace.ts` 里。
- 回答经预览渲染器输出，与普通文档一样被净化，不加载远程图片。
- 失败或被取消的问答不进入后续请求的对话历史。

## 自动化验证

- `tests/ai-prompts.test.ts`（31 项）：消息结构、截断与分段、代理对、建议问题解析、可插入内容的整理（保留代码和自动链接）。
- `tests/ai-client.test.ts`（11 项）：流事件的顺序、按请求编号过滤、取消、错误码到提示语的映射。
- `tests/ai-assistant.test.ts`（30 项）：用假传输层驱动整个抽屉状态机，包括忙碌时拒绝新请求、停止、清空、切换文档、失败不进历史。

这些测试发现并修复了 5 处缺陷：截断切开代理对、插入时丢掉代码与自动链接、建议问题未先去空白、旧风格 ID 查表命中对象原型、失败问答进入历史。

## 样张

`doc/evidence/reading/T71-ai-drawer.jpg`：白、书页、深色下的抽屉。回答来自开发预览里的固定文本（`previewAiTransport`），不是真实模型的输出，页面没有发出请求。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：真实服务下的流式显示速度、长文分段处理的进度提示、停止后的状态。
- 实机 PENDING：抽屉与大纲、阅读模式、窄窗口同时出现时的布局。
- 用户验收 PENDING：摘要和问答的质量取决于所选模型，未评估。
