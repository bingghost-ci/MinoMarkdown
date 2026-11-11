import './helpers/bundled-font-css'
import { describe, expect, it } from 'vitest'
import { buildExportStyle, HTML_FONT_BUDGET, PRINT_FONT_BUDGET, withoutBundledFonts } from '../src/features/export/exportStyle'
import { renderExport } from '../src/features/export/renderHtml'
import { PAGE_RADIUS } from '../src/features/reading/css'
import { fontStack, KAI_FAMILY, MONO_FAMILY, SERIF_FAMILY, SOURCE_SERIF_FAMILY, type FontFace } from '../src/features/reading/fonts'
import { readingStyle } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'

const face = (file: string, ranges: [number, number][] | null, family = SERIF_FAMILY, style: FontFace['style'] = 'normal', weight = '400'): FontFace => ({ family, weight, style, file, url: `/assets/${file}`, ranges, unicodeRange: ranges ? ranges.map(([a, b]) => `U+${a.toString(16)}-${b.toString(16)}`).join(',') : null })
const latin: [number, number][] = [[0x20, 0x7e]]
const faces = [
  face('latin.woff2', latin), face('cjk-a.woff2', [[0x4e00, 0x7fff]]), face('cjk-b.woff2', [[0x8000, 0x9fff]]), face('cyrillic.woff2', [[0x400, 0x4ff]]),
  face('kai.woff2', null, KAI_FAMILY),
  face('source-serif.woff2', latin, SOURCE_SERIF_FAMILY, 'normal', '200 900'), face('source-serif-italic.woff2', latin, SOURCE_SERIF_FAMILY, 'italic', '200 900'), face('source-serif-ext.woff2', [[0x100, 0x24f]], SOURCE_SERIF_FAMILY, 'normal', '200 900'),
  face('mono.woff2', latin, MONO_FAMILY, 'normal', '100 800'), face('mono-italic.woff2', latin, MONO_FAMILY, 'italic', '100 800'), face('mono-ext.woff2', [[0x100, 0x24f]], MONO_FAMILY, 'normal', '100 800'),
]

function input(overrides: Partial<Parameters<typeof buildExportStyle>[0]> = {}) {
  const style = overrides.style ?? readingStyle('paper')
  const read: string[] = []
  return {
    read,
    value: { style, typography: documentTypography(defaultReadingSettings, style), exportStyle: 'current' as const, pdfMode: 'print' as const, pageSize: 'a4' as const, pageMargin: 'standard' as const, text: '读书 Reading', mode: 'html' as const, faces, readAsset: async (path: string) => { read.push(path); return new Uint8Array([1, 2, 3]) }, ...overrides },
  }
}
const docFont = (stylesheet: string) => /--doc-font:([^;]*);/.exec(stylesheet)![1]

