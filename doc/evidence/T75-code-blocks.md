# T75 编辑器代码块外观

日期：2026-11-11。层级：codeComplete，automatedVerified（仅现有高亮测试，见下）；原生实机验证 PENDING，用户验收 PENDING。

用户试用 T61–T73 的构建后反馈：编辑器里的代码块难看，没有高亮，行号栏是一条不随风格变化的白条，复制和语言按钮显得突兀。

## 原因

- Crepe 的样式表用界面的表面色画行号栏和按钮；T61 把界面色改成中性灰和白之后，它们就不再跟随纸面。
- Shell 和 JSON 几乎没有颜色：CodeMirror 默认的高亮样式不给选项与属性名、属性键名（JSON 的键）和内置命令上色。

## 实现

- `src/styles.css`：行号栏透明，行号用纸面上的弱化墨色；语言选择和复制按钮改为纸面色的扁平样式；代码字体取 `--code-font`；圆角 8 px。
- `src/core/markdown/syntaxRoles.ts` 的 `extraSyntax`：为属性名、属性键名和标准（内置）名称补上颜色。编辑器（`src/features/editor/codeTheme.ts`）与预览、导出的高亮共用这份定义，各出口配色一致。
- 新增开发样例 `?ui-sample=code`。

## 自动化验证

没有专门针对这些 CSS 的新测试；现有的高亮测试通过。

## 样张

`doc/evidence/reading/T75-code-blocks.jpg`。

样张的已知局限：离屏 WKWebView 中行号看起来挤在一起。CodeMirror 在 `requestAnimationFrame` 里测量行高，离屏窗口不触发它，所以行号栏的每一行停在 14 px 的估计值，而代码行是 22.4 px。用户自己在运行的应用里截的图中行号是对齐的。

## 未验证

- 没有在运行的桌面应用里逐个风格核对代码块。
- 悬停时出现的语言选择和复制按钮没有自动化测试。

## 检查

2026-11-11，T74–T77 全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：41 个文件、448 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：100 项 PASS，2 项忽略。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 61.02 MiB（上一次为 60.94 MiB）。

未提交、未推送，没有运行 `./install.sh`。

## PENDING

- 实机 PENDING：各风格下行号与代码行对齐，行号栏和行号颜色随风格变化。
- 实机 PENDING：指针悬停时语言选择和复制按钮的外观与可用性。
- 用户验收 PENDING。
