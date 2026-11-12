# T87 PDF 导航

日期：2026-11-12。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 书签：`pdfOutline` 把嵌套的 outline 展平成大纲条目（最多 2000 项），目标是页码；显示在现有大纲栏。
- 页码：底部控制条有页码输入框、上一页 / 下一页、缩小 / 放大 / 适应宽度。
- 查找：复用查找栏。逐页提取文字并缓存，在页文字里搜索（支持区分大小写、全词、正则），从当前页之后的第一处开始；上一个 / 下一个滚到命中所在页的大致位置；有 CSS Custom Highlight API 时在文字层标出命中。没有文字层时提示无法查找。
- 位置：停止滚动 1.2 秒后保存“页码 + 页内比例”，打开时恢复。
- 页面颜色：控制条的调色板按钮决定页面是否跟随阅读风格的纸色（默认跟随，选择记在 `localStorage`），做法见 [T86](T86-pdf-reading.md) 末尾。最初实现的“页面调暗”已被它取代。

## 自动化验证

Vitest `tests/pdf-engine.test.ts`：样例 PDF 的三项书签（含一项嵌套、一项中文标题）及页码；内部链接目标解析为第 3 页，不存在的目标为 null；无文字层 PDF 的大纲为空、文字为空并判为扫描件；`searchPages` 的顺序、大小写、全词、上限；`joinTextItems`；`pageAtOffset`。位置存取见 [T83](T83-text-reading.md) 的 Rust 测试。

## 未验证

大纲点击跳转、页码跳转、查找定位与高亮、重开回到原页、调暗观感都没有在真实窗口里操作过。查找第一次会提取全文，几百页的 PDF 需要多久没有测。

## 检查

- `npm run typecheck`：PASS。
- `npm run test`：498 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：130 项 PASS，2 项忽略。
- `npm run build`、`./build.sh`：结果见 [T89](T89-formats-verification.md)。
