import { mix, parseHex } from './color'
import { CODE_FONT_STACK } from './fonts'
import { readingStyle, readingStyles, type CodeTheme, type ReadingStyle } from './styles'
import { textureBackground } from './textures'
import { syntaxRoles, tokenClass } from '../../core/markdown/syntaxRoles'

/**
 * CSS for every place a document is shown. The app injects `appStylesheet()` once and switches styles by
 * changing `data-theme` on <html>, so a style change never rebuilds the editor. Preview and export use the
 * `.mino-doc` container; the editor maps the same element rules onto Crepe's `.ProseMirror`.
 */
export const EDITOR_ROOT = '.editor-root .milkdown .ProseMirror'
export const DOC_ROOT = '.mino-doc'

export type ParagraphSpacing = 'compact' | 'standard' | 'relaxed'
export type Measure = '30' | '36' | '42' | 'unlimited'
export type Typography = {
  fontFamily: string
  fontSize: number
  lineHeight: number
  paragraphSpacing: ParagraphSpacing
  /** Em count of the text column; Western layout uses the narrower 28 and 32. */
  measure: Measure | '28' | '32'
  textAlign: 'left' | 'justify'
  firstLineIndent: boolean
  imageDimming: boolean
  tableStyle: TableStyle
  /** 0–100: how much of the paper texture and edge aging shows. */
  textureStrength: number
  /** Western layout (T68): hyphenated words, set with `lang="en"` on the document. */
  hyphens: boolean
}

export type TableStyle = 'three-line' | 'grid'

export const paragraphGaps: Record<ParagraphSpacing, string> = { compact: '0.5em', standard: '0.9em', relaxed: '1.3em' }
/** Horizontal padding of the page in page view; the measure is the text column inside it. */
export const PAGE_PADDING_X = 88
/** The page is a rounded card on the desk (T61). */
export const PAGE_RADIUS = 14
/** "Unlimited" keeps the 1040 px page from T42. */
export const UNLIMITED_PAGE_WIDTH = 1040

const syntaxPalettes: Record<CodeTheme, Record<string, string>> = {
  light: { keyword: '#7a2d8c', atom: '#1d4f91', number: '#116644', definition: '#0b4fae', variable: '#1f5f6b', type: '#0a6b52', string: '#a2302a', comment: '#7a6a55', meta: '#8a5a00', invalid: '#c0392b', heading: '#1d4f91' },
  warm: { keyword: '#7d3c18', atom: '#6b4a8a', number: '#5d6b14', definition: '#8a4b16', variable: '#4f6236', type: '#2f6b5a', string: '#9b3b1f', comment: '#8a7a62', meta: '#8a5a00', invalid: '#b03a2e', heading: '#7d3c18' },
  night: { keyword: '#d7a8e8', atom: '#9cc4f0', number: '#b5d08e', definition: '#8fc2ff', variable: '#9fd4cf', type: '#8fd6b6', string: '#e8b08a', comment: '#8f8a80', meta: '#e3c27a', invalid: '#ff8f80', heading: '#9cc4f0' },
}

function declarations(values: Record<string, string>): string {
  return Object.entries(values).map(([name, value]) => `${name}:${value};`).join('')
}

export function styleVariables(style: ReadingStyle): Record<string, string> {
  const texture = textureBackground(style.texture)
  const syntax = syntaxPalettes[style.codeTheme]
  return {
    'color-scheme': style.dark ? 'dark' : 'light',
    '--surface': style.paper,
    '--text': style.text,
    '--heading': style.heading,
    '--title': style.title,
    '--secondary': style.secondary,
    '--muted': style.muted,
    '--link': style.link,
    '--code-ink': style.codeInk,
    '--code-bg': style.codeBg,
    '--quote-line': style.quoteLine,
    '--rule': style.rule,
    '--table-line': style.tableLine,
    '--table-rule': style.tableRule,
    '--selection': style.selection,
    '--desk': style.desk,
    '--page-edge': style.edge,
    '--page-shadow': style.shadow,
    '--paper-texture': texture ? texture.image : 'none',
    '--paper-texture-size': texture ? texture.size : 'auto',
    '--image-padding': style.imageMat === 'mat' ? '6px' : '0',
    '--image-bg': style.imageMat === 'mat' ? mix(style.paper, '#ffffff', 0.6) : 'transparent',
    '--image-border': style.imageMat === 'mat' ? '0' : `1px solid ${style.tableLine}`,
    '--image-shadow': style.imageMat === 'mat' ? `0 1px 3px ${mix(style.text, style.paper, 0.4)}30` : 'none',
    // Chrome text is neutral too: the page's ink belongs to the page.
    '--ui-text': style.dark ? '#d0d3d8' : '#2a2d33',
    '--ui-secondary': style.dark ? '#9a9fa8' : '#575d67',
    '--ui-muted': style.dark ? '#74797f' : '#8d939c',
    '--sidebar': style.ui.sidebar,
    '--chrome': style.ui.chrome,
    '--raised': style.ui.raised,
    '--line': style.ui.line,
    '--hover': style.ui.hover,
    '--selected': style.ui.selected,
    '--accent': style.ui.accent,
    '--accent-ink': style.ui.accentInk,
    '--danger': style.ui.danger,
    ...Object.fromEntries(Object.entries(syntax).map(([name, color]) => [`--syntax-${name}`, color])),
  }
}

