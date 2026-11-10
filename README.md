# Mino

面向 macOS Apple Silicon 的本地 Markdown 编辑器。当前是功能开发阶段的本地测试版：代码和自动化检查已推进，Finder、中文输入、真实截图、系统 PDF、性能和用户验收将在集中实测时完成。重要文档请先保留原始副本。

## 编译与启动

需要 arm64 Node.js ≥22、Rust、Xcode Command Line Tools。当前 arm64 包声明最低 macOS 12.0；本项目只在开发机 macOS 27.0.1 上构建，较低版本的实际运行兼容性尚未验证。项目使用 `package-lock.json` 和 `src-tauri/Cargo.lock` 固定依赖。

```sh
cd /Users/bobby/Code/software/MinoMarkdown
./start.sh
```

`start.sh` 调用 `build.sh` 后打开应用，再次启动前先退出已有窗口。应用产物在 `src-tauri/target/release/bundle/macos/Mino.app`，包的架构、哈希与 ZIP 对应关系见 [包 manifest](dist-package/manifest.json)。

- `./build.sh`：清理上次的构建输出，按锁定版本补齐缺失的依赖，构建未签名 `.app`，生成并核验 ZIP 和 manifest。不改版本号，保留依赖和 Cargo 编译缓存。
- `./install.sh`：补丁版本号加 1，调用 `build.sh`，核验产物后安装到 `/Applications` 并启动。旧版本在运行时会先请求正常退出，未保存的文档由应用提示，脚本不会强杀。安装后提交版本文件、打 `v版本号` 标签并推送当前分支和标签，把符号压缩到项目的 `Symbols/`，最后删除 `src-tauri/target/debug`、`src-tauri/target/release` 和本地 ZIP、manifest。安装完成前失败或按 Ctrl-C 会恢复版本号和原来的应用。

`Symbols/` 不进 Git，只保留最新一次安装的 release 符号，每次整体覆盖：`release-symbols.zip` 内含 Rust dSYM 和前端 source map，`build-info.txt` 记录版本、提交、分支、工作区状态和工具链版本。旧版本需要调试时，从对应 tag 重新构建。`install.sh` 清理后，下一次构建要全量编译 Rust 依赖。

## 使用

