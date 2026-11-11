import { FocusTrap } from './FocusTrap'
import { errorText, type DocumentWorkspace } from '../useDocumentWorkspace'
import { X } from 'lucide-react'

export function TabContextMenu({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { closeTabs, detachTab, t, tabMenu, tabs } = w
  return <>
      {tabMenu && <div className="tab-context-menu" role="menu" style={{ left: Math.min(tabMenu.x, window.innerWidth - 180), top: Math.min(tabMenu.y, window.innerHeight - 120) }} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => void detachTab(tabMenu.key)}>{t('移到新窗口')}</button><button type="button" role="menuitem" onClick={() => void closeTabs([tabMenu.key])}>{t('关闭当前')}</button><button type="button" role="menuitem" onClick={() => void closeTabs(tabs.slice(tabs.findIndex((tab) => tab.key === tabMenu.key) + 1).map((tab) => tab.key))} disabled={tabs.findIndex((tab) => tab.key === tabMenu.key) === tabs.length - 1}>{t('关闭右边')}</button><button type="button" role="menuitem" onClick={() => void closeTabs(tabs.map((tab) => tab.key))}>{t('关闭所有文档')}</button></div>}
  </>
}

export function DraftsDialog({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { busy, discardDraft, draftPreview, drafts, draftsOpen, previewDraft, recoverDraft, setDraftsOpen, setStatus, t } = w
  return <>
      {draftsOpen && <FocusTrap><div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftsOpen(false) }}><section className="drafts-dialog" role="dialog" aria-modal="true" aria-label={t('恢复草稿')}><div className="settings-title"><h2>{t('恢复草稿')}</h2><button type="button" aria-label={t('关闭恢复草稿')} onClick={() => setDraftsOpen(false)}><X aria-hidden="true" /></button></div>{drafts.length === 0 ? <p>{t('没有可恢复的草稿')}</p> : drafts.map((item) => <div key={item.draftId} className="recovery-item"><span>{item.name}{t(item.targetStatus === 'changed' ? ' · 原文件已变化' : item.targetStatus === 'deleted' ? ' · 原文件已删除' : '')}</span><button type="button" disabled={busy} onClick={() => void previewDraft(item.draftId)}>{t('预览')}</button><button type="button" disabled={busy} onClick={() => void recoverDraft(item.draftId)}>{t('恢复')}</button><button type="button" disabled={busy} onClick={() => void discardDraft(item.draftId).catch((error: unknown) => setStatus(errorText(error)))}>{t('丢弃')}</button></div>)}{draftPreview && <div className="draft-preview"><strong>{draftPreview.name} · {draftPreview.assetCount} {t('张图片')}</strong><pre>{draftPreview.markdown.slice(0, 100_000)}</pre></div>}</section></div></FocusTrap>}
  </>
}
