import { X } from 'lucide-react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'

export function OutlinePanel({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { goToOutlineItem, outlineItems, setSettings, settings, t } = w
  if (!settings.showOutline) return null
  const top = outlineItems.reduce((level, item) => Math.min(level, item.level), 6)
  return <aside className="outline-panel" aria-label={t('文档大纲')}>
    <div className="sidebar-heading"><h2>{t('文档大纲')}</h2><button type="button" className="icon-button" title={t('隐藏大纲')} aria-label={t('隐藏大纲')} onClick={() => setSettings((current) => ({ ...current, showOutline: false }))}><X aria-hidden="true" /></button></div>
    {outlineItems.length === 0
      ? <p className="sidebar-empty">{t('当前文档没有标题')}</p>
      : <nav className="outline-list">{outlineItems.map((item, index) => <button key={`${item.target}-${index}`} type="button" title={item.text} style={{ paddingLeft: 12 + (item.level - top) * 14 }} onClick={() => goToOutlineItem(item)}>{item.text}</button>)}</nav>}
  </aside>
}
