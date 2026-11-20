import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Settings, SettingsHost } from '../useDocumentWorkspace'
import { Row } from './settingsControls'
import { isHexColor, parseHex, toHex } from '../../features/reading/color'
import { systemFontName } from '../../features/reading/fonts'
import {
  cleanDiagramColors, diagramColorLabels, diagramColorRoleLabels, diagramColorRoles, diagramColorSchemes, diagramCurveLabels, diagramCurves, diagramFillLabels, diagramFills, diagramFontFamily,
  diagramFontIds, diagramFontLabels, diagramLineLabels, diagramLines, diagramLookLabels, diagramLooks, diagramOptions, diagramTone, isSketchLook, resolvedCurve, resolvedFill, resolvedLine,
  type DiagramColorRole, type DiagramCustomColors, type DiagramFont, type DiagramLook, type DiagramOptions,
} from '../../features/diagrams/looks'

type T = (text: string) => string

/** The diagram options in the settings, as the drawing code takes them. */
export function diagramOptionsOf(settings: Pick<Settings, 'diagramStyle' | 'diagramLine' | 'diagramCurve' | 'diagramFill' | 'diagramColors' | 'diagramCustomColors' | 'diagramFont'>, look: DiagramLook = settings.diagramStyle): DiagramOptions {
  return diagramOptions({ look, line: settings.diagramLine, curve: settings.diagramCurve, fill: settings.diagramFill, colors: settings.diagramColors, custom: settings.diagramCustomColors, font: settings.diagramFont })
}

/** Two nodes and an edge in a look's own manner, drawn without loading Mermaid. It shows the idea of the look; the preview below shows the look. */
function LookThumb({ styleId, options }: { styleId: string; options: DiagramOptions }) {
  const look = options.look, tone = diagramTone(styleId, options)
  const second = tone.pens[1] ?? tone.second
  const dash = { dashed: '4 2.5', dotted: '0.3 2.6', solid: undefined }[resolvedLine(look, options.line)]
  const route = resolvedCurve(look, options.curve)
  const edge = route === 'angular' ? 'M35 13 H46 V27 H56' : route === 'straight' ? 'M35 13 L56 27' : 'M35 13 C47 13 43 27 56 27'
  const fill = isSketchLook(look) ? resolvedFill(look, options.fill) : 'solid'
  const hatch = (x: number, y: number, color: string) => <path d={[0, 5, 10, 15, 20, 25, 30, 35].map((at) => `M${x + Math.max(0.8, at - 13.2)} ${y + Math.min(13.2, at + 0.8)} L${x + Math.min(26.2, at + 0.8)} ${y + Math.max(0.8, at - 25.4)}`).join('')} fill="none" stroke={color} strokeWidth="0.8" strokeLinecap="round" />
  const wobbly = (x: number, y: number) => `M${x + 1} ${y} Q${x + 14} ${y - 1} ${x + 27} ${y + 0.5} Q${x + 28} ${y + 7} ${x + 27} ${y + 14} Q${x + 14} ${y + 15} ${x + 1.5} ${y + 13.5} Q${x - 0.5} ${y + 7} ${x + 1} ${y}`
  const box = (x: number, y: number, pen: number): ReactNode => {
    const color = tone.pens[pen % Math.max(1, tone.pens.length)] ?? tone.node
    if (look === 'hand' || look === 'pencil' || look === 'chalk') return <g fill="none" strokeLinecap="round">
      {fill === 'wash' && <rect x={x + 2.5} y={y + 2.5} width="27" height="14" rx="2" fill={color} />}
      {fill === 'solid' && <rect x={x} y={y} width="27" height="14" rx="2" fill={color} />}
      {fill === 'hatch' && hatch(x, y, color)}
      <path d={wobbly(x, y)} stroke={look === 'chalk' ? color : tone.border} strokeWidth={look === 'chalk' ? 1.8 : look === 'pencil' ? 0.8 : 1.4} />
      {look === 'pencil' && <path d={wobbly(x + 0.4, y + 0.6)} stroke={tone.border} strokeWidth="0.6" opacity="0.7" />}
    </g>
    if (look === 'ink') return <g fill="none"><rect x={x} y={y} width="27" height="14" rx="3" stroke={tone.border} strokeWidth="1.5" /><rect x={x + 2} y={y + 2} width="23" height="10" rx="1.5" stroke={tone.border} strokeWidth="0.5" /></g>
    if (look === 'scifi') return <g><path d={`M${x + 4} ${y} H${x + 27} V${y + 10} L${x + 23} ${y + 14} H${x} V${y + 4} Z`} fill={tone.node} stroke={pen ? tone.second : tone.accent} strokeWidth="1" style={{ filter: `drop-shadow(0 0 1.5px ${tone.accent})` }} /><path d={`M${x + 7} ${y} h7`} stroke={tone.accent} strokeWidth="2" /></g>
    if (look === 'program') return pen
      ? <rect x={x} y={y} width="27" height="14" rx="7" fill="none" stroke={tone.accent} strokeWidth="1.1" />
      : <rect x={x} y={y} width="27" height="14" rx="3" fill={tone.node} stroke={tone.border} strokeWidth="0.9" />
    if (look === 'color') return <rect x={x} y={y} width="27" height="14" rx="4" fill={pen ? '#bfe8d2' : '#c8daf5'} stroke={pen ? '#3c8a66' : '#4a6fa8'} strokeWidth="1" />
    return <rect x={x} y={y} width="27" height="14" rx="3" fill={pen ? second === tone.second ? tone.node : tone.node : tone.node} stroke={tone.border} strokeWidth="1" />
  }
  const line = look === 'program' ? tone.accent : tone.line
  const open = look === 'hand' || look === 'pencil' || look === 'chalk'
  return <svg viewBox="0 0 96 40" width="96" height="40" aria-hidden="true">
    <rect width="96" height="40" rx="6" fill={tone.ground} />
    {tone.grid && <path d="M0 10H96M0 20H96M0 30H96M12 0V40M24 0V40M36 0V40M48 0V40M60 0V40M72 0V40M84 0V40" stroke={tone.grid} strokeWidth="0.5" />}
    {box(7, 6, 0)}
    {box(62, 20, 1)}
    <path d={edge} fill="none" stroke={line} strokeWidth={look === 'chalk' ? 1.6 : look === 'pencil' ? 0.8 : 1.2} strokeDasharray={dash} strokeLinecap="round" style={look === 'scifi' ? { filter: `drop-shadow(0 0 1.5px ${tone.accent})` } : undefined} />
    {open ? <path d="M56.4 23.8 Q59 25 61.4 27 Q58.6 28.6 56.6 30.4" fill="none" stroke={line} strokeWidth="1.1" strokeLinecap="round" /> : <path d="M56.5 24.5 L61.4 27 L56.5 29.5 Z" fill={line} />}
  </svg>
}

