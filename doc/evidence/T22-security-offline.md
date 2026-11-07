# T22 权限、内容与离线代码审查

2026-11-07。当前层级：codeComplete；完整 automatedVerified 仍需断网运行检查和路径竞态验证。

## 已检查与修复

- 所有注册的文件、目录、草稿、快照和导出命令先检查主窗口标签；文档/目录/快照使用会话不透明令牌，路径只由系统选取或从已授权目录中的条目产生。`src-tauri/capabilities/main.json` 有 `core:default` 与窗口尺寸设置权限，没有通用文件或网络插件权限。
- 普通 Markdown 读取拒绝文件及父目录符号链接替换；附件只接受受限 `assets/` 子路径并对 canonical 路径重新核查。另存仅复制图片 AST 节点引用，代码块中的同字串保持不变。草稿根目录拒绝符号链接。Rust 负例覆盖伪造令牌、非主窗口标签、`../`、文件/父目录/附件符号链接。
- 视觉编辑中的链接点击被拦截，避免主 WebView 导航到外站。HTML 导出经过 AST 渲染、rehype 净化和 CSP；原始脚本、事件属性、`javascript:`/`data:` 链接负例通过。打印 iframe 无脚本权限，仅打开系统模态打印。
- 源码扫描 `rg -n 'fetch\(|XMLHttpRequest|WebSocket|EventSource|https?://|<script[^>]+src=|@import|url\(https?://' src src-tauri/src src-tauri/tauri.conf.json index.html`：运行代码无 fetch/XHR/WebSocket/EventSource/CDN/远程字体；匹配的网络地址为 schema、开发服务器 localhost 和 Tauri IPC localhost。发行构建使用本地 `dist`，CSP 的网络连接仅允许 IPC。

## 结果与残余边界

`cargo test --manifest-path src-tauri/Cargo.toml --lib`：20/20；`npm run test -- --reporter=dot`：49/49；`npm run typecheck` 通过。尚未进行断网实机启动/保存/导出；不同进程在路径校验与实际写入间替换目录仍存在 TOCTOU 窗口，需采用目录文件描述符协调或系统文件协调后再宣称强隔离。当前不将静态扫描等同于离线运行验收。

2026-11-07 附件读取边界加固：macOS `read_asset` 现在只接受 `assets/<单个文件名>`，以目录文件描述符和 `openat(O_NOFOLLOW)` 逐级打开 `assets` 与图片，读取同一个已打开的文件句柄，并在读取前后限制 20 MB。此举消除该调用链中“解析目标路径后，读取前将附件或 `assets` 目录换成符号链接”的窗口；独立进程替换已授权父目录，以及保存/重命名/导出路径的竞态仍未解决。`libc` 锁定为已在依赖图中的 0.2.191。Rust 定向两次及全量 31/31 PASS，负例覆盖 `../`、嵌套路径、附件和目录符号链接、超限文件；arm64 构建 PASS。未运行完整离线应用工作流，T22 保持 `codeComplete`。

2026-11-07 普通 Markdown 读取链也改为从父目录句柄以 `openat(O_NOFOLLOW)` 打开目标，再从同一文件句柄完成元数据检查、限额读取和哈希计算；不再因校验 UTF‑8 复制整篇字节。Rust 全量 32/32、arm64 构建 PASS，负例覆盖文件/父目录符号链接、超限与非法 UTF‑8。此处仍未处理 `open_document` 文件选择器在调用 `read_markdown` 前的 canonicalize 行为，及父目录替换、保存等其他路径竞态；下一步审查入口授权。完整离线应用工作流尚未运行，T22 保持 `codeComplete`。

2026-11-07 授权入口审查：`open_document`、`choose_recent_file` 和 Finder/拖入意图原先先对最终文件执行 `canonicalize`，会把用户交来的文件符号链接展开，绕过后续的最终组件检查。现统一在原始路径及父目录规范化后的路径上用 `symlink_metadata` 拒绝最终文件链接，再保存规范化父目录 + 原文件名；`open_intent_document` 不再二次展开最终文件。第一次定向测试因误把 macOS `/var`→`/private/var` 的正常父目录映射也拒绝而 FAIL；修正为只拒绝最终文件符号链接、允许父目录规范化后，定向复查和全量 Rust 32/32 PASS，arm64 构建 PASS。父目录由用户显式选择的符号链接仍会解析到目标目录，未声称所有上级目录无链接；图片意图后续读取、父目录替换及写入竞态仍待审查。T22 保持 `codeComplete`。

2026-11-07 图片意图读取改用 `read_selected_image_bytes`：先确认当前选中文件为普通文件，macOS 再通过父目录句柄和 `openat(O_NOFOLLOW)` 读取同一文件句柄，限制 20 MB；后续 MIME 与图片解码校验仍在。新增正常 PNG、读取前替换为符号链接、超限文件回归。定向 1/1、Rust 全量 33/33、`./start.sh --build-only` PASS。父目录在验证与打开间替换、写入链竞态和完整离线原生工作流仍未验证，T22 维持 `codeComplete`。

