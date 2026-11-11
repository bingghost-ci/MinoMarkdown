import { X } from 'lucide-react'
import { PaneResizer } from './PaneResizer'
import { PANE_MAX, PANE_MIN } from '../readingSettings'
import type { DocumentWorkspace } from '../useDocumentWorkspace'

export function OutlinePanel({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { goToOutlineItem, outlineItems, setSettings, settings, t } = w
  if (!settings.showOutline) return null
  const top = outlineItems.reduce((level, item) => Math.min(level, item.level), 6)
  return <aside className="outline-panel" aria-label={t('文档大纲')} style={{ width: settings.outlineWidth }}>
    <PaneResizer edge="left" width={settings.outlineWidth} min={PANE_MIN} max={PANE_MAX} fallback={240} label={t('调整大纲宽度')} onCommit={(outlineWidth) => setSettings((current) => ({ ...current, outlineWidth }))} />
    <div className="sidebar-heading"><h2>{t('文档大纲')}</h2><button type="button" className="icon-button" title={t('隐藏大纲')} aria-label={t('隐藏大纲')} onClick={() => setSettings((current) => ({ ...current, showOutline: false }))}><X aria-hidden="true" /></button></div>
    {outlineItems.length === 0
      ? <p className="sidebar-empty">{t('当前文档没有标题')}</p>
      : <nav className="outline-list">{outlineItems.map((item, index) => <button key={`${item.target}-${index}`} type="button" title={item.text} data-depth={Math.min(item.level - top, 5)} style={{ paddingLeft: 10 + (item.level - top) * 14 }} onClick={() => goToOutlineItem(item)}>{item.text}</button>)}</nav>}
  </aside>
}
