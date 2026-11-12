import type { StyleFont } from './styles'

/**
 * Fonts (T55, T66–T68). Chinese and Western fonts are chosen separately: a font stack lists the Western
 * family first, so Latin letters use it and Chinese falls through to the Chinese family behind it.
 *
 * Bundled fonts are OFL-licensed WOFF2 files. Only WOFF2 is imported, so the WOFF copies in the npm
 * packages never reach the bundle. Each bundled family gets a private name (`Mino …`), so a copy
 * installed on the Mac never replaces the bundled one. Fonts installed on the Mac are chosen by family
 * name (`sys:<family>`, listed by the `list_system_fonts` command) and cost no app size.
 */
export type FontFace = { family: string; weight: string; style: 'normal' | 'italic'; file: string; url: string; ranges: [number, number][] | null; unicodeRange: string | null }
/** `code` is the monospace font of code blocks, source files and the source editor (T90). */
export type FontScript = 'cjk' | 'latin' | 'code'
export type FontKind = 'serif' | 'sans' | 'kai' | 'fangsong' | 'mono'
export type FontOption = {
  id: string
  label: string
  note: string
  script: FontScript
  kind: FontKind
  /** CSS family list that draws this font: a bundled private family, or system families. */
  family: string
  bundled: boolean
  /**
   * Ships as one large file (5–12 MiB) rather than small subsets. Loading it stalls the page for a moment,
   * so nothing may draw text in it just to show its name: the font picker waits for the pointer to rest on it.
   */
  heavy?: boolean
}

export const SERIF_FAMILY = 'Mino Noto Serif SC'
export const SANS_FAMILY = 'Mino Noto Sans SC'
export const KAI_FAMILY = 'Mino LXGW WenKai'
export const FANGSONG_FAMILY = 'Mino Zhuque Fangsong'
export const HUOSONG_FAMILY = 'Mino Chill HuoSong'
export const SOURCE_SERIF_FAMILY = 'Mino Source Serif 4'
export const LITERATA_FAMILY = 'Mino Literata'
export const GARAMOND_FAMILY = 'Mino EB Garamond'
export const INTER_FAMILY = 'Mino Inter'
export const MONO_FAMILY = 'Mino JetBrains Mono'
export const FIRA_CODE_FAMILY = 'Mino Fira Code'
export const SOURCE_CODE_FAMILY = 'Mino Source Code Pro'

const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif"
const CODE_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, 'PingFang SC', monospace"
/** Code in documents, the editor and exports, when no code font is chosen. */
export const CODE_FONT_STACK = `'${MONO_FAMILY}', ${CODE_FALLBACK}`

