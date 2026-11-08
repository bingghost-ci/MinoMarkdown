# T23 多窗口、Dock 与草稿入口复核

日期：2026-11-08。环境：macOS Apple Silicon，本地未签名 arm64 包。测试文件位于 `/tmp/mino-window-verify.md`，没有修改用户文档。

## 实现

- 侧栏删除最近使用和单独打开列表；已打开文档仅在 Tab 显示。
- `main`、`workspace-*` 窗口分别保存 Tab 与目录状态；原生菜单事件、Finder 打开意图和拖放意图按窗口投递。
- `⌘⇧N` /“文件 > 新建窗口”创建空窗口；Tab 右键“移到新窗口”以及拖出窗口边缘创建独立窗口。窗口标题随选中 Tab 更新。
- 最近打开的文件登记给 macOS 文档控制器，由系统 Dock 菜单显示；重启不恢复 Tab。草稿列表只在“文件 > 恢复草稿…”打开时读取。
- 关闭单个窗口不退出其他窗口；最后一个工作窗口关闭时退出应用。

## 验证

1. 原生菜单新建第二窗口后，两窗口并存。通过菜单在其中一个窗口新建文档，另一窗口仍为 `MinoMarkdown` 空页面。
2. 分别关闭两个窗口：关闭第一个时进程仍在；关闭最后一个后进程退出。
3. 打开测试 Markdown 后窗口标题变为 `mino-window-verify.md`；Dock 图标右键同时显示最近文件和窗口条目。点击 Dock 最近文件可在运行中的程序里重新打开。
4. 关闭全部窗口并冷启动 `open -a MinoMarkdown.app /tmp/mino-window-verify.md`，文件成功打开；普通启动时仅出现空白窗口，Dock 最近文件仍保留。
5. Tab 右键“移到新窗口”成功出现独立窗口；从 Tab 拖出 WebView 上边缘成功出现第二窗口。早期 HTML 原生拖放在 WebKit 中未触发，改为指针捕获和边缘判定后成功。
6. `npm run typecheck` PASS；`cargo test --lib --locked --offline -q` 52/52 PASS；`./start.sh --build-only` PASS，arm64 `.app` 与 ZIP manifest 校验 PASS；`git diff --check` PASS。

## 尚待用户验收

未在真实含未保存图片的文档上逐项检查跨窗口迁移、多个工作区并行、所有菜单焦点切换及 Dock 视觉效果。草稿入口和无自动横幅已按代码实现，需用户在日常文档中确认交互感受。
