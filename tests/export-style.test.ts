import { describe, expect, it } from 'vitest'
import { buildExportStyle, HTML_FONT_BUDGET, withoutBundledFonts } from '../src/features/export/exportStyle'
import { renderExport } from '../src/features/export/renderHtml'
import { presetFamilies, KAI_FAMILY, SERIF_FAMILY, type FontFace } from '../src/features/reading/fonts'
import { readingStyle } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'

const face = (file: string, ranges: [number, number][] | null, family = SERIF_FAMILY, weight = '400'): FontFace => ({ family, weight, file, url: `/assets/${file}`, ranges, unicodeRange: ranges ? ranges.map(([a, b]) => `U+${a.toString(16)}-${b.toString(16)}`).join(',') : null })
const faces = [face('latin.woff2', [[0x20, 0x7e]]), face('cjk-a.woff2', [[0x4e00, 0x7fff]]), face('cjk-b.woff2', [[0x8000, 0x9fff]]), face('cyrillic.woff2', [[0x400, 0x4ff]]), face('kai.woff2', null, KAI_FAMILY)]

function input(overrides: Partial<Parameters<typeof buildExportStyle>[0]> = {}) {
  const style = readingStyle('paper')
  const read: string[] = []
  return {
    read,
    value: { style, typography: documentTypography(defaultReadingSettings, style), exportStyle: 'current' as const, pdfMode: 'print' as const, pageSize: 'a4' as const, pageMargin: 'standard' as const, text: '读书 Reading', mode: 'html' as const, faces, readAsset: async (path: string) => { read.push(path); return new Uint8Array([1, 2, 3]) }, ...overrides },
  }
}

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
    expect(read.sort()).toEqual(['/assets/cjk-a.woff2', '/assets/cjk-b.woff2', '/assets/latin.woff2'])
    expect(result.fontsEmbedded).toBe(true)
    expect(result.fontFallback).toBe(false)
    expect(result.stylesheet).toContain(`font-family:'${SERIF_FAMILY}'`)
    expect(result.stylesheet).toContain('src:url(data:font/woff2;base64,AQID)')
    expect(result.stylesheet).not.toContain('/assets/')
  })

  it('falls back to system fonts when the subsets exceed the HTML budget or cannot be read', async () => {
    const big = await buildExportStyle(input({ readAsset: async () => new Uint8Array(HTML_FONT_BUDGET) }).value)
    expect(big.fontsEmbedded).toBe(false)
    expect(big.fontFallback).toBe(true)
    expect(big.stylesheet).not.toContain(SERIF_FAMILY)
    expect(big.stylesheet).toContain("'Songti SC'")
    const missing = await buildExportStyle(input({ readAsset: async () => { throw new Error('ASSET_NOT_FOUND') } }).value)
    expect(missing.fontFallback).toBe(true)
    expect(withoutBundledFonts(presetFamilies.kai)).toBe("'Kaiti SC', 'STKaiti', serif")
  })

  it('needs no font files for the sans preset', async () => {
    const style = readingStyle('light')
    const { read, value } = input({ style, typography: documentTypography(defaultReadingSettings, style) })
    const result = await buildExportStyle(value)
    expect(read).toEqual([])
    expect(result.fontsEmbedded).toBe(false)
  })

  it('prints on white with dark ink for night styles and draws their diagrams in the light style', async () => {
    const style = readingStyle('graphite')
    const result = await buildExportStyle(input({ style, typography: documentTypography(defaultReadingSettings, style), mode: 'print' }).value)
    expect(result.diagramStyleId).toBe('light')
    expect(result.stylesheet).toMatch(/@media print\{:root\{[^}]*--surface:#ffffff;[^}]*--text:#24292f;/)
    const screen = await buildExportStyle(input({ pdfMode: 'screen', mode: 'print' }).value)
    expect(screen.stylesheet).toContain('print-color-adjust:exact')
    expect(screen.stylesheet).toContain('@page{size:A4;margin:18mm}')
    const letter = await buildExportStyle(input({ pageSize: 'letter', pageMargin: 'wide' }).value)
    expect(letter.stylesheet).toContain('@page{size:letter;margin:25mm}')
    const plain = await buildExportStyle(input({ exportStyle: 'plain' }).value)
    expect(plain.stylesheet).toContain('--surface:#ffffff;')
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
    const plainCsp = await renderExport('正文', '导出', async () => null)
    expect(plainCsp.html).toContain("font-src 'none'")
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