// Noto Serif SC and Noto Sans SC ship as about a hundred unicode-range subsets per weight, and WebKit
// fetches only the subsets a page uses. LXGW WenKai 5.3.0 ships one file per weight (300, 500, 700).
const fontFiles = {
  ...import.meta.glob<string>('/node_modules/@fontsource/{noto-serif-sc,noto-sans-sc}/files/noto-{serif,sans}-sc-[0-9]*-{400,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource/{noto-serif-sc,noto-sans-sc}/files/noto-{serif,sans}-sc-{latin,latin-ext,cyrillic,vietnamese}-{400,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource/lxgw-wenkai/files/lxgw-wenkai-latin-{500,700}-normal.woff2', { query: '?url', import: 'default', eager: true }),
  // Western fonts are variable (one file holds every weight) and limited to the Latin subsets.
  ...import.meta.glob<string>('/node_modules/@fontsource-variable/{source-serif-4,literata,eb-garamond,inter,jetbrains-mono,fira-code,source-code-pro}/files/*-{latin,latin-ext}-wght-{normal,italic}.woff2', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/src/assets/fonts/*/*.woff2', { query: '?url', import: 'default', eager: true }),
}
const fontCss = {
  ...import.meta.glob<string>('/node_modules/@fontsource/{noto-serif-sc,noto-sans-sc}/{400,700}.css', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('/node_modules/@fontsource-variable/{source-serif-4,literata,eb-garamond,inter,jetbrains-mono,fira-code,source-code-pro}/{wght,wght-italic}.css', { query: '?raw', import: 'default', eager: true }),
}

const urlByFile = new Map(Object.entries(fontFiles).map(([path, url]) => [path.split('/').pop()!, url]))

function parseRanges(value: string): [number, number][] {
  return value.split(',').map((part) => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-')
    const start = parseInt(from, 16)
    return [start, to ? parseInt(to, 16) : start] as [number, number]
  })
}

/** The faces of a Fontsource stylesheet whose WOFF2 file was imported above; other subsets are left out. */
function fontsourceFaces(css: string, family: string): FontFace[] {
  return css.split('@font-face').slice(1).flatMap((block) => {
    const file = /files\/([^)]+\.woff2)/.exec(block)?.[1]
    const weight = /font-weight:\s*(\d+(?:\s+\d+)?)/.exec(block)?.[1]
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? null
    const url = file ? urlByFile.get(file) : undefined
    if (!file || !weight || !url) return []
    return [{ family, weight, style: /font-style:\s*italic/.test(block) ? 'italic' : 'normal', file, url, ranges: range ? parseRanges(range) : null, unicodeRange: range }]
  })
}

function packageFaces(packageName: string, family: string): FontFace[] {
  return Object.entries(fontCss).filter(([path]) => path.includes(`/${packageName}/`)).sort(([a], [b]) => a.localeCompare(b)).flatMap(([, css]) => fontsourceFaces(css, family))
}

/** A font shipped as one file per weight, such as LXGW WenKai: no subsets, so any text needs the whole file. */
function wholeFileFaces(family: string, files: readonly (readonly [file: string, weight: string])[]): FontFace[] {
  return files.flatMap(([file, weight]) => {
    const url = urlByFile.get(file)
    return url ? [{ family, weight, style: 'normal' as const, file, url, ranges: null, unicodeRange: null }] : []
  })
}

export const bundledFaces: readonly FontFace[] = [
  ...packageFaces('noto-serif-sc', SERIF_FAMILY),
  ...packageFaces('noto-sans-sc', SANS_FAMILY),
  // A weight range lets 400 text use the 500 file, and 600 headings use the 700 file.
  ...wholeFileFaces(KAI_FAMILY, [['lxgw-wenkai-latin-500-normal.woff2', '100 599'], ['lxgw-wenkai-latin-700-normal.woff2', '600 900']]),
  // Zhuque Fangsong and ChillHuoSong ship one regular weight; bold is synthesized (`font-synthesis: weight`).
  ...wholeFileFaces(FANGSONG_FAMILY, [['zhuque-fangsong-400.woff2', '100 900']]),
  ...wholeFileFaces(HUOSONG_FAMILY, [['chill-huosong-400.woff2', '100 900']]),
  ...packageFaces('source-serif-4', SOURCE_SERIF_FAMILY),
  ...packageFaces('literata', LITERATA_FAMILY),
  ...packageFaces('eb-garamond', GARAMOND_FAMILY),
  ...packageFaces('inter', INTER_FAMILY),
  ...packageFaces('jetbrains-mono', MONO_FAMILY),
  ...packageFaces('fira-code', FIRA_CODE_FAMILY),
  ...packageFaces('source-code-pro', SOURCE_CODE_FAMILY),
]

export const bundledFamilies: ReadonlySet<string> = new Set(bundledFaces.map((face) => face.family))

/** `font-display: block` shows the right font after a short blank instead of swapping in a fallback first. */
export function fontFaceCss(faces: readonly FontFace[], source: (face: FontFace) => string = (face) => face.url): string {
  return faces.map((face) => `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(${source(face)}) format('woff2');${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`).join('\n')
}

/** Chinese fonts offered by name. `hei` is the system's PingFang; the rest ship with the app. */
export const cjkFonts: readonly FontOption[] = [
  { id: 'song', label: '思源宋体', note: '书宋，适合长文与书稿', script: 'cjk', kind: 'serif', family: `'${SERIF_FAMILY}', 'Songti SC', 'STSong'`, bundled: true },
  { id: 'kai', label: '霞鹜文楷', note: '楷体，适合笔记与随笔', script: 'cjk', kind: 'kai', family: `'${KAI_FAMILY}', 'Kaiti SC', 'STKaiti'`, bundled: true, heavy: true },
  { id: 'sans', label: '思源黑体', note: '黑体，各字重均匀清晰', script: 'cjk', kind: 'sans', family: `'${SANS_FAMILY}', 'PingFang SC'`, bundled: true },
  { id: 'fangsong', label: '朱雀仿宋', note: '仿宋，清秀，适合公文与随笔', script: 'cjk', kind: 'fangsong', family: `'${FANGSONG_FAMILY}', 'STFangsong'`, bundled: true, heavy: true },
  { id: 'huosong', label: '寒蝉活宋', note: '活字印刷质感的宋体', script: 'cjk', kind: 'serif', family: `'${HUOSONG_FAMILY}', 'Songti SC'`, bundled: true, heavy: true },
  { id: 'hei', label: '苹方', note: '系统黑体，适合技术文档', script: 'cjk', kind: 'sans', family: "'PingFang SC', 'Hiragino Sans GB'", bundled: false },
]

/** Western fonts offered by name; all ship with the app. */
export const latinFonts: readonly FontOption[] = [
  { id: 'source-serif', label: 'Source Serif', note: '稳重的正文衬线体', script: 'latin', kind: 'serif', family: `'${SOURCE_SERIF_FAMILY}'`, bundled: true },
  { id: 'literata', label: 'Literata', note: '为电子书长读设计', script: 'latin', kind: 'serif', family: `'${LITERATA_FAMILY}'`, bundled: true },
  { id: 'garamond', label: 'EB Garamond', note: '古典书籍风格', script: 'latin', kind: 'serif', family: `'${GARAMOND_FAMILY}'`, bundled: true },
  { id: 'inter', label: 'Inter', note: '清晰的无衬线体', script: 'latin', kind: 'sans', family: `'${INTER_FAMILY}'`, bundled: true },
  { id: 'mono', label: 'JetBrains Mono', note: '等宽，适合技术笔记', script: 'latin', kind: 'mono', family: `'${MONO_FAMILY}'`, bundled: true },
]

/**
 * Monospace fonts for code (T90). The first three ship with the app; the rest come with macOS. Any other
 * installed font can be chosen from the list of fonts on this Mac.
 */
export const codeFonts: readonly FontOption[] = [
  { id: 'jetbrains-mono', label: 'JetBrains Mono', note: '字形偏高，长时间看代码不累', script: 'code', kind: 'mono', family: `'${MONO_FAMILY}'`, bundled: true },
  { id: 'fira-code', label: 'Fira Code', note: '带连字：=> != >= 会连成一个符号', script: 'code', kind: 'mono', family: `'${FIRA_CODE_FAMILY}'`, bundled: true },
  { id: 'source-code-pro', label: 'Source Code Pro', note: '字形端正，间距宽松', script: 'code', kind: 'mono', family: `'${SOURCE_CODE_FAMILY}'`, bundled: true },
  { id: 'sf-mono', label: 'SF Mono', note: '系统等宽字体，与 Xcode、终端一致', script: 'code', kind: 'mono', family: "ui-monospace, 'SF Mono', SFMono-Regular", bundled: false },
  { id: 'menlo', label: 'Menlo', note: '系统自带，经典的 macOS 代码字体', script: 'code', kind: 'mono', family: "Menlo", bundled: false },
  { id: 'monaco', label: 'Monaco', note: '系统自带，小字号下很清楚', script: 'code', kind: 'mono', family: "Monaco", bundled: false },
]

const optionById = new Map([...cjkFonts, ...latinFonts, ...codeFonts].map((option) => [`${option.script}:${option.id}`, option]))

/** The Chinese font a style recommends when the choice is `auto`. */
const styleCjk: Record<StyleFont, string> = { song: 'song', kai: 'kai', hei: 'hei' }
/** The Western font that goes with a Chinese font when the choice is `auto`; null keeps the Chinese font's own Latin. */
const pairedLatin: Record<FontKind, string | null> = { serif: 'source-serif', fangsong: 'source-serif', kai: null, sans: null, mono: null }

const SYSTEM_PREFIX = 'sys:'

/**
 * Whether a family name may be written into CSS. `settings.rs` applies the same rule, so a name that
 * could end a quoted CSS string never reaches the stylesheet.
 */
export function isSystemFontName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.length > 0 && Array.from(name).length <= 100 && name.trim() === name && !/[\u0000-\u001f\u007f-\u009f"'\\,;{}<>]/.test(name)
}

export function systemFontId(name: string): string {
  return `${SYSTEM_PREFIX}${name}`
}

/** The family name of a `sys:` choice, or null for other choices and for names that are not safe in CSS. */
export function systemFontName(choice: string): string | null {
  if (!choice.startsWith(SYSTEM_PREFIX)) return null
  const name = choice.slice(SYSTEM_PREFIX.length)
  return isSystemFontName(name) ? name : null
}

function fontOption(choice: string, script: FontScript): FontOption | null {
  return optionById.get(`${script}:${choice}`) ?? null
}

/** A known choice: `auto`, a listed font of that script, or a safe `sys:` name. */
export function isFontChoice(choice: string, script: FontScript): boolean {
  return choice === 'auto' || fontOption(choice, script) !== null || systemFontName(choice) !== null
}

/** The CSS families that draw a choice, without generic fallbacks; null for `auto` and unknown choices. */
export function choiceFamily(choice: string, script: FontScript): string | null {
  const system = systemFontName(choice)
  if (system) return `'${system}'`
  return fontOption(choice, script)?.family ?? null
}

/**
 * The font stack of a document: the Western font (when one applies), the Chinese font, then system
 * fallbacks. Unknown choices, such as a font from a newer version, fall back to `auto`.
 */
export function fontStack(cjkChoice: string, latinChoice: string, styleFont: StyleFont): string {
  const cjkOption = fontOption(cjkChoice, 'cjk') ?? (systemFontName(cjkChoice) ? null : fontOption(styleCjk[styleFont], 'cjk'))
  const cjk = choiceFamily(cjkChoice, 'cjk') ?? cjkOption!.family
  const kind: FontKind = cjkOption?.kind ?? 'sans'
  const paired = pairedLatin[kind]
  const latin = choiceFamily(latinChoice, 'latin') ?? (paired ? fontOption(paired, 'latin')!.family : null)
  // PingFang's own Latin is the system UI font; naming that first keeps SF for Western text.
  const lead = latin ?? (cjkOption?.id === 'hei' ? "-apple-system, BlinkMacSystemFont, 'SF Pro Text'" : null)
  const generic = kind === 'sans' || kind === 'mono' ? SYSTEM_SANS : "'Songti SC', 'STSong', serif"
  return [lead, cjk, generic].filter(Boolean).join(', ')
}

/** The font stack of code. `auto` and unknown choices use JetBrains Mono; system fallbacks follow every choice. */
export function codeFontStack(choice: string): string {
  return `${choiceFamily(choice, 'code') ?? `'${MONO_FAMILY}'`}, ${CODE_FALLBACK}`
}

export function familiesIn(stack: string): Set<string> {
  return new Set(stack.split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, '')))
}

/** Removes the bundled families from a font stack, leaving its system fallbacks. */
export function withoutBundledFonts(stack: string): string {
  return stack.split(',').map((name) => name.trim()).filter((name) => !bundledFamilies.has(name.replace(/^['"]|['"]$/g, ''))).join(', ')
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