2026-11-07 保存链继续加固：`fs::atomic_write::commit` 在 macOS 用 `O_NOFOLLOW` 打开旧文件，并从同一文件描述符读取内容、取得元数据与复制 ACL/扩展属性；提交前复查也用同一读取规则。新增符号链接目标不修改外部文件的负例。定向 6/6、Rust 全量 34/34、arm64 构建 PASS。最终 `hard_link`/`rename` 与非协作外部写入仍可能竞态，父目录替换亦未彻底排除；未宣称完整 TOCTOU 封闭或离线原生验收通过。

2026-11-07 原子提交的 macOS 临时文件、备份、新目标与替换改为固定目录句柄上的 `openat`/`linkat`/`renameat`/`unlinkat`；旧文件提交前复查同时核对内容 hash 与文件身份。故障注入把父目录移走并放入指向另一目录的符号链接：替换留在原目录句柄内，外部目录文件不变，返回 `COMMIT_UNCERTAIN`，避免界面误报原路径已保存。定向保存 7/7、Rust 全量 35/35、arm64 构建 PASS。首次构建仅有 `PathBuf` 未使用警告，移除后第二次构建无此警告。无法对不合作进程提供跨进程按 hash 条件替换；最终替换瞬间的外部并发、附件写入链、完整离线原生流程仍待审查/实测。T22 继续 `codeComplete`。

2026-11-07 附件写入链复核：普通保存、另存/冲突副本与 MD 资源包导出统一使用 `fs::asset_directory::AssetDirectory`。macOS 对规范化父目录打开句柄，以 `mkdirat`/`openat(O_DIRECTORY|O_NOFOLLOW)` 固定 `assets`，文件用 `openat(O_EXCL|O_NOFOLLOW)` 排他创建；现有文件从句柄限额读取并比较字节。返回前核对父目录和 `assets` 的文件身份。负例覆盖最终文件与目录符号链接、父目录被替换后外部文件不变且位置校验拒绝。首次定向编译因 `by_ref` 歧义 FAIL，修复后文档链 11/11、附件负例 2/2、Rust 全量 37/37、arm64 构建 PASS。附件与正文的跨文件原子性、校验返回后的非协作替换竞态及完整离线原生流程仍待验证；T22 保持 `codeComplete`。

同日继续审查发现 HTML 与源码 Markdown 导出在检查目标不存在后以路径式 `rename` 提交，目标若在间隙出现可能被覆盖。两处已改用 `atomic_write::commit(..., None)` 的排他新建提交规则；原子保存的“目标已存在不覆盖”负例复用，Rust 全量 37/37、arm64 构建 PASS。真实系统保存对话框和外部并发仍待集中实测。

2026-11-07 目录树新建/重命名改为固定父目录句柄与排他文件系统操作，防止父目录或目标在预检查后被链接替换而跟随/覆盖。Rust 39/39、arm64 构建 PASS；[T18 记录](T18-local-editing-gate.md)含大小写改名和负例。废纸篓仍调用按路径工作的系统 API；非协作程序在校验后替换同名源文件以及原生废纸篓行为仍需实测/进一步审查，T22 保持 `codeComplete`。

废纸篓调用进一步改为短期 `NSURL.fileReferenceURL`，校验引用当前路径、dev/inode 与父目录后再调用系统 API。代码编译和 Rust 39/39 PASS；未执行真实 Trash 操作。引用 URL 创建前的非协作替换仍有边界，不能由此宣称任意竞态已消除；T22 保持 `codeComplete`。

2026-11-07 草稿 manifest/正文/附件、目标状态、设置与最近记录读取统一使用限额文件句柄，拒绝最终符号链接并在读取前后限制字节数。此前设置/最近记录先 `fs::read` 再检查 64 KB，草稿文件先 stat 后 `fs::read`，存在替换和过量分配窗口。新增链接、超限和损坏回退负例；定向 1/1、Rust 全量 43/43、arm64 构建 PASS。草稿写入/清理与应用数据目录的父组件路径竞态仍待审查；完整离线原生流程仍未运行，T22 保持 `codeComplete`。

2026-11-07 草稿快照写入/发布改用 macOS 目录句柄：应用数据、草稿根、单稿、暂存目录通过 `openat` 固定，文件 `O_EXCL|O_NOFOLLOW` 创建，完整快照 `renameatx_np(RENAME_EXCL)` 发布；发布前后检查目录身份。目录被替换为符号链接时写入拒绝，外部目录不变，旧快照可恢复。草稿定向 5/5、Rust 44/44、arm64 构建和 ZIP 完整性 PASS。失败的暂存目录会保留且被恢复扫描忽略；读取目录链、显式丢弃、设置/最近记录父目录创建、跨文件事务和外部非协作并发仍待处理或验证；完整离线原生流程未运行，T22 仍 `codeComplete`。

