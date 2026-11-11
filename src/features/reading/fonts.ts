import noto400 from '@fontsource/noto-serif-sc/400.css?raw'
import noto700 from '@fontsource/noto-serif-sc/700.css?raw'
import type { FontPresetId } from './styles'

/**
 * Bundled OFL fonts (T55). Only the WOFF2 files are imported, so the WOFF copies never reach the bundle.
 * Noto Serif SC ships as about a hundred unicode-range subsets per weight, and WebKit fetches only the
 * subsets a page uses. LXGW WenKai 5.3.0 ships one file per weight (300, 500, 700) and no subsets; its
 * 500 file serves regular text and 700 serves bold.
 *
 * The families get private names, so a copy installed on the Mac never replaces the bundled one.
 */
export const SERIF_FAMILY = 'Mino Noto Serif SC'
export const KAI_FAMILY = 'Mino LXGW WenKai'

const notoFiles = {
  ...import.meta.glob<string>('/node_modules/@fontsource/noto-serif-sc/files/noto-serif-sc-[0-9]*-{400,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource/noto-serif-sc/files/noto-serif-sc-{latin,latin-ext,cyrillic,vietnamese}-{400,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
}
const kaiFiles = import.meta.glob<string>('/node_modules/@fontsource/lxgw-wenkai/files/lxgw-wenkai-latin-{500,700}-normal.woff2', { query: '?url', import: 'default', eager: true })

export type FontFace = { family: string; weight: string; file: string; url: string; ranges: [number, number][] | null; unicodeRange: string | null }

const urlByFile = new Map(Object.entries({ ...notoFiles, ...kaiFiles }).map(([path, url]) => [path.split('/').pop()!, url]))

function parseRanges(value: string): [number, number][] {
  return value.split(',').map((part) => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-')
    const start = parseInt(from, 16)
    return [start, to ? parseInt(to, 16) : start] as [number, number]
  })
}

function fontsourceFaces(css: string, family: string): FontFace[] {
  return css.split('@font-face').slice(1).flatMap((block) => {
    const file = /files\/([^)]+\.woff2)/.exec(block)?.[1]
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1]
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? null
    const url = file ? urlByFile.get(file) : undefined
    if (!file || !weight || !url) return []
    return [{ family, weight, file, url, ranges: range ? parseRanges(range) : null, unicodeRange: range }]
  })
}

export const bundledFaces: readonly FontFace[] = [
  ...fontsourceFaces(noto400, SERIF_FAMILY),
  ...fontsourceFaces(noto700, SERIF_FAMILY),
  ...(['500', '700'] as const).flatMap((weight) => {
    const file = `lxgw-wenkai-latin-${weight}-normal.woff2`
    const url = urlByFile.get(file)
    // A weight range lets 400 text use the 500 file, and 600 headings use the 700 file.
    return url ? [{ family: KAI_FAMILY, weight: weight === '500' ? '100 599' : '600 900', file, url, ranges: null, unicodeRange: null }] : []
  }),
]

/** `font-display: block` shows the right font after a short blank instead of swapping in a fallback first. */
export function fontFaceCss(faces: readonly FontFace[], source: (face: FontFace) => string = (face) => face.url): string {
  return faces.map((face) => `@font-face{font-family:'${face.family}';font-style:normal;font-weight:${face.weight};font-display:block;src:url(${source(face)}) format('woff2');${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`).join('\n')
}

/** Western fonts come first so Latin text keeps its own face; bundled fonts precede system fallbacks. */
export const presetFamilies: Record<FontPresetId, string> = {
  song: `Georgia, '${SERIF_FAMILY}', 'Songti SC', 'STSong', serif`,
  kai: `'${KAI_FAMILY}', 'Kaiti SC', 'STKaiti', serif`,
  hei: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
}

/** System fallbacks used when an export cannot carry the bundled font. */
export const presetFallbacks: Record<FontPresetId, string> = {
  song: "Georgia, 'Songti SC', 'STSong', serif",
  kai: "'Kaiti SC', 'STKaiti', serif",
  hei: presetFamilies.hei,
}

export function familiesIn(stack: string): Set<string> {
  return new Set(stack.split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, '')))
}

/** The faces an export needs: the subsets whose ranges cover a character of the text, for each used family. */
export function facesForText(text: string, families: ReadonlySet<string>, faces: readonly FontFace[] = bundledFaces): FontFace[] {
  const codes = new Set<number>()
  for (const char of text) codes.add(char.codePointAt(0)!)
  const sorted = Array.from(codes).sort((a, b) => a - b)
  return faces.filter((face) => families.has(face.family) && (face.ranges === null || face.ranges.some(([from, to]) => {
    // Binary search for the first code point at or after `from`.
    let low = 0, high = sorted.length
    while (low < high) { const mid = (low + high) >> 1; if (sorted[mid] < from) low = mid + 1; else high = mid }
    return low < sorted.length && sorted[low] <= to
  })))
}
