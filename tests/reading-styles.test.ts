import { describe, expect, it } from 'vitest'
import { contrast, parseHex, toHsl } from '../src/features/reading/color'
import { appStylesheet, documentElementCss, styleVariables, typographyVariables, DOC_ROOT } from '../src/features/reading/css'
import { readingStyle, readingStyles, resolveStyleId, styleIds, themeIds, type ReadingStyle } from '../src/features/reading/styles'
import { activeStyle, defaultReadingSettings, documentFontFamily, documentTypography } from '../src/app/readingSettings'
import { fontFamilies } from '../src/app/appearance'

const colorFields = ['paper', 'text', 'secondary', 'link', 'heading', 'muted', 'codeInk', 'codeBg', 'quoteLine', 'rule', 'tableLine', 'tableRule', 'selection', 'desk', 'edge'] as const

describe('reading styles', () => {
  it('lists the 14 charter styles with every field filled in', () => {
    expect(styleIds).toEqual(['light', 'paper', 'xuan', 'kraft', 'parchment', 'newsprint', 'mint', 'butter', 'eink', 'amber', 'graphite', 'dark', 'ink', 'blueprint'])
    expect(readingStyles.map((style) => style.id)).toEqual([...styleIds])
    for (const style of readingStyles) {
      expect(style.name.length, style.id).toBeGreaterThan(0)
      for (const field of colorFields) expect(() => parseHex(style[field]), `${style.id}.${field}`).not.toThrow()
      for (const [name, value] of Object.entries(style.ui)) expect(() => parseHex(value), `${style.id}.ui.${name}`).not.toThrow()
    }
  })

  it('keeps every theme ID that settings written before T51 may hold', () => {
    for (const id of ['system', 'light', 'dark', 'paper', 'graphite', 'blueprint', 'mint', 'butter', 'eink']) expect(themeIds).toContain(id)
  })

  it('keeps body text between 7:1 and 15:1 and secondary text and links at 4.5:1 or more', () => {
    for (const style of readingStyles) {
      const body = contrast(style.text, style.paper)
      expect(body, `${style.id} body ${body.toFixed(2)}`).toBeGreaterThanOrEqual(7)
      expect(body, `${style.id} body ${body.toFixed(2)}`).toBeLessThanOrEqual(15)
      expect(contrast(style.secondary, style.paper), `${style.id} secondary`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style.link, style.paper), `${style.id} link`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style.codeInk, style.codeBg), `${style.id} code`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style.heading, style.paper), `${style.id} heading`).toBeGreaterThanOrEqual(contrast(style.text, style.paper) - 0.01)
    }
  })

  it('derives quiet chrome: at most half the page saturation, and dark chrome for night styles', () => {
    for (const style of readingStyles) {
      const page = toHsl(style.paper)[1]
      for (const field of ['sidebar', 'chrome', 'raised'] as const) expect(toHsl(style.ui[field])[1], `${style.id}.${field}`).toBeLessThanOrEqual(page / 2 + 0.03) // 8-bit rounding moves near-gray saturation
      expect(style.dark).toBe(style.group === 'night')
      expect(toHsl(style.ui.chrome)[2] < 0.5).toBe(style.dark)
    }
  })

  it('uses offline paper tiles for the paper styles only and no generated SVG noise', () => {
    const textured = readingStyles.filter((style) => style.texture).map((style) => style.id)
    expect(textured).toEqual(['paper', 'xuan', 'kraft', 'parchment', 'newsprint', 'butter'])
    const css = appStylesheet()
    expect(css).not.toMatch(/feTurbulence|svg\+xml/)
    expect(css).not.toMatch(/https?:\/\//)
    for (const style of readingStyles) expect(css).toContain(`:root[data-theme="${style.id}"]`)
    expect(styleVariables(readingStyle('paper'))['--paper-texture']).toMatch(/^url\("data:image\/png;base64,/)
    expect(styleVariables(readingStyle('mint'))['--paper-texture']).toBe('none')
  })

  it('resolves the system choice to the day or night style', () => {
    expect(resolveStyleId('system', 'paper', 'graphite', false)).toBe('paper')
    expect(resolveStyleId('system', 'paper', 'graphite', true)).toBe('graphite')
    expect(resolveStyleId('kraft', 'paper', 'graphite', true)).toBe('kraft')
    expect(resolveStyleId('neon', 'paper', 'graphite', true)).toBe('dark')
    // Pre-T51 settings files get light and dark as their day and night styles from settings.rs.
    expect(activeStyle({ theme: 'system', dayTheme: 'light', nightTheme: 'dark' }, true).id).toBe('dark')
  })

  it('maps typography settings to CSS variables', () => {
    const style = readingStyle('graphite')
    const vars = typographyVariables(documentTypography({ ...defaultReadingSettings, paragraphSpacing: 'relaxed', measure: '30', textAlign: 'justify', firstLineIndent: true }, style), style)
    expect(vars).toMatchObject({ '--doc-gap': '1.3em', '--doc-measure': '30em', '--doc-align': 'justify', '--doc-indent': '2em', '--image-filter': 'brightness(.9)' })
    expect(typographyVariables(documentTypography({ ...defaultReadingSettings, measure: 'unlimited', imageDimming: false }, style), style)).toMatchObject({ '--doc-measure': '896px', '--image-filter': 'none' })
    expect(typographyVariables(documentTypography(defaultReadingSettings, readingStyle('paper')), readingStyle('paper'))['--image-filter']).toBe('none')
  })

  it('follows the style font unless a preset or an older system font was chosen', () => {
    const paper = readingStyle('paper') as ReadingStyle
    expect(documentFontFamily({ fontPreset: 'auto', editorFont: 'system' }, paper)).toContain('Mino Noto Serif SC')
    expect(documentFontFamily({ fontPreset: 'auto', editorFont: 'system' }, readingStyle('xuan'))).toContain('Mino LXGW WenKai')
    expect(documentFontFamily({ fontPreset: 'hei', editorFont: 'system' }, paper)).toContain('PingFang SC')
    expect(documentFontFamily({ fontPreset: 'system', editorFont: 'kaiti' }, paper)).toBe(fontFamilies.kaiti)
  })

  it('indents only top-level paragraphs', () => {
    const css = documentElementCss(DOC_ROOT)
    expect(css).toContain('.mino-doc > p{text-indent:var(--doc-indent)}')
    expect(css).toContain('.mino-doc blockquote p{text-indent:0}')
  })
})
