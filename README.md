# MinoMarkdown

面向 macOS Apple Silicon 的本地 Markdown 编辑器。当前是功能开发阶段的本地测试版：代码和自动化检查已推进，Finder、中文输入、真实截图、系统 PDF、性能和用户验收将在集中实测时完成。重要文档请先保留原始副本。

## 编译与启动

需要 arm64 Node.js ≥22、Rust、Xcode Command Line Tools。当前 arm64 包声明最低 macOS 12.0；本项目只在开发机 macOS 27.0.1 上构建，较低版本的实际运行兼容性尚未验证。项目使用 `package-lock.json` 和 `src-tauri/Cargo.lock` 固定依赖。

```sh
cd /Users/bobby/Code/software/MinoMarkdown
./start.sh
```

脚本检查 Apple Silicon 工具链，先清理上次生成的 `.app`、主程序、ZIP 与 manifest，再构建未签名 `.app`、同步生成本地 ZIP 和 manifest，并打开应用。依赖编译缓存会保留。仅构建和打包：`./start.sh --build-only`。应用产物在 `src-tauri/target/release/bundle/macos/MinoMarkdown.app`；包的架构、哈希与 ZIP 对应关系见 [包 manifest](dist-package/manifest.json)。再次启动前先退出已有窗口；脚本不会结束你的会话。

## 使用

- **新建、打开、保存：** 顶部按钮或文件菜单；`⌘N`、`⌘O`、`⌘S`。首次保存由系统选择位置。编辑时标题显示“未保存”；未保存切换会询问保存、放弃或取消。
- **文件夹：** 启动后左侧一直显示文件资源管理器。点击“打开文件夹”，或从 Finder 把文件夹拖到应用窗口，左侧即可逐级展开目录并点击 `.md`/`.markdown` 文件打开。大目录按页加载。可新建 Markdown、创建目录、重命名并把文件或空目录移到系统废纸篓。最近使用只保存路径提示，重新打开仍要经过系统选择器。
- **编辑：** 工具栏提供段落、标题、强调、列表、引用、代码、表格、链接、图片和撤销重做。无法安全可视化的 Markdown 使用源码保护模式，保留原文。
- **图片：** 可选取、粘贴或拖入 PNG/JPEG/WebP/GIF。保存时图片写入文档旁的 `assets/`，Markdown 记录相对引用。不要在文件管理器中单独删除仍被文档引用的附件。
- **导出：** 顶部“更多操作”中，“导出 MD + 图片”产生 Markdown 与资源目录；“仅正文 MD”会用明确占位替代图片；HTML 自包含图片并净化不可信标记；“打印 / 存储为 PDF”打开系统打印对话框，是否生成 PDF 由你在系统对话框中决定。
- **恢复与冲突：** 未保存的编辑会写入应用数据目录草稿，重启后可预览、恢复为新文档或显式丢弃。磁盘文件被外部改变时会提示查看版本、保存本地副本或重新加载。恢复草稿不会直接覆盖原文件。
- **外观：** “外观”选择跟随系统、浅色或深色；侧栏宽度和窗口大小保存到本机设置。

## 当前限制

单篇 Markdown 上限 20 MiB；超过 5 MiB 时进入可编辑的源码保护模式，HTML/PDF 暂不可导出。单张图片上限 20 MiB / 4000 万像素；图片总量和导出快照有预算。只读/符号链接等超出授权范围的路径会拒绝打开。目录操作不提供永久删除，也不递归移动非空目录。首次本地包未做 Developer ID 签名、公证或对外发布。草稿使用防抖快照，异常断电前最后短暂输入可能尚未落盘；请经常保存重要内容。

## 开发与状态

```sh
npm ci --no-audit --no-fund
npm run archcheck
npm run typecheck
npm run test
cargo test --lib --manifest-path src-tauri/Cargo.toml
./start.sh --build-only
```

[方案、技术设计、开发计划与 Goal](doc/README.md) · [当前进度和验收边界](doc/06-开发进度.md) · [验收步骤](doc/05-验收与发布.md)

## 维护与依赖

`npm ci` 应使用项目锁文件；若架构检查失败，先运行 `npm run archcheck` 核对 Node、Rust 与 Tauri CLI 是否都为 arm64。构建错误先看 `npm run typecheck` 和 `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` 的具体输出。不要把未签名本地测试包当作已公证安装包。

第三方依赖元数据见 [npm 许可证表](doc/evidence/dependency-licenses.tsv) 和 [macOS arm64 Rust 许可证表](doc/evidence/rust-dependency-licenses.tsv)。Rust 表可用 `python3 scripts/generate-rust-license-inventory.py` 从锁文件离线重建。两张表仅是依赖元数据清单；对外分发前还需核对实际随包资源的许可文本、notices 与项目自身的授权方式。

本地已取得的第三方许可原文与缺失项见 [T28 许可审查](doc/evidence/T28-license-text-audit.md)；可用 `python3 scripts/generate-license-text-bundle.py --verify` 对照当前安装依赖复核。项目自身的许可尚未确定，这份审查资料不在当前 `.app`/ZIP 中。
