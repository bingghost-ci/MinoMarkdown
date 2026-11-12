# T95 渲染范围收窄

状态：automatedVerified（计划层级 nativeVerified，实机 PENDING）。2026-11-12。

渲染次数用 `tests/render-scope.test.ts` 统计：替换 JSX 运行时，对每个部件独有的根元素的创建计数，应用用 `tests/helpers/appHarness.tsx` 按开发预览方式整体挂载。

## 逐项结果

| 编号 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| P4-1 AI 流式回答 | 每个片段经 `setConversations` 重跑主 hook 并渲染整个应用（Rust 约每 30 ms 发一个片段） | 流式中的文本放在 React 状态之外的 `AiStream`，只有正在书写的那条回答订阅；结束时文本照旧写入会话状态。20 个片段：文件栏、大纲、标签栏、状态栏各渲染 0 次，回答自身渲染 20 次以上 | 达标，保留 |
| P4-2 渲染边界 | 所有组件接收整个 `workspace` 对象，`src/app` 里没有 `memo`；任何状态变化都渲染全部组件 | 文件栏、大纲、标签栏、状态栏改为 `memo` 组件，只接收自己读取的属性；主 hook 的返回值经 `useStableFunctions` 处理，函数的身份不再随渲染变化 | 达标，保留 |
| P4-3 输入法组词 | `toolbar.composing` 每组一个词翻转两次，各渲染整个应用一次 | 组词开始、结束及随后的字数刷新：文件栏、大纲、标签栏渲染 0 次 | 达标，保留 |

## 做法说明

- **`useStableFunctions`（`src/app/stable.ts`）**：主 hook 每次渲染都重新定义全部处理函数，直接传下去会让 `memo` 失效。它给每个函数一个不变的外壳，调用时转到最近一次渲染的那个函数，所以处理函数读到的永远是当前状态，不会出现旧闭包。`t`（翻译）例外：它在渲染时被调用、结果取决于语言，所以改用 `useCallback` 随语言变化，否则切换语言后 `memo` 组件不会更新。
- **`pick`**：各组件的包装层只把它读取的属性展开传给内部的 `memo` 组件，组件主体的代码没有改写。文件栏原来读 `document.entryToken`，改为主 hook 提供的 `activeEntryToken`，这样文档的其他变化不会让文件栏重渲染。
- **流式文本的清理**：`AiStream` 里的条目在对应回答的“已完成”状态提交之后才清除（放在随会话状态变化的 effect 里），避免两次渲染之间回答短暂变空。
- **没有做的**：工具栏、编辑区、各对话框、AI 抽屉没有加 `memo`，它们仍随主 hook 的每次渲染而渲染。方案 §3.5 的门槛只针对文件树、大纲、标签栏和状态栏。

## 测试

新增 `tests/render-scope.test.ts`（4 项）：

- 被计数的四个部件都实际显示，大纲与文件树里有内容。
- 流式回答：逐个发送 20 个片段，上述四个部件的渲染增量为 0，AI 抽屉至多 1 次（第一个片段清除进度行），回答 20 次以上；完成后回答的文本与流式文本一致，状态为 `done`。
- 输入法组词开始与结束、再等 400 ms（字数刷新）：文件栏、大纲、标签栏的渲染增量为 0。
- 稳定引用的处理函数仍按当前状态工作：隐藏再显示大纲与文件栏；同一个文件夹连续展开、收起，每次都按当时的展开状态切换。

**反向验证**：临时让 `useStableFunctions` 原样返回输入后，第 2、3 项失败（文件栏渲染增量为 1 和 2），恢复后通过。

`tests/ai-assistant.test.ts` 有三处断言随 P4-1 调整：流式过程中的文本改从 `ai.stream.get(turnId)` 读取，回合的 `text` 在完成前为空；完成、出错、取消后的文本断言未变，41 项全部通过。

## 改动的文件

`src/app/aiAssistant.ts`、`src/app/stable.ts`（新）、`src/app/useDocumentWorkspace.ts`、`src/app/components/AiDrawer.tsx`、`FileSidebar.tsx`、`OutlinePanel.tsx`、`TabBar.tsx`、`StatusBar.tsx`、`tests/render-scope.test.ts`（新）、`tests/helpers/appHarness.tsx`、`tests/ai-assistant.test.ts`。输入法处理代码（`EditorAdapter` 的组词监听、主 hook 的 `composingRef`）没有改动。

## 检查

`npm run typecheck` PASS；`npm run test` 525 项 PASS、1 项跳过。

## 实机 PENDING

AI 回答流式输出期间在正文里打字、滚动不卡；回答书写时列表跟随滚动到底部；中文输入法连续输入长句无吞字、重复或光标跳动；切换界面语言后文件栏、大纲、标签栏、状态栏的文字立即更新；侧栏、大纲、标签的各项操作（拖动标签、右键菜单、新建与重命名）照常。
