import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appStylesheet, exportStylesheet } from '../src/features/reading/css'
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
})