/** Per-style decoration that is not a plain color: quote marks, centered titles and rule ornaments. */
function decorationRules(style: ReadingStyle, scope: (root: string) => string, roots: readonly string[]): string {
  const rules: string[] = []
  for (const root of roots) {
    const r = scope(root)
    if (style.quoteMark) rules.push(`${r} blockquote{position:relative;border-left:0;padding-left:2.1em}${r} blockquote::before{content:"\\201C";position:absolute;left:0;top:-.08em;font:2.8em/1 Georgia,'Songti SC',serif;color:var(--quote-line)}`)
    if (style.ornament) rules.push(`${r} h1{text-align:center}${r} hr{border:0;background:none;height:1.6em;margin:1.6em 0;text-align:center;overflow:visible}${r} hr::before{content:"\\2766";display:block;color:var(--secondary);font:1.05em/1.6em Georgia,'Apple Symbols',serif;letter-spacing:0}`)
  }
  return rules.join('')
}

/** Element rules shared by the editor and `.mino-doc`. */
export function documentElementCss(root: string): string {
  const r = root
  return [
    `${r}{color:var(--text);font-family:var(--doc-font);font-size:var(--doc-size);line-height:var(--doc-line-height);text-align:var(--doc-align);text-justify:var(--doc-justify,inter-character);-webkit-hyphens:var(--doc-hyphens,manual);hyphens:var(--doc-hyphens,manual);overflow-wrap:break-word;font-synthesis:weight style}`,
    `${r} p{margin:0 0 var(--doc-gap)}`,
    `${r} > p{text-indent:var(--doc-indent)}`,
    `${r} h1,${r} h2,${r} h3,${r} h4,${r} h5,${r} h6{color:var(--heading);font-family:var(--doc-font);font-weight:700;line-height:1.35;text-align:left;text-indent:0;break-after:avoid}`,
    `${r} h1,${r} h2{color:var(--title);font-weight:600}`,
    `${r} h1{font-size:1.9em;margin:.2em 0 .9em}${r} h2{font-size:1.5em;margin:1.7em 0 .6em}${r} h3{font-size:1.25em;margin:1.4em 0 .5em}${r} h4{font-size:1.1em;margin:1.2em 0 .4em}${r} h5{font-size:1em;margin:1.1em 0 .4em}${r} h6{font-size:.9em;margin:1em 0 .4em;color:var(--secondary)}`,
    `${r} a{color:var(--link);text-decoration:underline 1px;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,var(--link) 55%,transparent)}`,
    `${r} strong{font-weight:700}`,
    `${r} blockquote{margin:1.1em 0;padding:0 0 0 1em;border-left:3px solid var(--quote-line);color:var(--secondary)}`,
    `${r} blockquote p{text-indent:0}`,
    `${r} ul,${r} ol{padding-left:1.6em;margin:0 0 var(--doc-gap)}${r} li{text-indent:0}${r} li::marker{color:var(--secondary)}`,
    `${r} li p{margin:.15em 0}${r} th p,${r} td p{margin:0}${r} blockquote p:last-child{margin-bottom:0}`,
    `${r} input[type="checkbox"]{accent-color:var(--link)}`,
    `${r} ul.contains-task-list{list-style:none;padding-left:.2em}${r} .task-list-item > input[type="checkbox"]{margin:0 .55em 0 0;vertical-align:-.1em}`,
    `${r} :not(pre) > code{border-radius:3px;padding:.1em .35em;background:var(--code-bg);color:var(--code-ink);font:.88em var(--code-font);text-indent:0;-webkit-hyphens:manual;hyphens:manual}`,
    `${r} pre{margin:1.1em 0;padding:14px 16px;border-radius:8px;background:var(--code-bg);color:var(--text);font:.88em/1.6 var(--code-font);text-align:left;text-indent:0;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-hyphens:manual;hyphens:manual}`,
    `${r} pre code{background:none;padding:0;color:inherit;font:inherit}`,
    syntaxRoles.map((role) => `${r} pre .${tokenClass(role)}{color:var(--syntax-${role})}`).join(''),
    `${r} hr{border:0;border-top:1px solid var(--rule);background:none;padding:0;height:0;margin:1.8em 0}`,
    `${r} table{width:100%;border-collapse:collapse;margin:1.2em 0;font-size:.92em;line-height:1.55;text-align:left;text-indent:0;border:var(--table-frame);border-top:var(--table-edge);border-bottom:var(--table-edge)}`,
    `${r} th,${r} td{border:var(--table-cell);padding:6px 12px;vertical-align:top}`,
    `${r} .mino-num{text-align:right!important;font-variant-numeric:tabular-nums}`,
    `${r} thead th,${r} tr:first-child > th{border-bottom:1px solid var(--table-rule);font-weight:700;color:var(--heading)}`,
    `${r} ::selection{background:var(--selection)}`,
    `@supports (text-autospace: normal){${r}{text-autospace:normal}}@supports (text-spacing-trim: normal){${r}{text-spacing-trim:normal}}`,
  ].join('\n')
}

