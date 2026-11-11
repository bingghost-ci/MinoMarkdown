import { lazy, Suspense } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { FindBar } from './FindBar'
import { NoticeBar } from './NoticeBar'
import { editSession } from '../../features/document/session'

const SourceEditorView = lazy(() => import('./SourceEditorView'))

export function EditorBody({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { scheduleDerivedRefresh, document, editorHost, onPreviewClick, previewHtml, previewPending, previewRoot, sessionRef, sourceDark, sourceEditor, sourceView, t, updateSession } = w
  return <>
          <NoticeBar workspace={w} />
          <FindBar workspace={w} />
          <div ref={editorHost} className="editor-host" hidden={document.mode !== 'visual'} />
          {document.mode === 'visual'
            ? null
            : previewPending ? <div key={document.id} className="editor-root markdown-preview" role="status">{t('正在生成预览…')}</div>
            : !sourceView && previewHtml !== null
              ? <div key={document.id} ref={previewRoot} className="editor-root markdown-preview" aria-label={t('Markdown 预览')} onClick={onPreviewClick}><article className="markdown-preview-content mino-doc" dangerouslySetInnerHTML={{ __html: previewHtml }} /></div>
              : <Suspense key={document.id} fallback={<div className="source-editor" />}><SourceEditorView editorRef={sourceEditor} text={document.sourceText} label={t('源码保护编辑区域')} dark={sourceDark} onSelect={scheduleDerivedRefresh} onChange={() => {
              if (sessionRef.current.generation === document.id) updateSession(editSession(sessionRef.current))
            }} /></Suspense>}
  </>
}
