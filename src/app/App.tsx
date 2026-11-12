import { useDocumentWorkspace } from './useDocumentWorkspace'
import { DiffDialog } from './components/NoticeBar'
import { FileControls } from './components/FileControls'
import { FileSidebar } from './components/FileSidebar'
import { OutlinePanel } from './components/OutlinePanel'
import { TabBar } from './components/TabBar'
import { EditorToolbar } from './components/EditorToolbar'
import { EditorBody } from './components/EditorBody'
import { DocumentRenameDialog, DraftsDialog } from './components/Dialogs'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar, VerificationPanel } from './components/StatusBar'
import { FloatingControls } from './components/FloatingControls'
import { AiConsentDialog, AiDrawer } from './components/AiDrawer'

export function App() {
  const controller = useDocumentWorkspace()
  const { latinLayout, lightbox, openBodyMenu, openImageFromClick, reading, setLightbox, settings, t } = controller
  return (
    <main className="app-shell" data-reading={reading}>
      <FileControls workspace={controller} />
      <div className="workspace-layout">
        <FileSidebar workspace={controller} />
        <section className="editor-panel" data-editor-width={settings.editorWidth} data-reading={reading} data-image-captions={settings.imageCaptions} data-script={latinLayout ? 'latin' : 'cjk'} lang={latinLayout ? 'en' : undefined} aria-label={t('Markdown 编辑区域')} onClickCapture={openImageFromClick} onContextMenu={openBodyMenu}>
          <TabBar workspace={controller} />
          <EditorToolbar workspace={controller} />
          <div className="reading-progress" aria-hidden="true" hidden={!reading}><i /></div>
          <EditorBody workspace={controller} />
          <FloatingControls workspace={controller} />
        </section>
        <OutlinePanel workspace={controller} />
        <AiDrawer workspace={controller} />
      </div>
      <StatusBar workspace={controller} />
      <DocumentRenameDialog workspace={controller} />
      <DraftsDialog workspace={controller} />
      <SettingsDialog workspace={controller} />
      <AiConsentDialog workspace={controller} />
      <DiffDialog workspace={controller} />
      <VerificationPanel workspace={controller} />
      {lightbox && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.alt || t('查看图片')} onClick={() => setLightbox(null)}><img src={lightbox.src} alt={lightbox.alt} /></div>}
    </main>
  )
}