/** Images and render-only captions in `.mino-doc` (preview and export). */
export function documentImageCss(root = DOC_ROOT): string {
  const r = root
  return [
    `${r} img{display:block;max-width:100%;height:auto;margin:1.2em auto;border-radius:3px;padding:var(--image-padding);background:var(--image-bg);border:var(--image-border);box-shadow:var(--image-shadow);filter:var(--image-filter,none);box-sizing:border-box;break-inside:avoid}`,
    `${r} figure.mino-figure{margin:1.4em 0;text-align:center;text-indent:0;break-inside:avoid}${r} figure.mino-figure img{margin:0 auto}`,
    `${r} figure.mino-figure figcaption{margin-top:.6em;color:var(--secondary);font-size:.86em;line-height:1.5}`,
  ].join('\n')
}

export function typographyVariables(typography: Typography, style: ReadingStyle): Record<string, string> {
  const measure = typography.measure === 'unlimited' ? `${UNLIMITED_PAGE_WIDTH - 2 * PAGE_PADDING_X}px` : `${typography.measure}em`
  const strength = Math.max(0, Math.min(100, typography.textureStrength)) / 100
  const [r, g, b] = parseHex(style.paper)
  // The texture is veiled with the page color: full strength shows the tile as drawn, zero hides it.
  const veil = style.texture && strength < 1 ? `linear-gradient(rgba(${r},${g},${b},${(1 - strength).toFixed(2)}),rgba(${r},${g},${b},${(1 - strength).toFixed(2)}))` : 'none'
  const [ar, ag, ab] = parseHex(mix(style.text, style.paper, 0.45))
  const aging = style.aging && strength > 0
    ? `inset 0 0 120px -30px rgba(${ar},${ag},${ab},${(0.5 * strength).toFixed(2)}),inset 0 0 26px -6px rgba(${ar},${ag},${ab},${(0.42 * strength).toFixed(2)})`
    : '0 0 0 transparent'
  return {
    '--doc-font': typography.fontFamily,
    '--code-font': CODE_FONT_STACK,
    '--doc-hyphens': typography.hyphens ? 'auto' : 'manual',
    '--doc-justify': typography.hyphens ? 'auto' : 'inter-character',
    '--paper-veil': veil,
    '--page-aging': aging,
    '--doc-size': `${typography.fontSize}px`,
    '--doc-line-height': String(typography.lineHeight),
    '--doc-gap': paragraphGaps[typography.paragraphSpacing],
    '--doc-measure': measure,
    '--doc-align': typography.textAlign,
    '--doc-indent': typography.firstLineIndent ? '2em' : '0',
    '--image-filter': typography.imageDimming && style.dark ? 'brightness(.9)' : 'none',
    // Three-line tables: heavy top and bottom rules only. Grid: a thin line around every cell.
    '--table-edge': typography.tableStyle === 'grid' ? '1px solid var(--table-line)' : '1.5px solid var(--table-rule)',
    '--table-frame': typography.tableStyle === 'grid' ? '1px solid var(--table-line)' : '0',
    '--table-cell': typography.tableStyle === 'grid' ? '1px solid var(--table-line)' : '0',
  }
}

