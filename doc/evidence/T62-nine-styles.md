# T62 风格精简为 9 种

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

- 风格由 14 种减为 9 种：白、灰白、书页、宣纸、羊皮卷、牛皮纸、豆沙绿、深色、纯黑（ID：`white`、`mist`、`paper`、`xuan`、`parchment`、`kraft`、`mint`、`dark`、`black`）。
- 旧 ID 迁移：`light`、`blueprint` → `white`；`newsprint`、`eink` → `mist`；`butter`、`amber` → `paper`；`graphite` → `dark`；`ink` → `black`。其余同名 ID 不变。
- `src/features/reading/styles.ts` 的 `legacyStyleIds`、`migrateStyleId` 与 `src-tauri/src/settings.rs` 的 `LEGACY_STYLE_IDS`、`migrate()` 各存一份；旧设置文件中的 `theme`、`dayTheme`、`nightTheme`、导出风格在读取时迁移。
- 默认白天风格为 `white`，夜间为 `dark`。

## 自动化验证

- `tests/reading-styles.test.ts`：九种风格的名单、分组、日夜划分；每个旧 ID 都能迁移到现有风格；未知 ID 返回空（包括 `constructor` 这类对象原型上的名字，测试发现后改用 `Object.hasOwn`）；TypeScript 与 Rust 两份表一致。
- `settings.rs` 的 `older_style_ids_and_font_settings_are_migrated_on_read` 等测试：旧设置文件读取后得到新 ID。

## 样张

`doc/evidence/reading/T74-all-styles.jpg`（原 `T61-all-styles.jpg` 已删除，由它取代）。

后续变化：T74 移除纯黑并新增四种夜间风格，风格数量变为 12 种，`ink` 与 `black` 迁移到 `charcoal`，见 `doc/evidence/T74-night-styles.md`。本文件其余内容是 T62 完成时的记录。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：用旧版本写出的设置文件启动新版本，风格落到对应的新风格。
- 用户验收 PENDING：九种风格的取舍和配色。
