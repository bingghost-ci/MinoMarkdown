# T51 风格基础重构

日期：2026-11-11。层级：automatedVerified（计划层级即 automatedVerified）。原生实测与用户验收 PENDING。改动未提交。

## 实现

- `src/features/reading/styles.ts`：14 个风格（素白、书页、宣纸、牛皮纸、羊皮卷、再生纸、豆沙绿、暖黄、水墨屏、低蓝光、夜读、深色、墨黑、科技蓝白）作为数据。每个风格只写纸面、正文、次要、链接、纹理、推荐字体和代码配色，桌面色、纸边、阴影、代码底、引用线、表格线和界面色（章程 §4.3）由 `color.ts` 推导。旧主题 ID 全部保留：`light`、`paper`、`mint`、`butter`、`eink`、`blueprint`、`dark`、`graphite` 原样可用，`system` 解析为白天或夜间风格。
- `src/features/reading/css.ts`：由风格数据生成 CSS 变量、编辑器（`.editor-root .milkdown .ProseMirror`）与 `.mino-doc`（预览、导出）两套元素选择器、导出页样式。`install.ts` 在启动时注入一次；切换风格只改根节点 `data-theme` 和变量，不重建编辑器。
- `src/styles.css`：删除九个主题块、T50 的 SVG 噪点纹理和设置色块，只保留界面与编辑器专属映射。
- `src-tauri/src/settings.rs`：`STYLE_IDS` 白名单加入新 ID；新增 `dayTheme` 字段（章程 v0.2 只写了 `nightTheme`，跟随系统需要两个）。
- `scripts/style-samples.swift`：离屏 WKWebView 样张工具，读取 `?ui-preview=editor` 页面，不接触已安装的应用。

## 自动化结果

- `tests/reading-styles.test.ts` 9 项：14 个风格字段完整、T51 之前的主题 ID 全部保留、正文对比度 7–15:1 且次要和链接 ≥ 4.5:1、界面色饱和度不超过纸面一半且夜间为深色、只有纸张风格使用离线图块且无 SVG 噪点、跟随系统的日夜解析、排版设置到 CSS 变量的映射、字体跟随风格的规则、首行缩进只作用于顶层段落。
- 实测对比度（正文 / 次要 / 链接）：素白 14.7/6.1/6.7，书页 13.2/5.8/6.3，宣纸 14.7/6.3/5.9，牛皮纸 9.7/6.3/6.4，羊皮卷 10.7/6.5/6.7，再生纸 12.7/6.3/7.6，豆沙绿 10.3/5.8/5.9，暖黄 10.3/5.9/5.5，水墨屏 14.5/7.5/14.5，低蓝光 11.1/6.5/5.7，夜读 10.2/5.9/7.0，深色 11.8/6.6/7.9，墨黑 9.8/5.6/9.0，科技蓝白 14.1/6.0/6.4。
- 宣纸正文由章程初值 `#1f1d1a`（15.0）调为 `#211f1b`（14.7），避免超过 15:1 上限。
- 全量检查：`npm run typecheck` PASS；`npm run test` 306 项 PASS、1 项样张生成测试默认跳过（33 个文件）；`npm run build` PASS；`cargo test --lib` 70 项 PASS、1 项忽略。

## 样张

`doc/evidence/reading/M1-14-styles.jpg`：14 个风格在编辑器页面视图中的平面对比（1280×860 窗口缩放）。

## PENDING

- 原生：用旧 `settings.json`（只含 `theme`）启动后风格正确；切换风格时光标、撤销栈和未保存状态不变。
- 用户验收：风格名单与配色。