const previewSource = `flowchart LR
  A[打开文档] --> B{需要编辑?}
  B -- 是 --> C[编辑 Edit]
  B -- 否 --> D([导出 PDF])
  subgraph 本地
    C --> E[(保存)]
  end`

/** The chosen look as it is really drawn: the same code that draws the documents' diagrams, on a small flowchart. */
function DiagramPreview({ styleId, paper, options, t }: { styleId: string; paper: string; options: DiagramOptions; t: T }) {
  const [svg, setSvg] = useState('')
  const key = JSON.stringify([styleId, options])
  useEffect(() => {
    let current = true
    // Options change with every step of a slider; the drawing waits for them to rest.
    const timer = window.setTimeout(() => {
      void import('../../features/diagrams/mermaid').then((module) => module.renderDiagramsForExport([previewSource], styleId, options)).then((drawn) => { if (current) setSvg(drawn.get(previewSource) ?? '') }, () => undefined)
    }, 140)
    return () => { current = false; window.clearTimeout(timer) }
  }, [key])
  // The SVG was sanitized by `sanitizeDiagramSvg` before it was returned.
  return <div className="diagram-preview" aria-label={t('图表预览')} style={{ background: paper }} dangerouslySetInnerHTML={{ __html: svg }} />
}

/** The user's own colors: a role is picked, then mixed with the red, green and blue sliders or typed as a hex value. */
function DiagramColorsEditor({ styleId, options, onChange, t }: { styleId: string; options: DiagramOptions; onChange: (value: DiagramCustomColors) => void; t: T }) {
  const [role, setRole] = useState<DiagramColorRole>('accent')
  const [draft, setDraft] = useState<{ role: DiagramColorRole; color: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ custom: options.custom, onChange })
  latest.current = { custom: options.custom, onChange }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const tone = diagramTone(styleId, options)
  const shown: Record<DiagramColorRole, string> = { accent: tone.accent, node: tone.pens[0] && isSketchLook(options.look) ? tone.pens[0] : tone.node || tone.ground, border: tone.border || tone.text, line: tone.line, text: tone.text }
  const color = draft?.role === role ? draft.color : options.custom[role] ?? shown[role]
  const rgb = parseHex(color)
  // The object is replaced, never changed in place: settings are saved by comparing references.
  const commit = (target: DiagramColorRole, value: string | null) => {
    window.clearTimeout(timer.current)
    const next = { ...latest.current.custom }
    if (value === null) delete next[target]; else next[target] = value.toLowerCase()
    latest.current.onChange(cleanDiagramColors(next))
    setDraft(null)
  }
  const mixTo = (value: string) => {
    setDraft({ role, color: value })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(role, value), 160)
  }
  const quick = ['#d9532b', '#e08a1e', '#d4b106', '#2b8a57', '#12a594', '#2a6fdb', '#7a4fd6', '#d4447c', '#22252a', '#5b6068', '#9aa0a6', '#f3f1e7', '#fbe9e2', '#e3f1ff', '#e6f6ea', '#f1e9ff']
  return <div className="code-custom">
    <div className="code-custom-roles" role="group" aria-label={t('颜色')}>
      {diagramColorRoles.map((id) => <button key={id} type="button" aria-pressed={id === role} onClick={() => { if (draft) commit(draft.role, draft.color); setRole(id) }}>
        <i style={{ background: draft?.role === id ? draft.color : options.custom[id] ?? shown[id] }} /><span>{t(diagramColorRoleLabels[id])}</span>{options.custom[id] && <b aria-label={t('已修改')} title={t('已修改')} />}
      </button>)}
    </div>
    <div className="code-palette" role="group" aria-label={`${t('调色板')}: ${t(diagramColorRoleLabels[role])}`}>
      <div className="code-palette-head">
        <i style={{ background: color }} />
        <strong>{t(diagramColorRoleLabels[role])}</strong>
        <input key={color} type="text" aria-label={t('色值')} defaultValue={color} maxLength={7} spellCheck={false}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          onBlur={(event) => { const value = event.target.value.trim(); if (isHexColor(value)) { if (value.toLowerCase() !== color) commit(role, value) } else event.target.value = color }} />
        <button type="button" disabled={!options.custom[role] && draft?.role !== role} onClick={() => commit(role, null)}>{t('恢复默认')}</button>
      </div>
      {([['红', 'R'], ['绿', 'G'], ['蓝', 'B']] as const).map(([name, letter], index) => {
        const at = (value: number) => toHex(rgb.map((channel, i) => (i === index ? value : channel)) as [number, number, number])
        return <label key={letter} className="code-palette-channel">
          <span title={t(name)}>{letter}</span>
          <input type="range" min={0} max={255} step={1} aria-label={t(name)} value={rgb[index]} style={{ background: `linear-gradient(to right, ${at(0)}, ${at(255)})` }} onChange={(event) => mixTo(at(Number(event.target.value)))} />
          <output>{rgb[index]}</output>
        </label>
      })}
      <div className="code-palette-quick" role="group" aria-label={t('常用颜色')}>
        {quick.map((value) => <button key={value} type="button" title={value} aria-label={value} aria-pressed={value === color} style={{ background: value }} onClick={() => commit(role, value)} />)}
      </div>
    </div>
    <div className="code-custom-actions"><button type="button" disabled={Object.keys(options.custom).length === 0} onClick={() => { window.clearTimeout(timer.current); setDraft(null); onChange({}) }}>{t('全部恢复默认')}</button></div>
  </div>
}

