import { FocusTrap } from './FocusTrap'
import { errorText, type DocumentWorkspace } from '../useDocumentWorkspace'
import { X } from 'lucide-react'

/** Renames an open document's file, from its tab or the body's right-click menu (T105). */
export function DocumentRenameDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { confirmDocumentRename, documentRename, setDocumentRename, t } = w
  if (!documentRename) return null
  const close = () => setDocumentRename(null)
  return <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="drafts-dialog rename-dialog" role="dialog" aria-modal="true" aria-label={t('重命名文档')}>
      <div className="settings-title"><h2>{t('重命名文档')}</h2><button type="button" aria-label={t('取消')} onClick={close}><X aria-hidden="true" /></button></div>
      <label className="rename-field">{t('新名称')}<input autoFocus value={documentRename.name} spellCheck={false} onFocus={(event) => { const dot = event.target.value.lastIndexOf('.'); event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length) }} onChange={(event) => setDocumentRename({ ...documentRename, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void confirmDocumentRename(); if (event.key === 'Escape') close() }} /></label>
      <div className="settings-actions"><button type="button" onClick={close}>{t('取消')}</button><button type="button" disabled={!documentRename.name.trim()} onClick={() => void confirmDocumentRename()}>{t('确定')}</button></div>
    </section>
  </div></FocusTrap>
}

export function DraftsDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { busy, discardDraft, draftPreview, drafts, draftsOpen, previewDraft, recoverDraft, setDraftsOpen, setStatus, t } = w
  return <>
      {draftsOpen && <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftsOpen(false) }}><section className="drafts-dialog" role="dialog" aria-modal="true" aria-label={t('恢复草稿')}><div className="settings-title"><h2>{t('恢复草稿')}</h2><button type="button" aria-label={t('关闭恢复草稿')} onClick={() => setDraftsOpen(false)}><X aria-hidden="true" /></button></div>{drafts.length === 0 ? <p>{t('没有可恢复的草稿')}</p> : drafts.map((item) => <div key={item.draftId} className="recovery-item"><span>{item.name}{t(item.targetStatus === 'changed' ? ' · 原文件已变化' : item.targetStatus === 'deleted' ? ' · 原文件已删除' : '')}</span><button type="button" disabled={busy} onClick={() => void previewDraft(item.draftId)}>{t('预览')}</button><button type="button" disabled={busy} onClick={() => void recoverDraft(item.draftId)}>{t('恢复')}</button><button type="button" disabled={busy} onClick={() => void discardDraft(item.draftId).catch((error: unknown) => setStatus(errorText(error)))}>{t('丢弃')}</button></div>)}{draftPreview && <div className="draft-preview"><strong>{draftPreview.name} · {draftPreview.assetCount} {t('张图片')}</strong><pre>{draftPreview.markdown.slice(0, 100_000)}</pre></div>}</section></div></FocusTrap>}
  </>
}
