# T34 体验补全

状态：代码完成，自动化通过；原生实机 PENDING；用户验收 PENDING。

| 项 | 实现 | 自动化 |
| --- | --- | --- |
| 1 外部修改 | 未修改则自动刷新；有未保存修改绝不替换，显示持久提示和查看差异、使用磁盘版本、另存为。使用磁盘版本前先写恢复草稿 | `find-diff.test.ts`（差异算法）；流程待实测 |
| 2 局部降级 | 原始 HTML、注释、脚注进入可视化；纯文本美元符号不再触发保护；原因用可读文字并带行号；源码保护预览显示已授权本地图片 | `markdown-codec`、`markdown-preview`、`visual-roundtrip`，样本 F13 |
| 3 查找替换 | ProseMirror 装饰插件，文本模式走 textarea；组合输入期间不搜索、不替换 | `find-diff.test.ts`；IME 待实测 |
| 4 菜单 | 打开最近使用、源码/可视化切换、仅正文导出、查找 | `cargo check`；待实测 |
| 5 草稿提示 | 主窗口启动时列出草稿并提示 | 待实测 |
| 6 链接 | ⌘+点击经 `safeLinkHref` 后由 `open_external` 打开，Rust 再次校验仅 http/https/mailto；相对 `.md` 走授权流程 | `windows.rs` 测试 |
| 7 忙碌与失败 | 忙碌时给提示，保存进行中排队；保存失败、草稿失败用持久提示 | 待实测 |
| 8 交互细节 | details 外部点击和 Esc 关闭、模态焦点管理、拖动反馈、仅拖出窗口才分离、刷新目录保留旧列表、移除 400ms 去重；桌面快捷键只走原生菜单 | 待实测 |

## 策略变化

- 样本 F11（含 `<script>` 和事件属性）的声明模式由 `source-protected` 改为 `visual`。原因：Goal 要求原始 HTML 进入可视化。安全依据：Milkdown 的 `html` 节点只作为文本显示；HTML 导出未开启 `allowDangerousHtml`，由测试固定不输出 script、事件属性、`javascript:` 和 iframe。
- 编辑器加载后若发现片段与原文不一致，当前文档退回源码保护，不会以有损方式保存。
- `visual-roundtrip.test.ts` 使用真实 Milkdown schema、parser、serializer，但没有真实 DOM 和 Crepe 视图。

## 已知限制

- 代码块内的匹配可被统计和替换，但 CodeMirror 节点中不显示高亮。
- 源码模式替换使用 `setRangeText`，WebKit 中可能无法用 ⌘Z 撤销，待实测。
- 源码模式查找时焦点留在查找框，文本选区可能不可见，但会滚动到匹配位置。
- 差异对话框最多显示 2000 行变更；变更区域过大时提示无法显示。
- 文件被删除时沿用 README 既定行为，不显示顶部提示。