function Chips<V extends string>({ value, options, onChange, label, t }: { value: V; options: readonly (readonly [V, string, string?])[]; onChange: (value: V) => void; label: string; t: T }) {
  return <div className="diagram-chips" role="group" aria-label={t(label)}>{options.map(([id, name, dot]) => <button key={id} type="button" aria-pressed={id === value} onClick={() => onChange(id)}>{dot && <i style={{ background: dot }} />}{t(name)}</button>)}</div>
}

/**
 * The diagrams page of the settings (T117): a look, and under it what can be changed within that look.
 * Choosing another look puts its lines, fill and font back to that look's own, so each look is first seen as
 * it was designed; the color scheme is kept, since a scheme is not one look's.
 */
export function DiagramSettings({ workspace: w }: { workspace: SettingsHost }) {
  const { settings, style, t, updateSettings: update, systemFonts, loadSystemFonts } = w
  const options = diagramOptionsOf(settings)
  const look = options.look
  const [listing, setListing] = useState(systemFontName(options.font) !== null)
  useEffect(() => { if (listing) loadSystemFonts() }, [listing])
  const schemeDot = (id: (typeof diagramColorSchemes)[number]) => id === 'custom' ? 'conic-gradient(#e5484d, #f5d90a, #30a46c, #0090ff, #8e4ec6, #e5484d)' : diagramTone(style.id, { ...options, colors: id }).accent
  const fontChoice = (id: DiagramFont, name: string) => <button key={id} type="button" role="option" className="font-chip" aria-selected={options.font === id} style={{ fontFamily: diagramFontFamily(look, id) }} onClick={() => update({ diagramFont: id })}>{t(name)}</button>
  return <>
    <div className="settings-section-heading is-first"><strong>{t('图表风格')}</strong><small>{t('Mermaid 流程图、时序图等的画法；选好风格后，下面的配色、字体和连线都可以再改，导出也用这里的选择')}</small></div>
    <div className="diagram-looks" role="radiogroup" aria-label={t('图表风格')}>
      {diagramLooks.map((id) => <button key={id} type="button" role="radio" aria-checked={look === id} title={t(diagramLookLabels[id].note)} onClick={() => { if (id !== look) update({ diagramStyle: id, diagramLine: 'auto', diagramCurve: 'auto', diagramFill: 'auto', diagramFont: 'auto' }) }}>
        <LookThumb styleId={style.id} options={{ ...options, look: id }} /><span>{t(diagramLookLabels[id].name)}</span>
      </button>)}
    </div>
    <p className="settings-note">{t(diagramLookLabels[look].note)}</p>
    <DiagramPreview styleId={style.id} paper={style.paper} options={options} t={t} />

    <div className="settings-section-heading"><strong>{t('配色')}</strong><small>{t('强调色和成套的颜色；“随纸张”取当前阅读风格的强调色，“自定义”逐项设置')}</small></div>
    <Chips t={t} label="配色" value={options.colors} onChange={(diagramColors) => update({ diagramColors })} options={diagramColorSchemes.map((id) => [id, diagramColorLabels[id], schemeDot(id)] as const)} />
    {options.colors === 'custom' && <DiagramColorsEditor styleId={style.id} options={options} onChange={(diagramCustomColors) => update({ diagramCustomColors })} t={t} />}

    <div className="settings-section-heading"><strong>{t('文字')}</strong><small>{t('图表里文字的字体；手写体随应用提供，也可以用这台 Mac 上安装的任何字体')}</small></div>
    <div className="font-grid" role="listbox" aria-label={t('图表字体')}>
      {fontChoice('auto', diagramFontLabels.auto)}
      {diagramFontIds.map((id) => fontChoice(id, diagramFontLabels[id]))}
      <button type="button" role="option" className="font-chip" aria-selected={systemFontName(options.font) !== null} onClick={() => setListing(!listing)}>{systemFontName(options.font) ?? t('本机字体…')}</button>
    </div>
    {listing && <select className="diagram-system-fonts" aria-label={t('本机字体')} value={systemFontName(options.font) ?? ''} onChange={(event) => update({ diagramFont: event.target.value ? `sys:${event.target.value}` : 'auto' })}>
      <option value="">{systemFonts === null ? t('正在读取字体…') : t('选择一种本机字体')}</option>
      {(systemFonts ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
    </select>}

    <div className="settings-section-heading"><strong>{t('线条')}</strong></div>
    <Row title={t('连线样式')} note={t('普通连线的线型；图里本来写成虚线的连线不变')}><Chips t={t} label="连线样式" value={options.line} onChange={(diagramLine) => update({ diagramLine })} options={diagramLines.map((id) => [id, diagramLineLabels[id]] as const)} /></Row>
    <Row title={t('连线走向')} note={t('流程图和状态图的连线怎样绕到下一个节点')}><Chips t={t} label="连线走向" value={options.curve} onChange={(diagramCurve) => update({ diagramCurve })} options={diagramCurves.map((id) => [id, diagramCurveLabels[id]] as const)} /></Row>
    {isSketchLook(look) && <Row title={t('填充')} note={t('手绘风格怎样给节点上色：错开的水彩色块、排线、平涂，或者不填')}><Chips t={t} label="填充" value={options.fill} onChange={(diagramFill) => update({ diagramFill })} options={diagramFills.map((id) => [id, diagramFillLabels[id]] as const)} /></Row>}
  </>
}
