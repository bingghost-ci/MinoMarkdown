# T67 读取系统已装字体

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- `src-tauri/src/system_fonts.rs`：命令 `list_system_fonts` 通过 Core Text 列出本机字体族名，去掉以 `.` 开头的系统内部字体，去重并排序。只返回名字，不读取或复制字体文件。
- 前端以 `sys:<族名>` 保存选择。族名在 TypeScript（`isSystemFontName`）和 Rust（`is_font_choice`）两处校验：限制长度，拒绝引号、反斜杠、分号、花括号、尖括号和控制字符，之后才写进 CSS。
- 用户自己安装的商业字体（如方正、汉仪）可以这样选用，但不随包；导出 HTML 时只写字体名，不内嵌文件，对方机器上没有该字体则回退。

## 自动化验证

- Rust：`families_are_filtered_sorted_and_deduplicated`；`this_mac_reports_its_font_families`（在本机实际调用 Core Text）；`settings.rs` 中字体选择的校验表。
- Vitest：`tests/reading-fonts.test.ts` 中 `sys:` 名字的校验、字体栈拼接、`withoutBundledFonts`（本机列表里去掉已随包的字体）。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：在运行的应用里打开“本机”页签，列表与“字体册”一致，选中后正文改变；装有上千款字体时列表不卡。
- 实机 PENDING：选了本机字体后卸载该字体，再启动时回退正常。
- 用户验收 PENDING。