/** All styles as `:root[data-theme]` blocks, plus the shared element rules for editor and preview. */
export function appStylesheet(): string {
  const blocks = readingStyles.map((style) => `:root[data-theme="${style.id}"]${style.id === 'white' ? ',:root:not([data-theme])' : ''}{${declarations(styleVariables(style))}}`)
  const decorations = readingStyles.map((style) => decorationRules(style, (root) => `:root[data-theme="${style.id}"] ${root}`, [EDITOR_ROOT, DOC_ROOT]))
  return [...blocks, documentElementCss(EDITOR_ROOT), documentElementCss(DOC_ROOT), documentImageCss(DOC_ROOT), ...decorations].join('\n')
}

export type PageSize = 'a4' | 'letter'
export type PageMargin = 'narrow' | 'standard' | 'wide'
export const pageMargins: Record<PageMargin, string> = { narrow: '12mm', standard: '18mm', wide: '25mm' }

export type ExportStyleOptions = {
  styleId: string
  /** `plain` is the white page with the same typography. */
  exportStyle: 'current' | 'plain'
  /** `screen` keeps the page color inside the printed area; `print` prints on white. */
  pdfMode: 'screen' | 'print'
  pageSize: PageSize
  pageMargin: PageMargin
  typography: Typography
  fontFaces: string
}

/** The style an export draws with: print-friendly and plain pages use white paper and dark ink. */
export function exportReadingStyle(options: Pick<ExportStyleOptions, 'styleId' | 'exportStyle'>): ReadingStyle {
  return options.exportStyle === 'plain' ? readingStyle('white') : readingStyle(options.styleId)
}

/** Background of a page: the veil, then the texture layers, over the page color. */
export const PAGE_BACKGROUND = 'background-color:var(--surface);background-image:var(--paper-veil,none),var(--paper-texture);background-size:auto,var(--paper-texture-size,auto)'

function printStyle(style: ReadingStyle): ReadingStyle {
  const ink = style.dark ? readingStyle('white') : style
  return { ...ink, paper: '#ffffff', texture: null, aging: false, desk: '#ffffff', imageMat: style.imageMat }
}

/** The complete stylesheet of an exported page; `print` media rules follow the PDF mode. */
export function exportStylesheet(options: ExportStyleOptions): string {
  const style = exportReadingStyle(options)
  const print = printStyle(style)
  const vars = { ...styleVariables(style), ...typographyVariables(options.typography, style) }
  const printVars = { ...styleVariables(print), ...typographyVariables({ ...options.typography, imageDimming: false }, print) }
  const pageWidth = `calc(var(--doc-measure) + ${2 * PAGE_PADDING_X}px)`
  return [
    options.fontFaces,
    `:root{${declarations(vars)}}`,
    `html{background:var(--desk)}body{margin:0;padding:40px 0 64px;color:var(--text)}`,
    `.mino-page{box-sizing:border-box;max-width:min(${pageWidth},calc(100% - 32px));margin:0 auto;padding:64px ${PAGE_PADDING_X}px 88px;${PAGE_BACKGROUND};border:1px solid var(--page-edge);border-radius:${PAGE_RADIUS}px;box-shadow:var(--page-aging),var(--page-shadow)}`,
    `@media (max-width:760px){body{padding:0}.mino-page{max-width:none;margin:0;padding:28px 20px 48px;border:0;border-radius:0;box-shadow:none}}`,
    documentElementCss(DOC_ROOT),
    documentImageCss(DOC_ROOT),
    decorationRules(style, (root) => root, [DOC_ROOT]),
    `${DOC_ROOT} img{max-height:240mm;object-fit:contain}`,
    `.mermaid-diagram{margin:1.2em 0;text-align:center;break-inside:avoid}.mermaid-diagram svg{max-width:100%;height:auto}`,
    `@page{size:${options.pageSize === 'letter' ? 'letter' : 'A4'};margin:${pageMargins[options.pageMargin]}}`,
    options.pdfMode === 'print'
      ? `@media print{:root{${declarations(printVars)}}html,body{background:#fff}}`
      : // WebKit leaves @page margins unpainted (T52), so the page color covers the printed area only.
        `@media print{html{${PAGE_BACKGROUND};-webkit-print-color-adjust:exact;print-color-adjust:exact}}`,
    `@media print{body{padding:0}.mino-page{max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:none}thead{display:table-header-group}img,blockquote,tr,figure{break-inside:avoid}pre{break-inside:auto}}`,
  ].filter(Boolean).join('\n')
}
