# T05 / G05 HTML 与 PDF 代码阶段

日期：2026-11-07（Asia/Bangkok）  
阶段：代码先行；目标 `nativeVerified` 尚未达到。

## 已实现

- 从编辑器同步捕获当前 Markdown，再异步读取该快照引用的图片；保存按钮不参与导出，未保存文字也进入导出输入。
- Markdown 经 remark/GFM 转换、rehype 净化为完整 HTML；HTML 仅包含固定本地样式与已解析图片的 data URL，未解析/远程图片使导出失败，不静默输出不完整图片。禁用脚本与外部字体的 CSP 写入 HTML。
- 原生 HTML 保存对话框由 Rust 打开，正文以临时文件写入。取消时不报告成功，目标存在时拒绝无提示覆盖。
- PDF 入口建立只含正文的打印 iframe，等待字体与图片就绪后调用系统打印。界面只说“已打开打印对话框”，不声明 PDF 文件已保存。

## 自动化结果

- `npm run typecheck`：PASS。
- `npm run test`：37 项 PASS，其中 2 项检查当前内容和本地图片内嵌、危险链接/缺失图片处理。
- `./start.sh --build-only`：PASS，11.97 MiB 未签名 arm64 `.app`，主可执行文件 SHA-256 `7c785249404df323cf9a01d8e21e81ca894e237e8dcb530eeb7bf016666acc6d`。

## 集中验收与后续代码

未运行原生 HTML 搬移断网检查、真实系统打印/PDF 中文选择与分页检查。当前 iframe 打印入口需要在实际 macOS WebView 中验证；若不可用，T21 改为受限的独立打印 WebView。多资源不可变作业注册表和跨会话隔离留待 T19–T21。没有实际 PDF 样本，不能把 T05 或 GATE-1 标为通过。

2026-11-07 HTML 与源码 Markdown 导出后端改用 `atomic_write::commit(..., None)`，由排他链接提交避免目标在对话框返回后新出现时被路径式 `rename` 覆盖。Rust 37/37、arm64 构建通过；原生系统对话框仍待集中实测。
