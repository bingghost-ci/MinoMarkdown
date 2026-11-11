import { useEffect, useMemo, useState } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { choiceFamily, cjkFonts, latinFonts, systemFontId, systemFontName, type FontScript } from '../../features/reading/fonts'

type Tab = 'cjk' | 'latin' | 'system'

/**
 * The font grid (T65): every button is drawn in its own font. Chinese and Western fonts are chosen
 * separately, and the third tab lists the fonts installed on this Mac for either of them.
 */
export function FontPicker({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { loadSystemFonts, setSettings, settings, style, systemFonts, t } = w
  const [tab, setTab] = useState<Tab>(systemFontName(settings.cjkFont) ? 'system' : 'cjk')
  const [target, setTarget] = useState<FontScript>(systemFontName(settings.latinFont) && !systemFontName(settings.cjkFont) ? 'latin' : 'cjk')
  const [query, setQuery] = useState('')
  useEffect(() => { if (tab === 'system') loadSystemFonts() }, [tab])
  const pick = (script: FontScript, id: string) => setSettings((current) => ({ ...current, ...(script === 'cjk' ? { cjkFont: id } : { latinFont: id }) }))
  const selected = (script: FontScript) => script === 'cjk' ? settings.cjkFont : settings.latinFont
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (systemFonts ?? []).filter((name) => !needle || name.toLowerCase().includes(needle))
  }, [systemFonts, query])
  const styleFont = cjkFonts.find((font) => font.id === (style.font === 'hei' ? 'hei' : style.font))
  const grid = (script: FontScript, autoLabel: string, autoFamily: string | undefined) => <div className="font-grid" role="listbox" aria-label={t(script === 'cjk' ? '中文字体' : '西文字体')}>
    <button type="button" role="option" className="font-chip" aria-selected={selected(script) === 'auto'} onClick={() => pick(script, 'auto')} style={{ fontFamily: autoFamily }}>{t(autoLabel)}</button>
    {(script === 'cjk' ? cjkFonts : latinFonts).map((font) => <button key={font.id} type="button" role="option" className="font-chip" title={t(font.note)} aria-selected={selected(script) === font.id} onClick={() => pick(script, font.id)} style={{ fontFamily: font.family }}>{t(font.label)}</button>)}
    {systemFontName(selected(script)) && <button type="button" role="option" className="font-chip" aria-selected="true" style={{ fontFamily: choiceFamily(selected(script), script) ?? undefined }} onClick={() => { setTarget(script); setTab('system') }}>{systemFontName(selected(script))}</button>}
  </div>
  return <div className="font-picker">
    <div className="panel-tabs" role="tablist" aria-label={t('字体分类')}>
      {([['cjk', '中文'], ['latin', '西文'], ['system', '本机']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{t(label)}</button>)}
    </div>
    {tab === 'cjk' && grid('cjk', '随风格', styleFont?.family)}
    {tab === 'latin' && grid('latin', '随中文字体', undefined)}
    {tab === 'system' && <>
      <div className="font-system-bar">
        <div className="panel-segmented" role="group" aria-label={t('用于')}>
          {([['cjk', '用于中文'], ['latin', '用于西文']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={target === id} onClick={() => setTarget(id)}>{t(label)}</button>)}
        </div>
        <input type="search" value={query} placeholder={t('搜索本机字体')} aria-label={t('搜索本机字体')} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {systemFonts === null
        ? <p className="panel-note">{t('正在读取本机字体…')}</p>
        : matches.length === 0
          ? <p className="panel-note">{t(systemFonts.length === 0 ? '没有读到本机字体' : '没有匹配的字体')}</p>
          : <div className="font-grid font-grid-system" role="listbox" aria-label={t('本机字体')}>{matches.map((name) => <button key={name} type="button" role="option" className="font-chip" title={name} aria-selected={selected(target) === systemFontId(name)} onClick={() => pick(target, systemFontId(name))} style={{ fontFamily: `'${name}'` }}>{name}</button>)}</div>}
      <p className="panel-note">{t('本机字体不随导出的 HTML 一起保存，在没有这款字体的电脑上会换成系统字体。')}</p>
    </>}
  </div>
}
