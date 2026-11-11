# T58 阅读模式

日期：2026-11-11。层级：automatedVerified，原生实测与用户验收 PENDING。

## 实现

- **默认进入：** `opensInReadingMode` 规定：设置开启且文档有磁盘文件且没有未保存修改时进入阅读模式；新建、从草稿恢复、有未保存修改的文档进入编辑。
- **切换：** “视图 > 阅读模式”，`⌘⇧R`（`lib.rs` 菜单项 `toggle-reading`，`native_menu.rs` 中英文标签）。阅读工具栏显示“阅读模式”、大纲、页面/宽屏和“编辑”按钮；编辑工具栏右侧有“阅读”按钮。
- **只读：** `EditorAdapter.setReadonly` 调用 Crepe 的 `setReadonly`（`view.setProps({ editable })`），不重建编辑器，撤销栈、未保存状态与草稿不受影响。所有编辑入口（插入图片、替换图片、格式命令、输入）在只读时被拦截，`insertFile`/`replaceSelectedImage` 抛出 `READING_MODE`。阅读模式下普通点击即可打开链接。
- **界面：** 隐藏块把手、斜杠菜单、浮动工具栏、链接编辑、代码块和图片块工具；隐藏光标；顶部 2px 阅读进度条。
- **翻页：** 空格 / Shift+空格按一屏减两行，PageUp/PageDown 同；方向键滚动；Home/End 到首尾；按字母键只提示“按 ⌘⇧R 开始编辑”，不改文档。IME 组合输入期间不拦截。
- **位置：** 会话内按标签记住滚动位置，切换回来时恢复。
- 源码保护文档仍显示预览，阅读模式只隐藏编辑入口。

## 自动化结果

`tests/reading-mode.test.ts` 2 项 PASS：打开规则；在 jsdom 中逐一尝试编辑路径，文档不变，退出阅读后仍可编辑且历史完整。Rust 70 项 PASS（菜单测试见下方收尾一节）。

## 收尾：原生菜单测试（2026-11-11）

`lib.rs` 中 46 个菜单项的快捷键移入 `native_menu.rs` 的 `MENU_ITEMS` 表，构建菜单时用 `accelerator(id)` 读取，快捷键与菜单行为不变。新增 Rust 测试 2 项 PASS：`toggle-reading` 的快捷键为 `Cmd+Shift+R`，中文标签“阅读模式”、英文“Reading Mode”，`⌘E` 仍属于行内代码；所有菜单项都有中英文标签，快捷键互不重复，ID 不重复。Rust 共 72 项 PASS、1 项忽略。系统默认菜单项（如“进入全屏幕”）的快捷键不在表内，冲突仍需实机确认。

## 样张

`doc/evidence/reading/M3-reading-mode.jpg`。

## PENDING

从 Finder 和文件菜单打开时默认进入阅读；新建与草稿恢复进入编辑；`⌘⇧R`；翻页；阅读位置；未保存状态与撤销不受影响；中文输入法下按键不误改；用户验收。
