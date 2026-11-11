# T66 随包开源中文字体扩充

日期：2026-11-11。层级：codeComplete，automatedVerified；原生实机验证 PENDING，用户验收 PENDING。

## 实现

随包中文字体现为五款，全部是允许随应用再分发的开源字体：

| 字体 | 来源 | 许可 | 大小 |
| --- | --- | --- | --- |
| 思源宋体 | `@fontsource/noto-serif-sc` 5.3.1（原有） | OFL 1.1 | 6.14 MiB |
| 霞鹜文楷 | `@fontsource/lxgw-wenkai` 5.3.0（原有） | OFL 1.1 | 14.04 MiB |
| 思源黑体 | `@fontsource/noto-sans-sc` 5.3.1（新增） | OFL 1.1 | 4.65 MiB |
| 朱雀仿宋 | `src/assets/fonts/zhuque-fangsong/`（新增，上游发布的预览版） | OFL 1.1 | 4.58 MiB |
| 寒蝉活宋体 | `src/assets/fonts/chill-huosong/`（新增） | OFL 1.1 | 11.99 MiB |

- 非 npm 的两款各带 `LICENSE.txt` 和 `README.md`（来源地址、版本、转换方式）。清单见 `doc/evidence/bundled-font-licenses.tsv`，并已进入 `dependency-licenses.tsv` 与 `third-party-license-file-index.tsv`。
- 没有随包任何商业字体。苹方只按名字引用系统已装的字体。
- **未收录的候选：** 霞鹜新晰黑（基于 IPA 字体许可，再分发条件与 OFL 不同，未采用）；汇文明朝体、京华老宋体（找不到可核对的一手授权声明）。
- 朱雀仿宋、寒蝉活宋没有 Unicode 分片，是单个文件；寒蝉活宋超过导出 HTML 的 6 MiB 字体预算，导出 HTML 时改用系统字体回退并提示，PDF 不受影响。

## 自动化验证

`tests/reading-fonts.test.ts`（18 项）：注册表里的每款字体都有文件、只有 woff2、合计不超过 48 MiB（实际 42.42 MiB）；字体栈顺序；`facesForText` 按文档用到的字符挑分片。`vite.config.ts` 的构建检查在超出预算或出现 woff、ttf、otf 时使构建失败。

## 样张

`doc/evidence/reading/T68-font-panel.jpg`（中文页签列出全部选项）。

## 检查

2026-11-11，全部改动完成后在同一工作区运行：

- `npm run typecheck`：PASS。
- `npm run test`：40 个文件、431 项 PASS，1 项样张生成测试默认跳过。
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`：94 项 PASS，2 项忽略（一项会写入登录钥匙串，一项是工作区搜索计时）。
- `npm run build`：PASS。
- `npm run tauri -- build --bundles app`：PASS，`Mino.app` 60.94 MiB，arm64，未签名。

## PENDING

- 实机 PENDING：五款字体在应用内逐一显示正确，粗体和斜体可辨；断网时可用。
- 实机 PENDING：朱雀仿宋是预览版，缺字时回退到系统字体的观感。
- 用户验收 PENDING：字体数量和选择是否够用。