- **启动与退出：** 启动后直接打开可编辑的“未命名”文档，不显示居中的打开提示。未命名文档修改后退出会询问保存、放弃或取消；已绑定磁盘文件的文档在关闭窗口或退出时尝试自动保存。保存失败或发现磁盘冲突时保留窗口与修改内容。
- **新建、打开、保存：** 使用 macOS 菜单栏“文件”菜单；`⌘N`、`⌘O`、`⌘S`，“打开最近使用”列出最近的文件和文件夹。首次保存由系统选择位置。文件操作栏默认隐藏，可在“视图”菜单或应用“设置”中显示。
- **单篇文档：** 可从 Finder 将 `.md` 或 `.markdown` 文件拖到窗口任意位置，或点“打开文件”；无需先选择文件夹。打开的文档显示在右侧标签栏。
- **文件夹：** 左侧文件资源管理器可逐级展开目录并点击 `.md`/`.markdown` 文件打开，也可从 Finder 拖入文件夹。大目录按页加载。文件栏底部可新建 Markdown；创建目录、重命名和移入系统废纸篓在目录操作菜单中。
- **多文档与窗口：** 打开或新建文档会生成 Tab。右键 Tab 可移到新窗口，或关闭当前、右边、全部文档；拖动 Tab 可排序，拖出窗口后松开成为独立窗口。“文件 > 新建窗口”、`⌘⇧N` 或 Dock 图标右键的“新建窗口”均会打开带“未命名”文档的新窗口。默认重新启动不恢复上次的 Tab，可在设置的工作区页开启“恢复上次打开的文档”。Dock 图标右键列出最近打开的文件和各窗口当前选中的文档。
- **编辑与阅读：** 正文上方工具栏集中显示常用格式，其他格式、表格和图片操作在“更多格式”菜单中；插入表格时可在网格中拖选列数和行数，斜杠命令中的表格入口也使用同一选择器。右侧“居中 / 宽屏”按钮切换正文宽度，选择会保存在本机设置。支持段落、标题、强调、列表、引用、代码、表格、链接、图片和撤销重做。原始 HTML、HTML 注释和脚注在可视化模式中作为不执行的原文保留。`⌘F` 查找和替换。`⌘+点击` 用系统浏览器打开网页和邮件链接，文档内相对链接仍在应用内打开。“视图”菜单可切换源码和可视化模式。数学公式、扩展指令等无法安全可视化编辑的 Markdown 默认显示净化后的阅读预览，状态栏说明原因和位置，可切换“编辑源码”并原样保存；预览显示已授权的本地图片，不会执行原始 HTML 或加载远程图片。
- **图片：** 可选取、粘贴或拖入 PNG/JPEG/WebP/GIF。保存时图片写入文档旁的 `assets/`，Markdown 记录相对引用。不要在文件管理器中单独删除仍被文档引用的附件。
- **导出：** 顶部“更多操作”中，“导出 MD + 图片”产生 Markdown 与资源目录；“仅正文 MD”会用明确占位替代图片；HTML 自包含图片并净化不可信标记；“打印 / 存储为 PDF”打开系统打印对话框，是否生成 PDF 由你在系统对话框中决定。
- **恢复与磁盘变化：** 未保存的编辑会写入应用数据目录草稿。启动时发现可恢复草稿会主动提示，也可从“文件 > 恢复草稿…”预览、恢复为新文档或显式丢弃。磁盘文件被外部修改后，没有未保存修改的文档自动加载最新版本；有未保存修改时绝不替换编辑内容，提示中可查看差异、使用磁盘版本（未保存内容先留作恢复草稿）或另存为。文件被删除时保留窗口内容，不显示顶部提示，也不覆盖原路径。
- **语言、外观与设置：** 应用程序菜单中的“设置…”分为外观、编辑器和工作区。可切换中文或 English，选择跟随系统、浅色、深色、暖纸、石墨、科技蓝白、淡绿色、淡黄色、水墨屏主题。字体卡片提供苹方、宋体、楷体、微软雅黑、Georgia、Avenir Next 等选项与适用建议；微软雅黑需本机安装，缺失时回退到苹方。还可调整字号、行距、正文宽度和文件栏显示。设置自动保存到 macOS 应用数据目录中的 `settings.json`，底部也可切换主题。

## 当前限制

单篇 Markdown 上限 20 MiB；超过 2 MiB 时进入可编辑的源码保护模式，可导出 HTML/PDF，原始 HTML 会被净化并提示。单张图片上限 20 MiB / 4000 万像素；图片总量和导出快照有预算。只读/符号链接等超出授权范围的路径会拒绝打开。目录操作不提供永久删除，也不递归移动非空目录。首次本地包未做 Developer ID 签名、公证或对外发布。草稿使用防抖快照，异常断电前最后短暂输入可能尚未落盘；请经常保存重要内容。

## 开发与状态

```sh
npm ci --no-audit --no-fund
npm run archcheck
npm run typecheck
npm run test
cargo test --lib --manifest-path src-tauri/Cargo.toml
./build.sh
```

[方案、技术设计、开发计划与 Goal](doc/README.md) · [界面重设计与截图](doc/07-界面重设计.md) · [当前进度和验收边界](doc/06-开发进度.md) · [验收步骤](doc/05-验收与发布.md)

## 维护与依赖

`npm ci` 应使用项目锁文件；若架构检查失败，先运行 `npm run archcheck` 核对 Node、Rust 与 Tauri CLI 是否都为 arm64。构建错误先看 `npm run typecheck` 和 `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` 的具体输出。不要把未签名本地测试包当作已公证安装包。

第三方依赖元数据见 [npm 许可证表](doc/evidence/dependency-licenses.tsv) 和 [macOS arm64 Rust 许可证表](doc/evidence/rust-dependency-licenses.tsv)。Rust 表可用 `python3 scripts/generate-rust-license-inventory.py` 从锁文件离线重建。两张表仅是依赖元数据清单；对外分发前还需核对实际随包资源的许可文本、notices 与项目自身的授权方式。

本地已取得的第三方许可原文与缺失项见 [T28 许可审查](doc/evidence/T28-license-text-audit.md)；可用 `python3 scripts/generate-license-text-bundle.py --verify` 对照当前安装依赖复核。项目自身的许可尚未确定，这份审查资料不在当前 `.app`/ZIP 中。
