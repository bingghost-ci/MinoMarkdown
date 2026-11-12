import { lazy, Suspense } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { FindBar } from './FindBar'
import { NoticeBar } from './NoticeBar'
import { editSession } from '../../features/document/session'

const SourceEditorView = lazy(() => import('./SourceEditorView'))
// PDF.js is large and only a PDF needs it.
const PdfView = lazy(() => import('../../features/pdf/PdfView'))

export function EditorBody({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { scheduleDerivedRefresh, document, editorHost, isPdf, onPreviewClick, pdfBridge, plain, previewHtml, previewPending, previewRoot, reading, sessionRef, sourceDark, sourceEditor, sourceView, t, updateSession } = w
  return <>
          <NoticeBar workspace={w} />
          <FindBar workspace={w} />
          <div ref={editorHost} className="editor-host" hidden={document.mode !== 'visual'} />
          {document.mode === 'visual'
            ? null
            : isPdf ? pdfBridge && <Suspense key={document.id} fallback={<div className="editor-root markdown-preview" role="status">{t('正在打开 PDF…')}</div>}><PdfView bridge={pdfBridge} name={document.name} dark={sourceDark} t={t} /></Suspense>
            : previewPending ? <div key={document.id} className="editor-root markdown-preview" role="status">{t('正在生成预览…')}</div>
            : !sourceView && previewHtml !== null
              ? <div key={document.id} ref={previewRoot} className="editor-root markdown-preview" aria-label={plain ? t('文档预览') : t('Markdown 预览')} data-kind={document.kind} onClick={onPreviewClick}><article className="markdown-preview-content mino-doc" dangerouslySetInnerHTML={{ __html: previewHtml }} /></div>
              : <Suspense key={document.id} fallback={<div className="source-editor" />}><SourceEditorView editorRef={sourceEditor} text={document.sourceText} label={plain ? t('文本编辑区域') : t('源码保护编辑区域')} fileName={plain ? document.name : undefined} readOnly={plain && reading} dark={sourceDark} onSelect={scheduleDerivedRefresh} onChange={() => {
              if (sessionRef.current.generation === document.id) updateSession(editSession(sessionRef.current))
            }} /></Suspense>}
  </>
}
