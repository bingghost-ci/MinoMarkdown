import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { documentElementCss, styleVariables, typographyVariables, DOC_ROOT } from '../src/features/reading/css'
import { KAI_FAMILY } from '../src/features/reading/fonts'
import { layoutRules } from '../src/features/reading/layouts'
import { readingStyle, readingStyles } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'
import { buildExportStyle } from '../src/features/export/exportStyle'

describe('Chinese paragraphs and headings (T129)', () => {
  const style = readingStyle('white')

  it('keeps punctuation off line starts and balances the lines of a heading', () => {
    const css = documentElementCss(DOC_ROOT)
    expect(css).toContain('line-break:strict')
    expect(css).toContain('text-wrap:balance')
  })

  it('shows Chinese emphasis as the reader chose, and Western emphasis always in italics', () => {
    const vars = (emphasis: 'italic' | 'kai' | 'dot', script: 'cjk' | 'latin' = 'cjk') => typographyVariables(documentTypography({ ...defaultReadingSettings, cjkEmphasis: emphasis }, style, script), style)
    expect(vars('italic')).toMatchObject({ '--em-style': 'italic', '--em-font': 'inherit', '--em-mark': 'none' })
    expect(vars('kai')['--em-style']).toBe('normal')
    expect(vars('kai')['--em-font']).toContain(KAI_FAMILY)
    expect(vars('dot')).toMatchObject({ '--em-style': 'normal', '--em-mark': 'filled dot' })
    expect(vars('kai', 'latin')).toMatchObject({ '--em-style': 'italic', '--em-font': 'inherit' })
    expect(documentTypography({ ...defaultReadingSettings, cjkEmphasis: 'neon' as never }, style).emphasis).toBe('italic')
    expect(defaultReadingSettings.cjkEmphasis).toBe('italic')
    const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')
    expect(rust).toContain('matches!(settings.cjk_emphasis.as_str(), "italic" | "kai" | "dot")')
  })

  it('embeds the Kai face in an export only when emphasis is set in it and the text has emphasis', async () => {
    const families = async (emphasis: 'italic' | 'kai', text: string) => {
      const read: string[] = []
      await buildExportStyle({ style, typography: documentTypography({ ...defaultReadingSettings, cjkEmphasis: emphasis }, style), exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard', text, mode: 'print', readAsset: async (path) => { read.push(path); return new Uint8Array(8) } })
      return read.join(' ')
    }
    expect(await families('kai', '这是*强调*。')).toMatch(/wenkai|lxgw/i)
    expect(await families('kai', '没有强调。')).not.toMatch(/wenkai|lxgw/i)
    expect(await families('italic', '这是*强调*。')).not.toMatch(/wenkai|lxgw/i)
  })

  it('sets bold a step lighter and brighter on night papers only', () => {
    for (const item of readingStyles) {
      const vars = styleVariables(item)
      expect(vars['--strong-weight'], item.id).toBe(item.dark ? '600' : '700')
      expect(vars['--strong-ink'] === 'inherit', item.id).toBe(!item.dark)
    }
  })

  it('leaves the paragraph after a heading flush in a Western academic paper', () => {
    expect(layoutRules('academic', '.mino-doc')).toContain('.mino-doc > :is(h1,h2,h3,h4,h5,h6,hr) + p:lang(en){text-indent:0}')
  })
})
