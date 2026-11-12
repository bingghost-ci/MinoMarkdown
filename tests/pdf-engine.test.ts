import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultFindOptions } from '../src/features/editor/find'
import { assemblePdfText, clampScale, fitWidthScale, joinTextItems, looksScanned, MAX_CANVAS_PIXELS, MAX_SCALE, MIN_SCALE, openPdf, outputScale, pageAtOffset, pageHeading, pdfOutline, PdfTextCache, RANGE_CHUNK, resolveDestination, searchPages, zoomedScale, type PdfLibrary, type PdfSource } from '../src/features/pdf/pdfEngine'

// The same build the app loads. In Node it runs its worker code on the calling thread.
const library = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfLibrary

/** A `PdfSource` over a file on disk, recording what was asked of it. */
function sourceOf(name: string) {
  const bytes = new Uint8Array(readFileSync(`tests/fixtures/formats/${name}`))
  const reads: [number, number][] = []
  const assets: string[] = []
  const source: PdfSource = {
    size: bytes.length,
    read: async (offset, length) => { reads.push([offset, length]); return bytes.slice(offset, offset + length) },
    readAsset: async (path) => {
      assets.push(path)
      if (!path.startsWith('/pdfjs/') || path.includes('..')) throw new Error('OUT_OF_SCOPE')
      return new Uint8Array(readFileSync(`node_modules/pdfjs-dist/${path.slice('/pdfjs/'.length)}`))
    },
  }
  return { source, reads, assets, bytes }
}

describe('T86 opening a PDF through checked ranges', () => {
  it('reads the document only through the source, in bounded ranges', async () => {
    const { source, reads, bytes } = sourceOf('sample.pdf')
    const document = await openPdf(library, source)
    expect(document.numPages).toBe(3)
    expect(reads.length).toBeGreaterThan(0)
    for (const [offset, length] of reads) {
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(length).toBeGreaterThan(0)
      expect(length).toBeLessThanOrEqual(RANGE_CHUNK)
      expect(offset).toBeLessThan(bytes.length)
    }
    const sizes = await Promise.all([1, 2, 3].map(async (page) => { const viewport = (await document.getPage(page)).getViewport({ scale: 1 }); return [viewport.width, viewport.height] }))
    expect(sizes).toEqual([[612, 792], [595, 842], [612, 792]])
    await document.loadingTask.destroy()
  })

  it('extracts text, taking CJK character maps from the bundled files', async () => {
    const { source, assets } = sourceOf('sample.pdf')
    const document = await openPdf(library, source)
    const cache = new PdfTextCache(document)
    const pages = await cache.all(Number.MAX_SAFE_INTEGER)
    expect(pages).toHaveLength(3)
    expect(pages[0]).toContain('Mino sample document')
    expect(pages[0]).toContain('The quick brown fox jumps over the lazy dog.')
    expect(pages[1]).toContain('第二页 中文内容')
    expect(pages[1]).toContain('灯塔比照片里看起来更高，守塔人递给他一杯茶。')
    expect(pages[2]).toContain('Appendix')
    // The character maps came through `readAsset`, never through a URL.
    expect(assets.some((path) => /^\/pdfjs\/cmaps\/[\w-]+\.bcmap$/.test(path))).toBe(true)
    for (const path of assets) expect(path).toMatch(/^\/pdfjs\/(?:cmaps|standard_fonts)\/[\w.-]+$/)
    // A page is read once however often it is asked for.
    expect(await cache.page(2)).toBe(pages[1])
    await document.loadingTask.destroy()
  })

  it('reports a failed range once and stops', async () => {
    const { source } = sourceOf('sample.pdf')
    const errors: string[] = []
    const failing: PdfSource = { ...source, read: async () => { throw new Error('CHANGED') } }
    await expect(openPdf(library, failing, { onReadError: (code) => errors.push(code) })).rejects.toThrow('CHANGED')
    expect(errors).toEqual(['CHANGED'])
  })

  it('rejects a file that is not a PDF', async () => {
    const { source } = sourceOf('not-a.pdf')
    await expect(openPdf(library, source)).rejects.toMatchObject({ name: 'InvalidPDFException' })
  })
})

