import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'

export function FindBar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { findOpen, findQuery, setFindQuery, replaceText, setReplaceText, findCount, runFind, findStep, replaceOne, replaceEvery, closeFind, toolbar, t } = w
  if (!findOpen) return null
  return <div className="find-bar" role="search" aria-label={t('查找和替换')}>
    <input autoFocus aria-label={t('查找')} placeholder={t('查找')} value={findQuery}
      onChange={(event) => { setFindQuery(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) runFind(event.target.value) }}
      onCompositionEnd={(event) => runFind(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); findStep(event.shiftKey ? -1 : 1) } if (event.key === 'Escape') closeFind() }} />
    <span className="find-count" role="status">{findQuery ? `${findCount.total ? findCount.current + 1 : 0} / ${findCount.total}` : ''}</span>
    <button type="button" className="icon-button" title={t('上一个')} aria-label={t('上一个')} disabled={!findCount.total} onClick={() => findStep(-1)}><ChevronRight aria-hidden="true" style={{ transform: 'rotate(-90deg)' }} /></button>
    <button type="button" className="icon-button" title={t('下一个')} aria-label={t('下一个')} disabled={!findCount.total} onClick={() => findStep(1)}><ChevronDown aria-hidden="true" /></button>
    <input aria-label={t('替换为')} placeholder={t('替换为')} value={replaceText} onChange={(event) => setReplaceText(event.target.value)}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); replaceOne() } if (event.key === 'Escape') closeFind() }} />
    <button type="button" disabled={!findCount.total || toolbar.composing} onClick={replaceOne}>{t('替换')}</button>
    <button type="button" disabled={!findCount.total || toolbar.composing} onClick={replaceEvery}>{t('全部替换')}</button>
    <button type="button" className="icon-button" title={t('关闭查找')} aria-label={t('关闭查找')} onClick={closeFind}><X aria-hidden="true" /></button>
  </div>
}
