# T33 编辑器结构

状态：代码完成，自动化通过；原生实机 PENDING；用户验收 PENDING。

- `App.tsx` 由约 1400 行缩到约 30 行，逻辑在 `src/app/useDocumentWorkspace.ts`，界面在 `src/app/components/`。输入时 `updateSession` 只在可见状态变化时 `setSession`。
- 标签状态验证结论：未能在 WebKit 中验证替换 Crepe 内部 ProseMirror 状态是否可靠，因此按 Goal 备选方案使用限量隐藏编辑器实例（`editorPool.ts`，最多 5 个）。超出上限的标签重新打开时不保留撤销历史。
- 导出和预览代码按需加载；KaTeX 资源 59 → 0；生产包不含测试样本（仅开发态 `import.meta.glob`）。
- 窗口以 `visible: false` 创建，设置应用后显示；若 webview 4 秒内未就绪，兜底显示。

自动化：`editor-pool.test.ts`、构建产物检查。未验证：撤销/光标/滚动保留、启动无闪烁，均 PENDING。