describe('T87 bookmarks, search and position', () => {
  it('turns nested bookmarks into outline items that point at pages', async () => {
    const document = await openPdf(library, sourceOf('sample.pdf').source)
    expect(await pdfOutline(document)).toEqual([
      { level: 1, text: 'Introduction', target: 1 },
      { level: 2, text: '第二页 中文内容', target: 2 },
      { level: 1, text: 'Appendix', target: 3 },
    ])
    const annotations = await (await document.getPage(1)).getAnnotations() as { subtype: string; url?: string; dest?: unknown[] | string | null }[]
    const links = annotations.filter((item) => item.subtype === 'Link')
    expect(links.map((item) => item.url ?? null)).toEqual(['https://example.com/mino', null])
    expect(await resolveDestination(document, links[1].dest ?? null)).toBe(3)
    expect(await resolveDestination(document, 'no-such-destination')).toBeNull()
    expect(await resolveDestination(document, null)).toBeNull()
    await document.loadingTask.destroy()
  })

  it('has no outline and no text for a scan', async () => {
    const document = await openPdf(library, sourceOf('scanned.pdf').source)
    expect(await pdfOutline(document)).toEqual([])
    const pages = await new PdfTextCache(document).all(Number.MAX_SAFE_INTEGER)
    expect(pages).toEqual(['', ''])
    const text = assemblePdfText(pages, document.numPages, 1000)
    expect(text).toEqual({ text: '', pages: 2, textPages: 0, truncated: false, scanned: true })
    await document.loadingTask.destroy()
  })

  it('searches page texts in reading order', () => {
    const texts = ['The fox and the Fox.', '没有匹配', 'A fox again; foxes too.']
    expect(searchPages(texts, 'fox', defaultFindOptions)).toEqual([{ page: 1, from: 4, to: 7 }, { page: 1, from: 16, to: 19 }, { page: 3, from: 2, to: 5 }, { page: 3, from: 13, to: 16 }])
    expect(searchPages(texts, 'fox', { ...defaultFindOptions, caseSensitive: true })).toHaveLength(3)
    expect(searchPages(texts, 'fox', { ...defaultFindOptions, wholeWord: true })).toHaveLength(3)
    expect(searchPages(texts, '匹配', defaultFindOptions)).toEqual([{ page: 2, from: 2, to: 4 }])
    expect(searchPages(texts, '', defaultFindOptions)).toEqual([])
    expect(searchPages(['aaaa'], 'a', defaultFindOptions, 3)).toHaveLength(3)
  })

  it('joins text items and remembers where each starts', () => {
    const joined = joinTextItems([{ str: 'Hello', hasEOL: false }, { type: 'beginMarkedContent' }, { str: ' world', hasEOL: true }, { str: '次行' }])
    expect(joined.text).toBe('Hello world\n次行')
    expect(joined.starts).toEqual([0, -1, 5, 12])
  })

  it('assembles text for the assistant page by page, within a budget', () => {
    const text = assemblePdfText(['first page text, long enough to count', '   ', 'third page text, also long enough'], 3, 10_000)
    expect(text.text).toBe(`${pageHeading(1)}\nfirst page text, long enough to count\n\n${pageHeading(3)}\nthird page text, also long enough`)
    expect(text).toMatchObject({ pages: 3, textPages: 2, truncated: false, scanned: false })
    const cut = assemblePdfText(['a'.repeat(500), 'b'.repeat(500)], 2, 600)
    expect(cut.truncated).toBe(true)
    expect(cut.text.length).toBeLessThanOrEqual(602)
    expect(cut.text).toContain(pageHeading(2))
    // Fewer pages were read than the document has: the reader is told.
    expect(assemblePdfText(['some text here on the page'], 40, 10_000).truncated).toBe(true)
  })

  it('tells a scan from a document with text', () => {
    expect(looksScanned(10, 0)).toBe(true)
    expect(looksScanned(10, 60)).toBe(true)
    expect(looksScanned(10, 5000)).toBe(false)
    expect(looksScanned(0, 0)).toBe(false)
  })

  it('finds the page at a scroll offset', () => {
    const tops = [24, 830, 1686]
    const heights = [792, 842, 792]
    expect(pageAtOffset(tops, heights, 0)).toEqual({ page: 1, fraction: 0 })
    expect(pageAtOffset(tops, heights, 24 + 396)).toEqual({ page: 1, fraction: 0.5 })
    expect(pageAtOffset(tops, heights, 829)).toEqual({ page: 1, fraction: 1 })
    expect(pageAtOffset(tops, heights, 830)).toEqual({ page: 2, fraction: 0 })
    expect(pageAtOffset(tops, heights, 99_999)).toEqual({ page: 3, fraction: 1 })
    expect(pageAtOffset([], [], 50)).toEqual({ page: 1, fraction: 0 })
  })
})

describe('T86 zoom and canvas size', () => {
  it('keeps the scale within its limits', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(Number.NaN)).toBe(1)
    expect(fitWidthScale(918, 612)).toBe(1.5)
    expect(fitWidthScale(0, 612)).toBe(1)
    expect(fitWidthScale(100, 0)).toBe(1)
    expect(zoomedScale(1, 'zoom-in')).toBe(1.15)
    expect(zoomedScale(1.15, 'zoom-out')).toBe(1)
    let scale = 1
    for (let step = 0; step < 40; step++) scale = zoomedScale(scale, 'zoom-in')
    expect(scale).toBe(MAX_SCALE)
    for (let step = 0; step < 60; step++) scale = zoomedScale(scale, 'zoom-out')
    expect(scale).toBe(MIN_SCALE)
  })

  it('draws at the screen ratio until the page would be too large', () => {
    expect(outputScale(800, 1000, 2)).toBe(2)
    expect(outputScale(800, 1000, 1)).toBe(1)
    expect(outputScale(800, 1000, 0)).toBe(1)
    const ratio = outputScale(2448, 3168, 2)
    expect(ratio).toBeLessThan(2)
    expect(2448 * 3168 * ratio * ratio).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1)
  })
})
