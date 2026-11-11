# T74 夜间风格调整

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

用户试用 T61–T73 的构建后反馈：“纯黑风格比较难看，这个风格可以换了，黑色风格可以弄几个淡黑色的，或者灰色的风格”。

## 实现

- 移除纯黑（`black`）。夜间风格改为五种：

  | ID | 名称 | 纸面 | 说明 |
  | --- | --- | --- | --- |
  | `charcoal` | 淡黑 | `#18191b` | 新增 |
  | `dark` | 深灰 | `#242427` | 原名“深色”，ID 与色值不变 |
  | `gray` | 中灰 | `#3a3c40` | 新增 |
  | `slate` | 青灰 | `#2a303a` | 新增 |
  | `dusk` | 暖灰 | `#2e2a26` | 新增；暖色强调色，推荐宋体 |

- 风格共 12 种（原 9 种）：`white`、`mist`、`paper`、`xuan`、`parchment`、`kraft`、`mint`、`charcoal`、`dark`、`gray`、`slate`、`dusk`。
- 旧 ID 迁移表新增 `black` → `charcoal`，`ink` 由 → `black` 改为 → `charcoal`。`src/features/reading/styles.ts` 与 `src-tauri/src/settings.rs` 两份表同步修改。

## 自动化验证

- `tests/reading-styles.test.ts`、`tests/export-style.test.ts` 已更新，对比度检查覆盖新增风格。
- `settings.rs` 的测试通过（含旧 ID 迁移与两份表一致）。

## 样张

- `doc/evidence/reading/T74-all-styles.jpg`：12 种风格同一文档的总览，取代已删除的 `T61-all-styles.jpg`。
- `doc/evidence/reading/T74-night-styles.jpg`：五种夜间风格。

## 未验证

- 没有在运行的桌面应用里看过新风格，样张来自离屏 WKWebView。
- 没有用含 `black` 或 `ink` 的真实旧设置文件启动应用。

## 检查

2026-11-11，T74–T77 全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：41 个文件、448 项 PASS，1 项跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：100 项 PASS，2 项忽略。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 61.02 MiB（上一次为 60.94 MiB）。

未提交、未推送，没有运行 `./install.sh`。

## PENDING

- 实机 PENDING：在真实窗口和显示器上看五种夜间风格的纸面、界面灰度和彼此的区分度；日夜切换按钮。
- 实机 PENDING：设置文件里保存着 `black` 的用户升级后落到淡黑，其他设置保留。
- 用户验收 PENDING：五种夜间风格的取舍和配色。
