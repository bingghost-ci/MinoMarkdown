# T111 自定义代码配色

日期：2026-11-18。环境：macOS 27（Darwin 27.0.0），Apple Silicon。层级：automatedVerified，实机 PENDING。

## 做法

- “代码配色”增加“自定义”。设置项 `codeCustomColors` 为 `{ day, night }` 两个“角色 → `#rrggbb`”映射，只存改过的角色；未改的按“随风格”，改过的原样使用。
- `settings.rs` 与 `codeColors.ts` 两侧都只放行已知角色和七位十六进制色值。
- 设置页的编辑区：覆盖全部角色的代码样例（可点选记号）、十四个记号按钮、一个调色板（R、G、B 滑杆、色值框、现成色块、恢复默认）、“从一套配色开始 / 套用”、“全部恢复默认”，并写明正在编辑白天还是夜间的一套。最初是每行一个系统取色器加色值框，用户试用后认为太麻烦，同日改为调色板。

## 自动化结果

- `npm run typecheck`：通过。
- `npm run test`：641 通过、1 跳过；`tests/code-colors.test.ts` 14 项。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：175 通过、4 忽略。
- `npm run build`：通过。
- 开发预览（`?ui-preview=editor&ui-settings-tab=appearance&ui-settings=…`）用无界面 Chrome 截图查看了白色风格下的编辑区：样例、记号按钮、调色板布局正常，预设的两种自定义颜色（关键字、字符串）在样例、按钮与“自定义”卡片上生效。

## 未验证

- 滑杆拖动的手感、拖动中是否卡顿，以及点选和拖动的交互本身，截图看不到，没有自动化测试覆盖。
- 实机项（[验收与发布 §8P](../05-验收与发布.md)）未执行。
