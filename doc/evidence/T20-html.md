# T20 自包含 HTML 代码阶段

2026-11-07。当前层级：automatedVerified；系统导出对话框及真实应用快照链路留待集中原生验收。

HTML 导出现在读取已注册的不可变快照，使用 GFM/remark → rehype 净化 → 完整 HTML 模板；内联正文样式与本地图片 data URL，CSP 限制默认资源，远程/缺失图片中止。图片原始字节嵌入预算 70 MB，后端 HTML 文件上限 100 MB。标题转义，危险链接、原始脚本与事件属性测试覆盖。

`npm run test -- --reporter=dot`：49/49；其中 HTML 三项测试覆盖未保存正文、内联图片、标题转义、缺图、危险 URL 和原始 HTML。`npm run build` 通过。尚未在独立浏览器搬移/断网检查或在 macOS WebView 实测真实截图，因此不标记 automatedVerified。

2026-11-07 补充 F04 引用式图片内嵌：遍历图片引用及定义，保留独立链接；图片与链接共享定义时明确报错，防止修改链接目标。HTML 新增 2 项回归，全量前端 55/55 PASS，arm64 构建 PASS。独立浏览器搬移/断网检查仍待集中测试。

2026-11-07 离线浏览器检查：`node scripts/build-html-offline-fixture.mjs` 从内存中的未落盘 Markdown、项目内 2×2 PNG 生成 `dist-package/html-offline-check/export.html`；`python3 scripts/check-html-offline.py dist-package/html-offline-check/export.html` 将它复制到临时新目录，用 macOS arm64 可用的 Google Chrome + Playwright 1.60.0 在离线 context 中打开。PASS：正文标题存在、图片自然尺寸为 2×2、原始脚本没有执行、无网络请求、无应用 UI。生成文件 1,554 字节，SHA-256 `1c1ea37f2965fc6e963853da5a230d558b32ad1970653bdc97b614ccedbda432`。复现依赖记录于 `scripts/requirements-browser-check.txt`。本检查覆盖渲染器生成的独立文件，不包含 Tauri 保存对话框、真实磁盘图片和 UI 内 `captureSnapshot` 的完整点击路径；这些留待 T26 原生验收。
