import { useDocumentWorkspace } from './useDocumentWorkspace'
import { DiffDialog } from './components/NoticeBar'
import { FileControls } from './components/FileControls'
import { FileSidebar } from './components/FileSidebar'
import { OutlinePanel } from './components/OutlinePanel'
import { TabBar } from './components/TabBar'
import { EditorToolbar } from './components/EditorToolbar'
import { EditorBody } from './components/EditorBody'
import { TabContextMenu, DraftsDialog } from './components/Dialogs'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar, VerificationPanel } from './components/StatusBar'

export function App() {
  const controller = useDocumentWorkspace()
  const { lightbox, openImageFromClick, reading, setLightbox, setTabMenu, settings, t, tabMenu } = controller
  return (
    <main className="app-shell" onClick={() => { if (tabMenu) setTabMenu(null) }}>
      <FileControls workspace={controller} />
      <div className="workspace-layout">
        <FileSidebar workspace={controller} />
        <section className="editor-panel" data-editor-width={settings.editorWidth} data-reading={reading} data-image-captions={settings.imageCaptions} aria-label={t('Markdown 编辑区域')} onClickCapture={openImageFromClick}>
          <TabBar workspace={controller} />
          <EditorToolbar workspace={controller} />
          <div className="reading-progress" aria-hidden="true" hidden={!reading}><i /></div>
          <EditorBody workspace={controller} />
        </section>
        <OutlinePanel workspace={controller} />
      </div>
      <StatusBar workspace={controller} />
      <TabContextMenu workspace={controller} />
      <DraftsDialog workspace={controller} />
      <SettingsDialog workspace={controller} />
      <DiffDialog workspace={controller} />
      <VerificationPanel workspace={controller} />
      {lightbox && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.alt || t('查看图片')} onClick={() => setLightbox(null)}><img src={lightbox.src} alt={lightbox.alt} /></div>}
    </main>
  )
}
