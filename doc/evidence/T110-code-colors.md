# T110 代码配色

日期：2026-11-17。环境：macOS 27（Darwin 27.0.0），Apple Silicon。层级：automatedVerified，实机 PENDING。

## 问题

代码高亮沿用 CodeMirror 默认高亮的标签列表，它没有普通变量名、函数调用、运算符的规则，这些记号显示为正文色；暖色配色的关键字、定义、字符串同为棕红色相，难以分辨。配色只随阅读风格固定一套，不能选择。

## 做法

- 角色增加 `function`、`property`、`operator`，补上缺失标签到角色的映射（`syntaxRoles.ts`）。
- `src/features/reading/codeColors.ts`：七套配色（随风格、素墨、GitHub、One、Solarized、Gruvbox、Tokyo Night）；`codePalette` 按风格的代码底色修正对比度（代码 4.5、注释 3.2），保持色相只调明度。牛皮纸的“随风格”用单独的深色一套。
- 设置项 `codeColors`，经 `typographyVariables` 输出 `--syntax-*`，应用、导出与打印共用；设置 › 外观增加选择器，样例画在当前纸张的代码底色上。

## 自动化结果

- `npm run typecheck`：通过。
- `npm run test`：61 个文件（1 个跳过），635 项通过、1 项跳过；其中 `tests/code-colors.test.ts` 8 项。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：175 通过、4 忽略。
- `npm run build`：通过，入口包未超出预算。
- 用无界面 Chrome 把真实高亮器的输出按白、书页、牛皮纸、深灰四种风格 × 七套配色渲染成图人工查看：各套可分辨；牛皮纸底色深，各套修正后都偏暗、彼此差别变小。

## 未做

- 源码编辑器（Markdown 源码模式、源码文件的编辑）仍用 CodeMirror 默认配色与 One Dark。
- 实机项（[验收与发布 §8O](../05-验收与发布.md)）未执行。
