import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appStylesheet, documentElementCss, exportStylesheet, paperPatterns, typographyVariables } from '../src/features/reading/css'
import { contrast } from '../src/features/reading/color'
import { isLayout, layoutIds, layoutRules, layouts } from '../src/features/reading/layouts'
import { MONO_FAMILY } from '../src/features/reading/fonts'
import { readingStyle } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'

const exportCss = (layout: (typeof layoutIds)[number]) => exportStylesheet({ styleId: 'white', exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard', fontFaces: '', typography: documentTypography({ ...defaultReadingSettings, layout }, readingStyle('white')) })

describe('layouts (T122)', () => {
  it('offers the same layouts as settings.rs, standard first and by default', () => {
    const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')
    const ids = /const LAYOUT_IDS: &\[&str\] = &\[([^\]]*)\]/.exec(rust)?.[1]
    expect(ids, 'LAYOUT_IDS in settings.rs').toBeTruthy()
    expect(Array.from(ids!.matchAll(/"([^"]+)"/g), (match) => match[1])).toEqual([...layoutIds])
    expect(layouts.map((layout) => layout.id)).toEqual([...layoutIds])
    expect(defaultReadingSettings.layout).toBe('standard')
    expect(isLayout('official')).toBe(true)
    expect(isLayout('fancy')).toBe(false)
    expect(layoutRules('standard', '.mino-doc')).toBe('')
  })

  it('scopes every layout by the attribute on <html> in the app, and gives an export only its own', () => {
    const app = appStylesheet()
    for (const id of layoutIds.filter((id) => id !== 'standard')) {
      expect(app).toContain(`:root[data-layout="${id}"] .editor-root .milkdown .ProseMirror`)
      expect(app).toContain(`:root[data-layout="${id}"] .mino-doc`)
    }
    const official = exportCss('official')
    expect(official).toContain('cjk-ideographic')
    expect(official).not.toContain('data-layout')
    expect(exportCss('standard')).not.toContain('mino-h2')
    expect(exportCss('technical')).not.toContain('cjk-ideographic')
  })

  it('numbers only the headings of the document itself, not those in quotes or alerts', () => {
    for (const id of ['academic', 'official', 'technical'] as const) {
      const css = layoutRules(id, '.mino-doc')
      expect(css, id).toContain('counter-increment:mino-h2')
      expect(css, id).not.toMatch(/\.mino-doc h[2-5]\{counter-increment/)
      expect(css, id).toMatch(/\.mino-doc > h2\{counter-increment/)
    }
  })

  it('sets the typewriter in the bundled monospace font, before the reader’s own, so exports embed it', () => {
    const style = readingStyle('white')
    const plain = documentTypography(defaultReadingSettings, style)
    const typewriter = documentTypography({ ...defaultReadingSettings, layout: 'typewriter' }, style)
    expect(typewriter.fontFamily).toBe(`'${MONO_FAMILY}', ${plain.fontFamily}`)
    expect(typewriter.layout).toBe('typewriter')
    expect(documentTypography({ ...defaultReadingSettings, layout: 'neon' as never }, style).layout).toBe('standard')
  })

  it('prints without widows, orphans or stranded headings, and sets an official document on its own margins (T136)', () => {
    const standard = exportCss('standard')
    expect(standard).toContain('orphans:3;widows:3')
    expect(standard).toContain('break-after:avoid-page')
    expect(standard).toContain('@page{size:A4;margin:18mm}')
    expect(exportCss('official')).toContain('@page{size:A4;margin:37mm 26mm 35mm 28mm}')
    expect(exportCss('academic')).toContain('@page{size:A4;margin:18mm}')
  })

  it('labels nested lists by depth, with LaTeX’s set in the academic layout (T126)', () => {
    const css = documentElementCss('.mino-doc')
    expect(css).toContain('.mino-doc ol ol{list-style-type:lower-alpha}')
    expect(css).toContain('.mino-doc li::marker{font-variant-numeric:tabular-nums}')
    const academic = layoutRules('academic', '.mino-doc')
    expect(academic).toContain('@counter-style mino-paren-alpha')
    expect(academic).toContain('.mino-doc ul ul > li::marker{content:"\\2013\\2002"}')
    // No layout draws anything that reads as Markdown left unrendered: no `#` before a heading, no `*` for a bullet or a rule.
    for (const id of layoutIds) expect(layoutRules(id, '.mino-doc'), id).not.toMatch(/content:"[^"]*[#*]/)
    expect(academic).toContain('.mino-doc ol ol{list-style-type:mino-paren-alpha}')
  })

  it('sets the quote under the title as the abstract and numbers figures in the academic layout only (T130)', () => {
    const academic = layoutRules('academic', '.mino-doc')
    expect(academic).toContain('.mino-doc > h1 + blockquote:not(.mino-alert)::before{content:"摘\\3000要"')
    expect(academic).toContain('.mino-doc > h1 + blockquote:not(.mino-alert):lang(en)::before{content:"Abstract"}')
    expect(academic).toContain('counter-increment:mino-figure')
    // The figure counter is reset together with the section counters: a second `counter-reset` would replace the first.
    expect(academic).toContain('counter-reset:mino-h2 mino-h3 mino-h4 mino-figure')
    for (const id of ['official', 'technical', 'typewriter'] as const) expect(layoutRules(id, '.mino-doc')).not.toContain('mino-figure')
  })
})


describe('paper rulings (T132)', () => {
  const vars = (id: string, paperPattern: 'none' | 'grid' | 'dots') => typographyVariables(documentTypography({ ...defaultReadingSettings, paperPattern }, readingStyle(id)), readingStyle(id))

  it('rules a plain paper faintly and leaves a textured one alone', () => {
    expect(vars('white', 'none')['--paper-veil']).toBe('none')
    expect(vars('white', 'grid')['--paper-veil']).toMatch(/^url\("data:image\/svg\+xml,/)
    expect(vars('white', 'dots')['--paper-veil']).not.toBe(vars('white', 'grid')['--paper-veil'])
    expect(vars('paper', 'grid')['--paper-veil']).toBe(vars('paper', 'none')['--paper-veil'])
    expect(vars('midnight', 'dots')['--paper-veil']).toMatch(/^url\(/)
    // The ink is barely off the paper: under 1.3:1.
    for (const id of ['white', 'clay', 'mint', 'charcoal', 'pine']) {
      const ink = /stroke%3D%22(%23[0-9a-f]{6})/i.exec(vars(id, 'grid')['--paper-veil'])![1].replace('%23', '#')
      expect(contrast(ink, readingStyle(id).paper), id).toBeLessThan(1.3)
      expect(contrast(ink, readingStyle(id).paper), id).toBeGreaterThan(1.05)
    }
  })

  it('offers the same rulings as settings.rs, falls back for an unknown one, and prints none', () => {
    expect(readFileSync('src-tauri/src/settings.rs', 'utf8')).toContain(`matches!(settings.paper_pattern.as_str(), ${paperPatterns.map((id) => `"${id}"`).join(' | ')})`)
    expect(documentTypography({ ...defaultReadingSettings, paperPattern: 'stripes' as never }, readingStyle('white')).paperPattern).toBe('none')
    const css = (paperPattern: 'none' | 'grid') => exportStylesheet({ styleId: 'white', exportStyle: 'current', pdfMode: 'screen', pageSize: 'a4', pageMargin: 'standard', fontFaces: '', typography: documentTypography({ ...defaultReadingSettings, paperPattern }, readingStyle('white')) })
    expect(css('grid')).toContain('@media print{:root{--paper-veil:none}}')
    expect(css('none')).not.toContain('@media print{:root{--paper-veil:none}}')
  })
})