/** Anything that would make a page fetch a file: url() that is not data:, src/href to a scheme, @import. */
function externalReferences(html: string): string[] {
  return [
    ...html.matchAll(/url\(\s*(?!["']?data:)[^)]*\)/gi),
    ...html.matchAll(/\s(?:src|href)\s*=\s*["']?(?:https?:|\/\/|file:|mino-asset:|\/)/gi),
    ...html.matchAll(/@import/gi),
  ].map((match) => match[0])
}

describe('export style', () => {
  it('embeds only the font subsets whose ranges cover characters of the document', async () => {
    const { read, value } = input()
    const result = await buildExportStyle(value)
    // The paper style: Source Serif for Latin, Noto Serif SC for Chinese, and the monospace Latin subset for code.
    expect(read.sort()).toEqual(['/assets/cjk-a.woff2', '/assets/cjk-b.woff2', '/assets/latin.woff2', '/assets/mono.woff2', '/assets/source-serif.woff2'])
    expect(result.fontsEmbedded).toBe(true)
    expect(result.fontFallback).toBe(false)
    expect(result.fontBytes).toBe(15)
    expect(result.diagramStyleId).toBe('paper')
    expect(result.stylesheet).toContain(`font-family:'${SERIF_FAMILY}'`)
    expect(result.stylesheet).toContain(`font-family:'${SOURCE_SERIF_FAMILY}';font-style:normal;font-weight:200 900;`)
    expect(result.stylesheet).toContain(`font-family:'${MONO_FAMILY}';font-style:normal;`)
    expect(result.stylesheet).toContain('src:url(data:font/woff2;base64,AQID)')
    expect(result.stylesheet.match(/@font-face/g)?.length).toBe(5)
    expect(result.stylesheet).not.toContain('font-style:italic')
    expect(result.stylesheet).not.toContain('/assets/')
    expect(docFont(result.stylesheet)).toBe(fontStack('auto', 'auto', 'song'))
  })

  it('embeds italic faces only for a document with emphasis', async () => {
    const emphasis = input({ text: '读书 *Reading* 笔记' })
    await buildExportStyle(emphasis.value)
    expect(emphasis.read.sort()).toEqual(['/assets/cjk-a.woff2', '/assets/cjk-b.woff2', '/assets/latin.woff2', '/assets/mono-italic.woff2', '/assets/mono.woff2', '/assets/source-serif-italic.woff2', '/assets/source-serif.woff2'])
    const underscore = input({ text: '_Reading_' })
    const withUnderscore = await buildExportStyle(underscore.value)
    expect(underscore.read).toContain('/assets/source-serif-italic.woff2')
    expect(withUnderscore.stylesheet).toContain(`font-family:'${SOURCE_SERIF_FAMILY}';font-style:italic;`)
    // Bold, list bullets and escaped asterisks are not emphasis.
    for (const text of ['读书 **Reading** 笔记', '* Reading\n* Notes\n', 'Reading \\*notes\\*', '2 * 3 = 6']) {
      const plain = input({ text })
      await buildExportStyle(plain.value)
      expect(plain.read.filter((path) => path.includes('italic')), text).toEqual([])
    }
    const accented = input({ text: 'Dvořák' })
    await buildExportStyle(accented.value)
    expect(accented.read.sort()).toEqual(['/assets/latin.woff2', '/assets/mono-ext.woff2', '/assets/mono.woff2', '/assets/source-serif-ext.woff2', '/assets/source-serif.woff2'])
  })

  it('embeds the fonts of the chosen stack, and whole-file fonts whole', async () => {
    const xuan = input({ style: readingStyle('xuan') })
    const kai = await buildExportStyle(xuan.value)
    expect(xuan.read.sort()).toEqual(['/assets/kai.woff2', '/assets/mono.woff2'])
    expect(kai.stylesheet).toContain(`font-family:'${KAI_FAMILY}'`)
    const style = readingStyle('white')
    const chosen = input({ style, typography: documentTypography({ ...defaultReadingSettings, cjkFont: 'song', latinFont: 'sys:Georgia' }, style) })
    const result = await buildExportStyle(chosen.value)
    expect(chosen.read.sort()).toEqual(['/assets/cjk-a.woff2', '/assets/cjk-b.woff2', '/assets/latin.woff2', '/assets/mono.woff2'])
    expect(docFont(result.stylesheet).startsWith(`'Georgia', '${SERIF_FAMILY}'`)).toBe(true)
    // Faces that are already data URIs are used as they are.
    const inline = { ...face('inline.woff2', latin), url: 'data:font/woff2;base64,AAAA' }
    const data = input({ faces: [inline] })
    const embedded = await buildExportStyle(data.value)
    expect(data.read).toEqual([])
    expect(embedded.fontsEmbedded).toBe(true)
    expect(embedded.stylesheet).toContain('src:url(data:font/woff2;base64,AAAA)')
  })

  it('falls back to system fonts when the subsets exceed the HTML budget or cannot be read', async () => {
    const big = await buildExportStyle(input({ readAsset: async () => new Uint8Array(HTML_FONT_BUDGET) }).value)
    expect(big.fontsEmbedded).toBe(false)
    expect(big.fontFallback).toBe(true)
    expect(big.fontBytes).toBe(0)
    expect(big.stylesheet).not.toContain('@font-face')
    expect(big.stylesheet).not.toContain(SERIF_FAMILY)
    expect(big.stylesheet).not.toContain(SOURCE_SERIF_FAMILY)
    expect(docFont(big.stylesheet)).toBe("'Songti SC', 'STSong', 'Songti SC', 'STSong', serif")
    const missing = await buildExportStyle(input({ readAsset: async () => { throw new Error('ASSET_NOT_FOUND') } }).value)
    expect(missing.fontFallback).toBe(true)
    expect(missing.fontsEmbedded).toBe(false)
    expect(docFont(missing.stylesheet)).not.toContain('Mino ')
    // A page for printing is never saved, so it may carry more.
    expect(PRINT_FONT_BUDGET).toBeGreaterThan(HTML_FONT_BUDGET)
    const printed = await buildExportStyle(input({ mode: 'print', readAsset: async () => new Uint8Array(HTML_FONT_BUDGET / 4) }).value)
    expect(printed.fontFallback).toBe(false)
    expect(printed.fontBytes).toBe(5 * HTML_FONT_BUDGET / 4)
    const exact = await buildExportStyle(input({ text: '书', readAsset: async () => new Uint8Array(HTML_FONT_BUDGET) }).value)
    expect(exact.fontFallback, 'exactly the budget is allowed').toBe(false)
    // Only bundled families are stripped: a system font someone chose stays.
    expect(withoutBundledFonts(fontStack('auto', 'auto', 'kai'))).toBe("'Kaiti SC', 'STKaiti', 'Songti SC', 'STSong', serif")
    const style = readingStyle('paper')
    const chosen = await buildExportStyle(input({ typography: documentTypography({ ...defaultReadingSettings, cjkFont: 'kai', latinFont: 'sys:Georgia' }, style), readAsset: async () => { throw new Error('ASSET_NOT_FOUND') } }).value)
    expect(docFont(chosen.stylesheet)).toBe("'Georgia', 'Kaiti SC', 'STKaiti', 'Songti SC', 'STSong', serif")
  })

  it('needs only the monospace Latin subset for the system sans font, and no files without Latin text', async () => {
    const style = readingStyle('white')
    const { read, value } = input({ style, typography: documentTypography(defaultReadingSettings, style) })
    const result = await buildExportStyle(value)
    expect(read).toEqual(['/assets/mono.woff2'])
    expect(result.fontsEmbedded).toBe(true)
    expect(docFont(result.stylesheet)).not.toContain('Mino ')
    const chinese = input({ style, typography: documentTypography(defaultReadingSettings, style), text: '读书' })
    const none = await buildExportStyle(chinese.value)
    expect(chinese.read).toEqual([])
    expect(none.fontsEmbedded).toBe(false)
    expect(none.fontFallback).toBe(false)
  })

  it('prints on white with dark ink for night styles and draws their diagrams in the white style', async () => {
    for (const id of ['dark', 'charcoal', 'graphite']) {
      const style = readingStyle(id)
      const result = await buildExportStyle(input({ style, mode: 'print' }).value)
      expect(result.diagramStyleId, id).toBe('white')
      expect(result.stylesheet, id).toMatch(/@media print\{:root\{color-scheme:light;--surface:#ffffff;--text:#2a2d33;/)
      expect(result.stylesheet, id).toContain('@media print{:root{')
      expect(/@media print\{:root\{[^}]*\}/.exec(result.stylesheet)![0], id).toContain('--paper-texture:none;')
      // On screen the exported page keeps the night style.
      expect(result.stylesheet, id).toContain(`:root{color-scheme:dark;--surface:${style.paper};`)
      expect((await buildExportStyle(input({ style, mode: 'html' }).value)).diagramStyleId, id).toBe(style.id)
      expect((await buildExportStyle(input({ style, mode: 'print', pdfMode: 'screen' }).value)).diagramStyleId, id).toBe(style.id)
      expect((await buildExportStyle(input({ style, mode: 'print', exportStyle: 'plain' }).value)).diagramStyleId, id).toBe('white')
    }
    // A day style prints on white with its own ink and without its texture.
    const paper = await buildExportStyle(input({ mode: 'print' }).value)
    expect(paper.diagramStyleId).toBe('paper')
    const printBlock = /@media print\{:root\{[^}]*\}/.exec(paper.stylesheet)![0]
    expect(printBlock).toContain(`--surface:#ffffff;--text:${readingStyle('paper').text};`)
    expect(printBlock).toContain('--paper-texture:none;')
    expect(printBlock).toContain('--paper-veil:none;')
    const screen = await buildExportStyle(input({ pdfMode: 'screen', mode: 'print' }).value)
    expect(screen.stylesheet).toContain('print-color-adjust:exact')
    expect(screen.stylesheet).not.toContain('@media print{:root{')
    expect(screen.stylesheet).toContain('@page{size:A4;margin:18mm}')
    const letter = await buildExportStyle(input({ pageSize: 'letter', pageMargin: 'wide' }).value)
    expect(letter.stylesheet).toContain('@page{size:letter;margin:25mm}')
    const plain = await buildExportStyle(input({ exportStyle: 'plain' }).value)
    expect(plain.stylesheet).toContain(':root{color-scheme:light;--surface:#ffffff;')
    expect(plain.diagramStyleId).toBe('white')
  })

  it('carries the page card, the paper layers with their veil and the hyphenation variables', async () => {
    const paper = (await buildExportStyle(input().value)).stylesheet
    expect(PAGE_RADIUS).toBe(14)
    expect(paper).toContain(`border-radius:${PAGE_RADIUS}px`)
    expect(paper).toMatch(/\.mino-page\{[^}]*background-image:var\(--paper-veil,none\),var\(--paper-texture\);[^}]*box-shadow:var\(--page-aging\),var\(--page-shadow\)\}/)
    // Printing drops the card.
    expect(paper).toMatch(/@media print\{body\{padding:0\}\.mino-page\{[^}]*border-radius:0;box-shadow:none;background:none\}/)
    expect(paper).toMatch(/--paper-texture:url\("data:image\/png;base64,/)
    expect(paper).toMatch(/--paper-veil:linear-gradient\(rgba\(246,239,224,0\.40\),rgba\(246,239,224,0\.40\)\);/)
    expect(paper).toContain('--doc-hyphens:manual;')
    expect(paper).toContain('-webkit-hyphens:var(--doc-hyphens,manual);hyphens:var(--doc-hyphens,manual)')
    expect(paper).toContain('--doc-measure:36em;')
    expect(paper).toContain(`--title:${readingStyle('paper').link};`)
    expect(paper).toContain(`--code-font:'${MONO_FAMILY}', ui-monospace`)
    const style = readingStyle('paper')
    const western = (await buildExportStyle(input({ typography: documentTypography(defaultReadingSettings, style, 'latin') }).value)).stylesheet
    expect(western).toContain('--doc-hyphens:auto;')
    expect(western).toContain('--doc-justify:auto;')
    expect(western).toContain('--doc-measure:32em;')
    expect(western).toContain('--doc-align:justify;')
    const full = (await buildExportStyle(input({ typography: { ...documentTypography(defaultReadingSettings, style), textureStrength: 100 } }).value)).stylesheet
    expect(/^:root\{[^}]*\}/m.exec(full)![0]).toContain('--paper-veil:none;')
    const parchment = (await buildExportStyle(input({ style: readingStyle('parchment') }).value)).stylesheet
    expect(parchment).toMatch(/--page-aging:inset 0 0 120px -30px rgba\(\d+,\d+,\d+,0\.30\),/)
    expect((await buildExportStyle(input({ style: readingStyle('white') }).value)).stylesheet).toContain('--paper-texture:none;')
  })

  it('writes a page with the style inlined, a data-only font CSP and no external references', async () => {
    const look = await buildExportStyle(input().value)
    const { html } = await renderExport('# 标题\n\n正文 **粗体**\n\n![图](assets/a.png "图 1　说明")\n', '导出', async () => ({ mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }), new Map(), { stylesheet: look.stylesheet, fontsEmbedded: look.fontsEmbedded })
    expect(html).toContain("font-src data:\"")
    expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:")
    expect(html).toContain('<main class="mino-page"><article class="mino-doc">')
    expect(html).toContain('<figure class="mino-figure"><img src="data:image/png;base64,iVBORw==" alt="图" title="图 1　说明"><figcaption>图 1　说明</figcaption></figure>')
    expect(html).toContain('url("data:image/png;base64,')
    expect(externalReferences(html)).toEqual([])
    expect(html).not.toMatch(/https?:\/\//)
    const plainCsp = await renderExport('正文', '导出', async () => null)
    expect(plainCsp.html).toContain("font-src 'none'")
    for (const id of ['white', 'mist', 'xuan', 'parchment', 'kraft', 'mint', 'charcoal', 'dark', 'gray', 'slate', 'dusk']) {
      const other = await buildExportStyle(input({ style: readingStyle(id) }).value)
      expect(externalReferences(other.stylesheet), id).toEqual([])
      expect(other.stylesheet, id).not.toMatch(/https?:\/\/|feTurbulence/)
    }
  })

  it('marks the language of the page: Chinese by default, English for a Western document', async () => {
    const resolve = async () => null
    expect((await renderExport('正文', '导出', resolve)).html).toMatch(/^<!doctype html>\n<html lang="zh-CN">/)
    expect((await renderExport('正文', '导出', resolve, new Map(), {})).html).toContain('<html lang="zh-CN">')
    expect((await renderExport('正文', '导出', resolve, new Map(), { lang: 'zh-CN' })).html).toContain('<html lang="zh-CN">')
    const english = await renderExport('Some text.', 'Export', resolve, new Map(), { lang: 'en' })
    expect(english.html).toMatch(/^<!doctype html>\n<html lang="en">/)
    expect(english.html.match(/<html /g)?.length).toBe(1)
    // Anything else cannot reach the attribute.
    const odd = await renderExport('x', 'x', resolve, new Map(), { lang: 'en"><script>' as 'en' })
    expect(odd.html).toContain('<html lang="zh-CN">')
  })

  it('makes captions from the title or alt text, as text only, and can leave them out', async () => {
    const resolve = async () => ({ mime: 'image/png', bytes: new Uint8Array([1]) })
    const alt = await renderExport('![<b>夜</b>景](assets/a.png)\n', 'x', resolve)
    expect(alt.html).toContain('<figcaption>&#x3C;b>夜&#x3C;/b>景</figcaption>')
    const inline = await renderExport('文字中间 ![图](assets/a.png) 的图片\n', 'x', resolve)
    expect(inline.html).not.toContain('<figure')
    const off = await renderExport('![图](assets/a.png "说明")\n', 'x', resolve, new Map(), { captions: false })
    expect(off.html).toContain('<figure class="mino-figure"><img')
    expect(off.html).not.toContain('figcaption')
  })
})
