# T44 段落移动与复制

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `src/features/editor/blockCommands.ts`：`moveBlock`、`duplicateBlock` 两个 ProseMirror 命令。列表项按列表项移动，表格、代码块整体移动，引用内的段落不会移出引用。移动用一个 `replaceWith` 步骤完成，并用 `closeHistory` 保证每次操作各占一步撤销。
- 文档或容器边界消费按键但不改动文档。选区跨多个块时不处理，按键交回系统。IME 组合期间不执行。
- `Option+↑/↓`、`Cmd+Shift+D` 同时注册到 ProseMirror keymap 和代码块的 CodeMirror keymap（高优先级）。光标在代码块内时会移动整个代码块，代替 CodeMirror 默认的按行移动。
- 本任务把已随 Crepe 安装的 `@codemirror/*` 声明为直接依赖，版本与锁文件相同，`package-lock.json` 只增加根依赖 6 行，未下载新包。

## 自动化结果

`tests/block-commands.test.ts` 12 项覆盖段落、边界、嵌套列表、表格、代码块、引用、原子块选区、跨块选区、撤销步数和复制。`npm run typecheck` PASS，`npm run test` 202 项 PASS，`npm run build` PASS。未涉及 Rust。

## PENDING

`Option+↑/↓` 在 WebKit 中是否被系统行为抢占、代码块移动后焦点回到 CodeMirror、保存重开，用户验收。
