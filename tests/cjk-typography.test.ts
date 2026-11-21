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

describe('Western faces matched to Chinese text (T134)', () => {
  it('uses the matched registration in a Chinese document and the plain face in a Western one', async () => {
    const { matchedForCjk, cjkMatchedFamilies, CJK_MATCHED_SUFFIX, bundledFamilies } = await import('../src/features/reading/fonts')
    const style = readingStyle('paper')
    const chinese = documentTypography(defaultReadingSettings, style, 'cjk').fontFamily
    const western = documentTypography(defaultReadingSettings, style, 'latin').fontFamily
    expect(chinese).toContain("'Mino Source Serif 4 CJK'")
    expect(western).toContain("'Mino Source Serif 4'")
    expect(western).not.toContain(' CJK')
    expect(matchedForCjk("'Mino Inter', 'Mino Noto Sans SC'")).toBe("'Mino Inter', 'Mino Noto Sans SC'")
    for (const family of cjkMatchedFamilies) expect(bundledFamilies.has(family + CJK_MATCHED_SUFFIX), family).toBe(true)
  })

  it('registers each matched family on the same files with a size-adjust, in the app and in exports', async () => {
    const { cjkMatchedFamilies, CJK_MATCHED_SUFFIX } = await import('../src/features/reading/fonts')
    const { fontSizeAdjust, fontFaceRows } = await import('../src/features/reading/fontTable')
    const { cjkMatched } = await import('../scripts/generate-font-table.mjs')
    expect(Object.keys(fontSizeAdjust).sort()).toEqual(cjkMatchedFamilies.map((family) => family + CJK_MATCHED_SUFFIX).sort())
    expect(Object.keys(cjkMatched).sort()).toEqual([...cjkMatchedFamilies].sort())
    for (const [family, size] of Object.entries(fontSizeAdjust)) {
      const percent = Number(size.replace('%', ''))
      expect(percent, family).toBeGreaterThan(100)
      expect(percent, family).toBeLessThanOrEqual(112)
      const plain = family.slice(0, -CJK_MATCHED_SUFFIX.length)
      expect(fontFaceRows.filter((row) => row[0] === family).map((row) => row[1])).toEqual(fontFaceRows.filter((row) => row[0] === plain).map((row) => row[1]))
    }
    const css = readFileSync('src/features/reading/bundledFonts.css', 'utf8')
    expect(css).toContain("font-family:'Mino Source Serif 4 CJK'")
    expect(css.match(/size-adjust:108%/g)?.length).toBe(fontFaceRows.filter((row) => row[0] === 'Mino Source Serif 4 CJK').length)
  })

  it('carries the size into the faces an export embeds', async () => {
    const { bundledFaces, fontFaceCss } = await import('../src/features/reading/fontFaces')
    const face = bundledFaces.find((item) => item.family === 'Mino Literata CJK')!
    expect(face.sizeAdjust).toBe('103%')
    expect(fontFaceCss([face])).toContain('size-adjust:103%;')
    expect(fontFaceCss([bundledFaces.find((item) => item.family === 'Mino Literata')!])).not.toContain('size-adjust')
  })
})
