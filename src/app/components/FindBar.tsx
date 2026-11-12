import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { isFindPatternValid } from '../../features/editor/findText'

export function FindBar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { findOpen, findQuery, setFindQuery, replaceText, setReplaceText, findCount, findCapped, queueFind, runFind, findStep, replaceOne, replaceEvery, closeFind, toolbar, t, findOptions, findRegexBlocked, setFindOptions } = w
  if (!findOpen) return null
  const regex = findOptions.regex && !findRegexBlocked
  const invalid = !isFindPatternValid(findQuery, { ...findOptions, regex })
  return <div className="find-bar" role="search" aria-label={t('查找和替换')}>
    <input autoFocus aria-label={t('查找')} placeholder={t('查找')} value={findQuery}
      onChange={(event) => { setFindQuery(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) queueFind(event.target.value) }}
      onCompositionEnd={(event) => runFind(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); findStep(event.shiftKey ? -1 : 1) } if (event.key === 'Escape') closeFind() }} />
    <button type="button" className="find-option" title={t('区分大小写')} aria-label={t('区分大小写')} aria-pressed={findOptions.caseSensitive} onClick={() => setFindOptions({ ...findOptions, caseSensitive: !findOptions.caseSensitive })}>Aa</button>
    <button type="button" className="find-option" title={t('全词匹配')} aria-label={t('全词匹配')} aria-pressed={findOptions.wholeWord} onClick={() => setFindOptions({ ...findOptions, wholeWord: !findOptions.wholeWord })}>ab|</button>
    <button type="button" className="find-option" title={findRegexBlocked ? t('文档超过 2 MiB，不能使用正则表达式') : t('使用正则表达式')} aria-label={t('使用正则表达式')} aria-pressed={regex} disabled={findRegexBlocked} onClick={() => setFindOptions({ ...findOptions, regex: !findOptions.regex })}>.*</button>
    <span className={invalid ? 'find-count find-error' : 'find-count'} role="status" title={findCapped ? t('超过 5000 处，只列出前 5000 处') : undefined}>{invalid ? t('正则无效') : findQuery ? `${findCount.total ? findCount.current + 1 : 0} / ${findCount.total}${findCapped ? '+' : ''}` : ''}</span>
    <button type="button" className="icon-button" title={t('上一个')} aria-label={t('上一个')} disabled={!findCount.total} onClick={() => findStep(-1)}><ChevronRight aria-hidden="true" style={{ transform: 'rotate(-90deg)' }} /></button>
    <button type="button" className="icon-button" title={t('下一个')} aria-label={t('下一个')} disabled={!findCount.total} onClick={() => findStep(1)}><ChevronDown aria-hidden="true" /></button>
    <input aria-label={t('替换为')} placeholder={t('替换为')} value={replaceText} onChange={(event) => setReplaceText(event.target.value)}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); replaceOne() } if (event.key === 'Escape') closeFind() }} />
    <button type="button" disabled={!findCount.total || toolbar.composing} onClick={replaceOne}>{t('替换')}</button>
    <button type="button" disabled={!findCount.total || toolbar.composing} onClick={replaceEvery}>{t('全部替换')}</button>
    <button type="button" className="icon-button" title={t('关闭查找')} aria-label={t('关闭查找')} onClick={closeFind}><X aria-hidden="true" /></button>
  </div>
}
