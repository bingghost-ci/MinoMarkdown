import type { CSSProperties } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { styleVariables } from '../../features/reading/css'
import { styleFontOption } from '../../features/reading/fonts'
import { layouts, type LayoutId } from '../../features/reading/layouts'
import { readingStyles, type ReadingStyle } from '../../features/reading/styles'

type GalleryHost = Pick<DocumentWorkspace, 'pickStyle' | 'style' | 't' | 'settings' | 'updateSettings'>

/** The variables of one style on a thumbnail, so it draws in that style whatever the window's own is. */
function pageVariables(style: ReadingStyle): CSSProperties {
  const variables = styleVariables(style) as Record<string, string>
  return { ...variables, '--thumb-font': styleFontOption(style.font).family, '--thumb-h3': style.levels?.h3 ?? style.heading } as CSSProperties
}

/**
 * A small page per reading style (T124): its paper and grain, a title in the accent, lines of body text, a
 * quote and a rule, drawn from the style's own variables. Nothing is a picture, so a changed style shows here.
 */
export function StyleGallery({ workspace: w }: { workspace: GalleryHost }) {
  const { pickStyle, style: active, t } = w
  return <div className="style-gallery" role="listbox" aria-label={t('阅读风格')}>
    {readingStyles.map((style) => <button key={style.id} type="button" role="option" className="style-card" aria-selected={active.id === style.id} onClick={() => pickStyle(style)}>
      <span className="style-card-page" style={pageVariables(style)} aria-hidden="true">
        <span className="thumb-title">{t('文')}<i>Aa</i></span>
        <span className="thumb-line" /><span className="thumb-line" /><span className="thumb-line is-short" />
        <span className="thumb-quote"><span className="thumb-line" /></span>
        <span className="thumb-line is-link" />
      </span>
      <span className="style-card-name">{t(style.name)}</span>
    </button>)}
  </div>
}

/** A page per layout (T122), in the current style: where the title sits, how sections are numbered, the paragraph indent. */
export function LayoutGallery({ workspace: w }: { workspace: GalleryHost }) {
  const { settings, updateSettings, t } = w
  return <div className="layout-gallery" role="listbox" aria-label={t('版式')}>
    {layouts.map((layout) => <button key={layout.id} type="button" role="option" className="layout-card" aria-selected={settings.layout === layout.id} title={t(layout.note)} onClick={() => updateSettings({ layout: layout.id })}>
      <span className={`layout-card-page layout-thumb-${layout.id}`} aria-hidden="true">{layoutThumb(layout.id)}</span>
      <span className="style-card-name">{t(layout.name)}</span>
    </button>)}
  </div>
}

function layoutThumb(id: LayoutId) {
  const numbers: Record<LayoutId, [string, string]> = { standard: ['', ''], academic: ['1', '1.1'], official: ['一、', '（一）'], technical: ['1.', '1.1'], typewriter: ['', ''] }
  const [first, second] = numbers[id]
  return <>
    <span className="thumb-title" />
    <span className="thumb-head"><b>{first}</b><span className="thumb-bar" /></span>
    <span className="thumb-line is-para" /><span className="thumb-line" /><span className="thumb-line is-short" />
    <span className="thumb-head is-minor"><b>{second}</b><span className="thumb-bar" /></span>
    <span className="thumb-line is-para" /><span className="thumb-line" />
  </>
}
