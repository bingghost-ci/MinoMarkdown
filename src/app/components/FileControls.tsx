import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { Code2, Download, FileText, FolderOpen, MoreHorizontal, PanelLeft, Plus, Printer, Save } from 'lucide-react'

export function FileControls({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { busy, chooseWorkspace, desktop, document, exportPage, exportSnapshotMD, newDocument, openDocument, saveDocument, updateSettings, settings, sidebarOpen, switchToSource, switchToVisual, t } = w
  return <>
      {settings.showFileToolbar && <div className="file-controls" aria-label={t('文档操作')}>
        <button type="button" className="icon-button sidebar-toggle" onClick={() => updateSettings((current) => ({ showSidebar: !current.showSidebar }))} aria-expanded={sidebarOpen} aria-controls="document-sidebar" aria-label={sidebarOpen ? t('隐藏文件栏') : t('显示文件栏')} title={sidebarOpen ? t('隐藏文件栏') : t('显示文件栏')}><PanelLeft aria-hidden="true" /></button>
        <span className="control-divider" aria-hidden="true" />
        <button type="button" className="control-button" onClick={() => void chooseWorkspace()} disabled={!desktop || busy}><FolderOpen aria-hidden="true" />{t('打开文件夹')}</button>
        <button type="button" className="control-button" onClick={() => void openDocument()} disabled={!desktop || busy}><FileText aria-hidden="true" />{t('打开文件')}</button>
        <button type="button" className="control-button" onClick={() => void newDocument()} disabled={busy}><Plus aria-hidden="true" />{t('新建')}</button>
        <span className="control-spacer" />
        <button type="button" className="control-button save-button" onClick={() => void saveDocument()} disabled={!desktop || busy}><Save aria-hidden="true" />{t('保存')} <kbd>⌘S</kbd></button>
        <details className="more-actions"><summary aria-label={t('文档更多操作')} title={t('文档更多操作')}><MoreHorizontal aria-hidden="true" /></summary><div className="more-actions-menu">
          <button type="button" onClick={() => void saveDocument(true)} disabled={!desktop || busy || !document.token}><Save aria-hidden="true" />{t('另存为')}</button>
          {document.mode === 'visual'
            ? <button type="button" onClick={switchToSource} disabled={busy}><Code2 aria-hidden="true" />{t('源码模式')}</button>
            : <button type="button" onClick={() => void switchToVisual()} disabled={busy}><FileText aria-hidden="true" />{t('可视化模式')}</button>}
          <div className="menu-separator" />
          <button type="button" onClick={() => void exportPage('html')} disabled={!desktop || busy}><Download aria-hidden="true" />{t('导出 HTML')}</button>
          <button type="button" onClick={() => void exportPage('print')} disabled={!desktop || busy}><Printer aria-hidden="true" />{t('打印 / PDF')}</button>
          {document.mode === 'visual' && <button type="button" onClick={() => void exportSnapshotMD(false)} disabled={!desktop || busy}><Download aria-hidden="true" />{t('导出 MD + 图片')}</button>}
          <button type="button" onClick={() => void exportSnapshotMD(true)} disabled={!desktop || busy}><Download aria-hidden="true" />{t('仅正文 MD')}</button>
        </div></details>
      </div>}
  </>
}
