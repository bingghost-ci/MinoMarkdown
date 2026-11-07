# T23 macOS 系统入口代码阶段

2026-11-07。当前层级：codeComplete，Finder/拖入/菜单原生验收待集中执行。

- `tauri.conf.json` 为 `.md`/`.markdown` 注册替代编辑器关联。`RunEvent::Opened` 冷/热启动文件 URL 和 Rust `on_webview_event` 原生拖入路径统一进入一次性 `OpenIntent` 队列；前端就绪后取令牌，重复路径短时去重。Markdown 经未保存保护打开；图片只在可视化编辑器就绪后插入；其他扩展名被忽略。
- 原生“文件”菜单加入新建、打开文件、打开文件夹、保存、另存为，与 Cmd+N/O/S/Shift+S 共用前端操作入口，短时去重防止菜单和 WebView 键盘事件重复触发。
- 最近文件/目录保存在 AppData 版本化 `recent.json`，最多 20 项；显示失效项并可移除。点历史项只给系统选择对话框预设目录/文件名，用户重新选择后才获得文件/目录令牌；路径历史本身不授权访问。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：22/22（队列过滤/去重、最近记录损坏恢复等）；`npm run test -- --reporter=dot`：49/49；`npm run build`：通过。

未验证：实际 Finder “打开方式”冷/热启动事件、原生拖入截图/Markdown、系统菜单快捷键和最近项失效恢复。需要检查打包 `.app` 的 `Info.plist` 关联声明；构建通过不代表 LaunchServices 已注册。

2026-11-07 Finder/拖入 `OpenIntent` 不再提前展开最终文件符号链接，入队前先按 T22 的选中文件规则检查；真实普通文件仍入队，最终符号链接被拒。最近文件重新选择与普通打开入口共用规则。Rust 全量 32/32、arm64 构建通过；原生 Finder/拖入事件仍待集中实测。

2026-11-07 图片意图兑现时再次确认选中文件，macOS 从已打开的父目录句柄读取图片，拒绝被替换成符号链接的最终文件；Rust 33/33、arm64 构建通过。Finder/拖入原生流程仍待集中实测。

2026-11-07 最近记录文件的加载与写入前旧版本读取改为 64 KB 限额、不跟随最终链接的句柄；链接记录被忽略，Rust 43/43、arm64 构建通过。最近项失效/重选的原生流程仍待集中测试。

2026-11-07 G23 代码阶段复核：`RunEvent::Opened` 和主 WebView 拖入仍进入同一 `OpenIntent` 队列；前端 Markdown 意图先经 `canProceed` 保护 dirty 会话，再兑付令牌。最近记录改用统一规范化 AppData 目录，拒绝链接目录，文件写入要求规范化父目录。相关负例与 Rust 全量 47/47、前端 58/58、arm64 构建通过。Finder 冷启动、系统菜单和真实拖入仍待集中原生测试，T23 保持 `codeComplete`。

2026-11-07 根据用户界面反馈补充文件夹拖入：主 WebView 的原生 Drop 事件现可将普通目录加入一次性意图队列；前端兑换 `open_intent_workspace`，注册工作区并加载根目录树。入队和兑换时拒绝作为根的符号链接。文件夹切换不替换当前文档；Markdown 文件拖入仍走未保存检查。Rust 50/50、前端构建通过；真实 Finder 拖放行为待用户集中实测。
