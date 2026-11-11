import { useEffect, useRef } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE } from '../textZoom'
import { readingStyles, type ReadingStyle } from '../../features/reading/styles'
import { FontPicker } from './FontPicker'

/** Round color chips, one per reading style: the page color with the accent as a dot of ink. */
export function StyleSwatches({ workspace: w }: { workspace: DocumentWorkspace }) {
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
  const { setPanel, setSettings, settings, style, t } = w
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.float-controls')) setPanel(null) }
    window.document.addEventListener('pointerdown', onPointerDown)
    return () => window.document.removeEventListener('pointerdown', onPointerDown)
  }, [])
  const update = (patch: Partial<typeof settings>) => setSettings((current) => ({ ...current, ...patch }))
  return <div ref={root} className="appearance-panel" role="dialog" aria-label={t('字体与风格')}>
    <section><h3>{t('字号')}<output>{settings.editorFontSize}</output></h3>
      <Slider label={t('字号')} value={settings.editorFontSize} min={MIN_EDITOR_FONT_SIZE} max={MAX_EDITOR_FONT_SIZE} step={1} onChange={(value) => update({ editorFontSize: value })} small="A" large="A" />
    </section>
    <section><h3>{t('风格')}</h3>
      <StyleSwatches workspace={w} />
      {style.texture && <><h4>{t('纸张纹理')}<output>{settings.textureStrength}%</output></h4>
        <Slider label={t('纸张纹理')} value={settings.textureStrength} min={0} max={100} step={10} onChange={(value) => update({ textureStrength: value })} small={t('平')} large={t('糙')} /></>}
    </section>
    <section><h3>{t('版面')}</h3>
      <div className="panel-row"><span>{t('行距')}</span><div className="panel-segmented">{([['compact', '紧凑'], ['comfortable', '舒适'], ['relaxed', '宽松']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={settings.editorLineHeight === id} onClick={() => update({ editorLineHeight: id })}>{t(label)}</button>)}</div></div>
      <div className="panel-row"><span>{t('显示')}</span><div className="panel-segmented">{([['centered', '页面'], ['wide', '宽屏']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={settings.editorWidth === id} onClick={() => update({ editorWidth: id })}>{t(label)}</button>)}</div></div>
    </section>
    <section><h3>{t('字体')}</h3><FontPicker workspace={w} /></section>
  </div>
}
