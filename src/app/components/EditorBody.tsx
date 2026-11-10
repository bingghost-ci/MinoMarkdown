import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { FindBar } from './FindBar'
import { NoticeBar } from './NoticeBar'
import { editSession } from '../../features/document/session'

export function EditorBody({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { scheduleDerivedRefresh, document, editorHost, onPreviewClick, previewHtml, previewPending, previewRoot, sessionRef, sourceEditor, sourceView, t, updateSession } = w
  return <>
          <NoticeBar workspace={w} />
          <FindBar workspace={w} />
          <div ref={editorHost} className="editor-host" hidden={document.mode !== 'visual'} />
          {document.mode === 'visual'
            ? null
            : previewPending ? <div key={document.id} className="editor-root markdown-preview" role="status">{t('正在生成预览…')}</div>
            : !sourceView && previewHtml !== null
              ? <div key={document.id} ref={previewRoot} className="editor-root markdown-preview" aria-label={t('Markdown 预览')} onClick={onPreviewClick}><article className="markdown-preview-content" dangerouslySetInnerHTML={{ __html: previewHtml }} /></div>
              : <textarea key={document.id} ref={sourceEditor} className="source-editor" aria-label={t('源码保护编辑区域')} defaultValue={document.sourceText} onSelect={scheduleDerivedRefresh} onChange={() => {
              // Uncontrolled on purpose: writing a multi-megabyte value back on each key stalls input.
              if (sessionRef.current.generation === document.id) updateSession(editSession(sessionRef.current))
            }} />}
  </>
}
