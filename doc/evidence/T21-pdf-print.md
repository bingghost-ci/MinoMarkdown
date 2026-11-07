# T21 系统打印与 PDF 代码阶段

2026-11-07。当前层级：codeComplete，nativeVerified 待集中实测。

打印使用与 HTML 导出相同的固定、净化、内嵌图片快照，在独立 `srcdoc` iframe 中等待页面载入、字体和图片解码，再调用系统 `print()`。iframe 仅开放同源访问和模态打印能力，不开放脚本；打印页使用 A4、18 mm 页边距、表头重复、长代码可跨页和图片尺寸限制。调用后只报告已交给系统打印，应用不声称 PDF 文件已生成或知道其最终路径。

`npm run test -- --reporter=dot`：49/49（包含打印样式模板断言）；`npm run build` 通过。系统打印对话框是否实际弹出、中文字体可选、分页/长表格/图片和用户选择“存储为 PDF”结果需集中原生验收。

打印 iframe 增加 `allow-modals` 的依据：[HTML Standard 的 sandboxed modals flag](https://html.spec.whatwg.org/dev/browsers.html) 与 [MDN iframe sandbox 文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。
