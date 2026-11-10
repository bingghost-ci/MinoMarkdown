# T43 编辑入口与快捷键

日期：2026-11-10。层级：automatedVerified，原生实测 PENDING。

## 实现

- `lib.rs` 在“编辑”后插入顶层“格式”菜单：正文、标题 1–6、加粗、斜体、删除线、行内代码、项目列表、编号列表、任务列表、引用、代码块、插入链接。快捷键沿用 Milkdown 现有绑定，新增 `Cmd+K`；任务列表没有快捷键。快捷键字符串已对照锁定的 muda 0.20.0 解析代码确认。
- `native_menu.rs` 增加中英文文案，`set_language` 改为递归，顶层“格式”和子菜单都能切换语言。
- `formatActions.ts` 映射菜单到编辑器命令。`runFormatAction` 只在可视化模式且 `EditorAdapter.hasEditorFocus()` 为真时执行：它依赖 ProseMirror 的 `view.hasFocus()`，焦点在代码块（CodeMirror）、查找框或弹窗时为假，IME 组合期间也为假。
- 单路径：WebKit 先处理快捷键时，ProseMirror keymap 处理后系统不再触发菜单；菜单先处理时网页收不到按键。两种顺序下命令都只执行一次，实际顺序待原生确认。
- 工具栏“更多”菜单增加任务列表和增减缩进。任务列表切换当前列表项的 `checked`，列表外按 Crepe `/` 菜单的方式包裹。缩进按钮在列表外禁用。

## 自动化结果

`tests/format-actions.test.ts` 核对每个映射的菜单项都已构建并有中英文文案。首次 typecheck 因初始 `ToolbarState` 缺字段失败，修复后 `npm run typecheck` PASS，`npm run test` 190 项 PASS，`npm run build` PASS，`cargo test --lib` 69 项 PASS。

## PENDING

菜单显示和语言切换、一次按键只执行一次、焦点在代码块和查找框时不误改正文、中文输入期间不触发、任务列表与缩进按钮的实际操作，用户验收。
