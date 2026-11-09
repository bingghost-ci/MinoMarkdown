import { useDocumentWorkspace } from './useDocumentWorkspace'
import { DiffDialog } from './components/NoticeBar'
import { FileControls } from './components/FileControls'
import { FileSidebar } from './components/FileSidebar'
import { TabBar } from './components/TabBar'
import { EditorToolbar } from './components/EditorToolbar'
import { EditorBody } from './components/EditorBody'
import { TabContextMenu, DraftsDialog, SettingsDialog } from './components/Dialogs'
import { StatusBar, VerificationPanel } from './components/StatusBar'

export function App() {
  const controller = useDocumentWorkspace()
  const { setTabMenu, settings, t, tabMenu } = controller
  return (
    <main className="app-shell" onClick={() => { if (tabMenu) setTabMenu(null) }}>
      <FileControls workspace={controller} />
      <div className="workspace-layout">
        <FileSidebar workspace={controller} />
        <section className="editor-panel" data-editor-width={settings.editorWidth} aria-label={t('Markdown 编辑区域')}>
          <TabBar workspace={controller} />
          <EditorToolbar workspace={controller} />
          <EditorBody workspace={controller} />
        </section>
      </div>
      <StatusBar workspace={controller} />
      <TabContextMenu workspace={controller} />
      <DraftsDialog workspace={controller} />
      <SettingsDialog workspace={controller} />
      <DiffDialog workspace={controller} />
      <VerificationPanel workspace={controller} />
    </main>
  )
}
