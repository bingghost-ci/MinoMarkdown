import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { choiceFamily, cjkFonts, codeFonts, latinFonts, systemFontId, systemFontName, type FontScript } from '../../features/reading/fonts'

type Tab = 'cjk' | 'latin' | 'code' | 'system'
const settingOf = { cjk: 'cjkFont', latin: 'latinFont', code: 'codeFont' } as const
const fontsOf = { cjk: cjkFonts, latin: latinFonts, code: codeFonts } as const
const listLabel = { cjk: '中文字体', latin: '西文字体', code: '代码字体' } as const

/**
 * A button is drawn in its own font only when that costs nothing: the font is in use, or it loads in small
 * pieces. A font that ships as one large file, and each of the hundreds of fonts installed on the Mac, is
 * shown in the interface font until the pointer rests on its button. Drawing them all at once loaded 24 MiB
 * of fonts when the panel opened and froze the window while they were decoded.
 */
const PREVIEW_DELAY_MS = 220
let previewTimer: number | undefined
function previewOnRest(family: string) {
  return {
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
      const button = event.currentTarget
      window.clearTimeout(previewTimer)
      previewTimer = window.setTimeout(() => { button.style.fontFamily = family }, PREVIEW_DELAY_MS)
    },
    onPointerLeave: () => window.clearTimeout(previewTimer),
  }
}

/**
 * The font grid (T65): every button is drawn in its own font. Chinese and Western fonts are chosen
 * separately, code has its own monospace font (T90), and the last tab lists the fonts installed on this Mac
 * for any of the three.
 */
export function FontPicker({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { document, loadSystemFonts, updateSettings, settings, style, systemFonts, t } = w
  // A source file is drawn in the code font alone, so the picker opens on it.
  const [tab, setTab] = useState<Tab>(document.kind === 'code' ? 'code' : systemFontName(settings.cjkFont) ? 'system' : 'cjk')
  const [target, setTarget] = useState<FontScript>(document.kind === 'code' ? 'code' : systemFontName(settings.latinFont) && !systemFontName(settings.cjkFont) ? 'latin' : 'cjk')
  const [query, setQuery] = useState('')
  useEffect(() => { if (tab === 'system') loadSystemFonts() }, [tab])
  const pick = (script: FontScript, id: string) => updateSettings({ [settingOf[script]]: id })
  const selected = (script: FontScript) => settings[settingOf[script]]
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (systemFonts ?? []).filter((name) => !needle || name.toLowerCase().includes(needle))
  }, [systemFonts, query])
  const styleFont = cjkFonts.find((font) => font.id === style.font)
  const autoCjkFamily = styleFont && (!styleFont.heavy || settings.cjkFont === 'auto') ? styleFont.family : undefined
  const grid = (script: FontScript, autoLabel: string, autoFamily: string | undefined) => <div className="font-grid" role="listbox" aria-label={t(listLabel[script])}>
    <button type="button" role="option" className="font-chip" aria-selected={selected(script) === 'auto'} onClick={() => pick(script, 'auto')} style={{ fontFamily: autoFamily }}>{t(autoLabel)}</button>
    {fontsOf[script].map((font) => {
      const eager = !font.heavy || selected(script) === font.id
      return <button key={font.id} type="button" role="option" className="font-chip" title={t(font.note)} aria-selected={selected(script) === font.id} onClick={() => pick(script, font.id)} style={eager ? { fontFamily: font.family } : undefined} {...(eager ? {} : previewOnRest(font.family))}>{t(font.label)}</button>
    })}
    {systemFontName(selected(script)) && <button type="button" role="option" className="font-chip" aria-selected="true" style={{ fontFamily: choiceFamily(selected(script), script) ?? undefined }} onClick={() => { setTarget(script); setTab('system') }}>{systemFontName(selected(script))}</button>}
  </div>
  return <div className="font-picker">
    <div className="panel-tabs" role="tablist" aria-label={t('字体分类')}>
      {([['cjk', '中文'], ['latin', '西文'], ['code', '代码'], ['system', '本机']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{t(label)}</button>)}
    </div>
    {tab === 'cjk' && grid('cjk', '随风格', autoCjkFamily)}
    {tab === 'latin' && grid('latin', '随中文字体', undefined)}
    {tab === 'code' && <>{grid('code', '默认', codeFonts[0].family)}<p className="panel-note">{t('用于代码块、代码与配置文件和源码编辑器。本机里其他的等宽字体可以在“本机”里选。')}</p></>}
    {tab === 'system' && <>
      <div className="font-system-bar">
        <div className="panel-segmented" role="group" aria-label={t('用于')}>
          {([['cjk', '用于中文'], ['latin', '用于西文'], ['code', '用于代码']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={target === id} onClick={() => setTarget(id)}>{t(label)}</button>)}
        </div>
        <input type="search" value={query} placeholder={t('搜索本机字体')} aria-label={t('搜索本机字体')} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {systemFonts === null
        ? <p className="panel-note">{t('正在读取本机字体…')}</p>
        : matches.length === 0
          ? <p className="panel-note">{t(systemFonts.length === 0 ? '没有读到本机字体' : '没有匹配的字体')}</p>
          : <div className="font-grid font-grid-system" role="listbox" aria-label={t('本机字体')}>{matches.map((name) => <button key={name} type="button" role="option" className="font-chip" title={name} aria-selected={selected(target) === systemFontId(name)} onClick={() => pick(target, systemFontId(name))} style={selected(target) === systemFontId(name) ? { fontFamily: `'${name}'` } : undefined} {...previewOnRest(`'${name}'`)}>{name}</button>)}</div>}
      <p className="panel-note">{t('本机字体不随导出的 HTML 一起保存，在没有这款字体的电脑上会换成系统字体。')}</p>
    </>}
  </div>
}