2026-11-07 草稿列表、恢复读取和丢弃也改为 macOS 目录句柄操作；快照与单稿链接负例、旧快照回退及丢弃时外部文件保留通过。读取定向首次编译因 `by_ref` 歧义 FAIL，修复后定向 7/7、Rust 46/46 PASS。首次打包实际成功，但检查脚本包装命令误用 zsh 只读变量导致退出 1；第二次构建 PASS，arm64 ZIP 完整性 PASS。应用数据目录创建、跨文件事务和非协作并发仍待审查，完整离线原生工作流未运行；T22 保持 `codeComplete`。

2026-11-07 应用数据目录最终组件改用规范化父目录上的 `mkdirat/openat(O_NOFOLLOW)`，草稿、设置、最近记录共享；设置和最近记录写入另要求父目录已规范化。链接应用目录负例通过；首次全量因两项旧测试使用 macOS `/var` 别名路径而 45/47 FAIL，规范化样本路径后第二次 47/47 PASS；arm64 构建两次（首次未使用导入警告，修正后无 Rust 警告）、ZIP 完整性 PASS。T16 明示的附件先提交策略仍可能在正文失败后留下无引用附件；测试覆盖附件失败不提交缺图正文。最终非协作路径替换/并发与断网原生工作流未验证，T22 `codeComplete`。

## 代码阶段复核（2026-11-07）

本轮重新扫描 `src`、`src-tauri/src`、`tauri.conf.json` 和 `index.html` 中的 fetch/XHR/WebSocket/EventSource、远程 URL 与脚本/字体导入：运行源码没有主动网络 API、远程字体或 CDN；匹配项为 Tauri schema、开发服务器 `127.0.0.1`、IPC `ipc.localhost`、测试夹具中的示例 URL，以及本地模块入口。`src-tauri/capabilities/main.json` 只给 `main` 窗口默认与尺寸权限；已注册 Rust 命令逐项在入口检查窗口标签，文件读写还使用授权令牌/目录约束。此为静态证据，不替代断网运行、远程图片状态和实际日志检查。

当前代码阶段检查：`npm run test -- --reporter=dot` 58/58 PASS，`cargo test --lib --locked --offline` 47/47 PASS，`./start.sh --build-only` PASS，主程序 arm64，ZIP 完整且内含主程序哈希一致。剩余原生离线工作流、最终非协作并发、签名/安装和用户体验验收保持 PENDING；本项不因集中测试未开始而阻断后续开发项。

2026-11-07 应用数据读取边界补强：`fs::bounded_file::read_canonical_parent` 在 macOS 上要求规范化父目录，并通过固定目录句柄 `openat(O_NOFOLLOW)` 限额读取；读取后核对目录身份。设置和最近记录的读取及写入前版本计算均改用此入口，目录被符号链接替换时不读取外部 JSON。新增父目录与最终文件链接负例，定向 1/1、Rust 全量 48/48、arm64 构建通过。此检查不覆盖非协作进程在父目录打开前以真实目录替换原目录的竞态，也不证明原生偏好恢复或断网工作流；T22 仍 `codeComplete`。

2026-11-07 文档授权生命周期补强：旧 `DocumentStore` 在打开/另存后长期保留令牌，取消切换获得的新令牌也未回收。新增仅主窗口可调用的 `release_document`；前端在候选文档取消/准备失败时撤销候选令牌，在活动文档切换或另存后等待旧草稿写链结束再撤销旧令牌。新增“释放后旧路径不可读”负例，定向 1/1、Rust 全量 49/49、前端 58/58、arm64 构建和 manifest 核验 PASS。前端异常时序与真实多文件切换仍待原生集中验证，T22 保持 `codeComplete`。

2026-11-07 工作区条目授权收敛：重复加载同一页不再为相同路径增发令牌；关闭工作区的命令现在要求根令牌，条目令牌不能冒充根。万条目用例重复刷新后授权表为 202 项，定向 1/1、Rust 49/49、arm64 构建及 manifest PASS。仍需原生多目录/并发刷新验证。

2026-11-07 工作区授权过期清理：刷新目录时，对已不存在或类型已变化的直接子项撤销旧令牌；万条目用例证明删除一个首页文件后其令牌消失。定向 1/1、Rust 49/49、arm64 构建/manifest PASS。未证明未刷新期间的外部变更自动撤销，也未做真实 Finder 并发验收。

2026-11-07 失效子目录清理扩展到后代：父目录刷新发现子目录消失或类型变化时，撤销其整棵已授权条目；嵌套目录定向 1/1、Rust 50/50、arm64 构建/manifest PASS。未刷新期间仍依赖访问时路径检查；真实并发与 Finder 行为仍 PENDING。
