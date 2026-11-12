import { fontFaceRows, fontRanges } from './fontTable'

/**
 * The bundled fonts as data: which WOFF2 file draws which characters. The app itself registers them through
 * `bundledFonts.css`; this table is for exports, which embed only the subsets a document uses, and it is
 * loaded with the export code rather than at startup (T98). Both files come from scripts/generate-font-table.mjs.
 */
export type FontFace = { family: string; weight: string; style: 'normal' | 'italic'; file: string; url: string; ranges: [number, number][] | null; unicodeRange: string | null }

// Only WOFF2 is imported, so the WOFF copies in the npm packages never reach the bundle. These are the same
// files `bundledFonts.css` names, so the build emits each of them once.
const fontFiles = {
  ...import.meta.glob<string>('/node_modules/@fontsource/{noto-serif-sc,noto-sans-sc}/files/noto-{serif,sans}-sc-[0-9]*-{400,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource/{noto-serif-sc,noto-sans-sc}/files/noto-{serif,sans}-sc-{latin,latin-ext,cyrillic,vietnamese}-{400,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource/lxgw-wenkai/files/lxgw-wenkai-latin-{500,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource-variable/{source-serif-4,literata,eb-garamond,inter,jetbrains-mono,fira-code,source-code-pro}/files/*-{latin,latin-ext}-wght-{normal,italic}.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/src/assets/fonts/*/*.woff2', { query: '?url', import: 'default', eager: true }),
}
const urlByFile = new Map(Object.entries(fontFiles).map(([path, url]) => [path.split('/').pop()!, url]))

function parseRanges(value: string): [number, number][] {
  return value.split(',').map((part) => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-')
    const start = parseInt(from, 16)
    return [start, to ? parseInt(to, 16) : start] as [number, number]
  })
}

/** `ranges` is tens of thousands of number pairs in all, so each face works its own out when first asked. */
function bundledFace(family: string, weight: string, style: FontFace['style'], file: string, url: string, unicodeRange: string | null): FontFace {
  let ranges: [number, number][] | null | undefined
  return { family, weight, style, file, url, unicodeRange, get ranges() { return ranges === undefined ? ranges = unicodeRange ? parseRanges(unicodeRange) : null : ranges } }
}

export const bundledFaces: readonly FontFace[] = fontFaceRows.flatMap(([family, file, weight, italic, range]) => {
  const url = urlByFile.get(file)
  return url ? [bundledFace(family, weight, italic ? 'italic' : 'normal', file, url, range === null ? null : fontRanges[range])] : []
})

/** `font-display: block` shows the right font after a short blank instead of swapping in a fallback first. */
export function fontFaceCss(faces: readonly FontFace[], source: (face: FontFace) => string = (face) => face.url): string {
  return faces.map((face) => `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(${source(face)}) format('woff2');${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`).join('\n')
}

/**
 * The faces an export needs: for each used family, the subsets whose ranges cover a character of the
 * text. `italic` keeps italic faces only when the document has emphasis to draw with them.
 */
export function facesForText(text: string, families: ReadonlySet<string>, faces: readonly FontFace[] = bundledFaces, italic = true): FontFace[] {
  const codes = new Set<number>()
  for (const char of text) codes.add(char.codePointAt(0)!)
  const sorted = Array.from(codes).sort((a, b) => a - b)
  return faces.filter((face) => families.has(face.family) && (italic || face.style === 'normal') && (face.ranges === null || face.ranges.some(([from, to]) => {
    // Binary search for the first code point at or after `from`.
    let low = 0, high = sorted.length
    while (low < high) { const mid = (low + high) >> 1; if (sorted[mid] < from) low = mid + 1; else high = mid }
    return low < sorted.length && sorted[low] <= to
  })))
}
