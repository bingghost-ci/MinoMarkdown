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

- **启动与退出：** 启动后直接打开可编辑的“未命名”文档，不显示居中的打开提示。未命名文档修改后退出会询问保存、放弃或取消；已绑定磁盘文件的文档在关闭窗口或退出时尝试自动保存。保存失败或发现磁盘冲突时保留窗口与修改内容。
- **新建、打开、保存：** 使用 macOS 菜单栏“文件”菜单；`⌘N`、`⌘O`、`⌘S`。首次保存由系统选择位置。文件操作栏默认隐藏，可在“视图”菜单或应用“设置”中显示。
- **单篇文档：** 可从 Finder 将 `.md` 或 `.markdown` 文件拖到窗口任意位置，或点“打开文件”；无需先选择文件夹。打开的文档显示在右侧标签栏。
- **文件夹：** 左侧文件资源管理器可逐级展开目录并点击 `.md`/`.markdown` 文件打开，也可从 Finder 拖入文件夹。大目录按页加载。文件栏底部可新建 Markdown；创建目录、重命名和移入系统废纸篓在目录操作菜单中。
- **多文档与窗口：** 打开或新建文档会生成 Tab。右键 Tab 可移到新窗口，或关闭当前、右边、全部文档；拖动 Tab 可排序，拖出窗口边缘可成为独立窗口。“文件 > 新建窗口”、`⌘⇧N` 或 Dock 图标右键的“新建窗口”均会打开带“未命名”文档的新窗口。重新启动不自动恢复上次的 Tab。Dock 图标右键列出最近打开的文件和各窗口当前选中的文档。
- **编辑：** 正文上方工具栏集中显示常用格式，其他格式、表格和图片操作在“更多格式”菜单中；插入表格时可在网格中拖选列数和行数，斜杠命令中的表格入口也使用同一选择器。右侧“居中 / 宽屏”按钮切换正文宽度，选择会保存在本机设置。支持段落、标题、强调、列表、引用、代码、表格、链接、图片和撤销重做。无法安全可视化的 Markdown 使用源码保护模式，保留原文。
- **图片：** 可选取、粘贴或拖入 PNG/JPEG/WebP/GIF。保存时图片写入文档旁的 `assets/`，Markdown 记录相对引用。不要在文件管理器中单独删除仍被文档引用的附件。
- **导出：** 顶部“更多操作”中，“导出 MD + 图片”产生 Markdown 与资源目录；“仅正文 MD”会用明确占位替代图片；HTML 自包含图片并净化不可信标记；“打印 / 存储为 PDF”打开系统打印对话框，是否生成 PDF 由你在系统对话框中决定。
- **恢复与冲突：** 未保存的编辑会写入应用数据目录草稿。需要时从“文件 > 恢复草稿…”预览、恢复为新文档或显式丢弃；启动时不会弹出草稿横幅。磁盘文件被外部改变时会提示查看版本、保存本地副本或重新加载。恢复草稿不会直接覆盖原文件。
- **语言、外观与设置：** 应用程序菜单中的“设置…”分为外观、编辑器和工作区。可切换中文或 English，选择跟随系统、浅色、深色、暖纸、石墨主题，调整正文字体、字号、行距和显示宽度，控制文件栏与文件操作栏显示；底部也可切换主题。这些偏好保存在本机设置，切换语言会同步更新已打开窗口的界面与应用菜单。

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

[方案、技术设计、开发计划与 Goal](doc/README.md) · [界面重设计与截图](doc/07-界面重设计.md) · [当前进度和验收边界](doc/06-开发进度.md) · [验收步骤](doc/05-验收与发布.md)

## 维护与依赖

`npm ci` 应使用项目锁文件；若架构检查失败，先运行 `npm run archcheck` 核对 Node、Rust 与 Tauri CLI 是否都为 arm64。构建错误先看 `npm run typecheck` 和 `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` 的具体输出。不要把未签名本地测试包当作已公证安装包。

第三方依赖元数据见 [npm 许可证表](doc/evidence/dependency-licenses.tsv) 和 [macOS arm64 Rust 许可证表](doc/evidence/rust-dependency-licenses.tsv)。Rust 表可用 `python3 scripts/generate-rust-license-inventory.py` 从锁文件离线重建。两张表仅是依赖元数据清单；对外分发前还需核对实际随包资源的许可文本、notices 与项目自身的授权方式。

本地已取得的第三方许可原文与缺失项见 [T28 许可审查](doc/evidence/T28-license-text-audit.md)；可用 `python3 scripts/generate-license-text-bundle.py --verify` 对照当前安装依赖复核。项目自身的许可尚未确定，这份审查资料不在当前 `.app`/ZIP 中。
