import { useEffect, useRef } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE } from '../textZoom'
import { readingStyles, type ReadingStyle } from '../../features/reading/styles'
import { FontPicker } from './FontPicker'
import { Segmented } from './settingsControls'
import { editorWidthOptions, lineHeightOptions } from '../readingSettings'

/** Round color chips, one per reading style: the page color with the accent as a dot of ink. */
export function StyleSwatches({ workspace: w }: { workspace: Pick<DocumentWorkspace, 'pickStyle' | 'style' | 't'> }) {
  const { pickStyle, style: active, t } = w
  return <div className="style-swatches" role="listbox" aria-label={t('阅读风格')}>
    {readingStyles.map((style: ReadingStyle) => <button key={style.id} type="button" role="option" className="style-swatch" aria-selected={active.id === style.id} onClick={() => pickStyle(style)}>
      <span className="style-swatch-chip" style={{ background: style.paper, color: style.title, borderColor: style.edge }} aria-hidden="true">{t('文')}</span>
      <span className="style-swatch-name">{t(style.name)}</span>
    </button>)}
  </div>
}

function Slider({ label, value, min, max, step, onChange, small, large }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; small: string; large: string }) {
  return <label className="panel-slider"><span aria-hidden="true">{small}</span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><span aria-hidden="true">{large}</span></label>
}

/** The popover beside the floating buttons (T65): size, style, texture, layout and fonts in one place. */
export function AppearancePanel({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { setPanel, updateSettings, settings, style, t } = w
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.float-controls')) setPanel(null) }
    window.document.addEventListener('pointerdown', onPointerDown)
    return () => window.document.removeEventListener('pointerdown', onPointerDown)
  }, [])
  const update = updateSettings
  return <div ref={root} className="appearance-panel" role="dialog" aria-label={t('字体与风格')}>
    <section><h3>{t('风格')}</h3>
      <StyleSwatches workspace={w} />
      {style.texture && <><h4>{t('纸张纹理')}<output>{settings.textureStrength}%</output></h4>
        <Slider label={t('纸张纹理')} value={settings.textureStrength} min={0} max={100} step={10} onChange={(value) => update({ textureStrength: value })} small={t('平')} large={t('糙')} /></>}
    </section>
    <section><h3>{t('版面')}</h3>
      <div className="panel-row"><span>{t('行距')}</span><Segmented className="panel-segmented" t={t} value={settings.editorLineHeight} onChange={(value) => update({ editorLineHeight: value })} options={lineHeightOptions} /></div>
      <div className="panel-row"><span>{t('显示')}</span><Segmented className="panel-segmented" t={t} value={settings.editorWidth} onChange={(value) => update({ editorWidth: value })} options={editorWidthOptions} /></div>
    </section>
    <section><h3>{t('字体')}</h3>
      <h4 className="panel-font-size">{t('字号')}<output>{settings.editorFontSize}</output></h4>
      <Slider label={t('字号')} value={settings.editorFontSize} min={MIN_EDITOR_FONT_SIZE} max={MAX_EDITOR_FONT_SIZE} step={1} onChange={(value) => update({ editorFontSize: value })} small="A" large="A" />
      <FontPicker workspace={w} documentKind={w.document.kind} />
    </section>
  </div>
}
