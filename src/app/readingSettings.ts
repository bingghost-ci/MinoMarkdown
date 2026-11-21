import { codeFontStack, fontStack } from '../features/reading/fonts'
import { tableStyles, type Measure, type PageMargin, type PageSize, type ParagraphSpacing, type TableStyle, type Typography } from '../features/reading/css'
import { noCustomCodeColors, type CodeColors, type CustomCodeColors } from '../features/reading/codeColors'
import type { DocumentScript } from '../features/reading/script'
import { readingStyle, resolveStyleId, type ReadingStyle, type StyleId, type ThemeId } from '../features/reading/styles'
import { DEFAULT_EDITOR_FONT_SIZE } from './textZoom'
import { isLayout, layoutFontPrefix, type LayoutId } from '../features/reading/layouts'
import { noDiagramColors, type DiagramCustomColors } from '../features/diagrams/colorKey'
import type { DiagramColorScheme, DiagramCurve, DiagramFill, DiagramFont, DiagramLine, DiagramLook } from '../features/diagrams/looks'

/** The reading-related settings; `settings.rs` keeps the same whitelist and defaults. */
export type ReadingSettings = {
  theme: ThemeId
  dayTheme: StyleId
  nightTheme: StyleId
  /** `auto`, a bundled font ID, or `sys:<family>` for a font installed on this Mac; see `fonts.ts`. */
  cjkFont: string
  latinFont: string
  /** The monospace font of code blocks, source files and the source editor (T90). */
  codeFont: string
  /** The colors of code: `auto` is the reading style's own set (T110). */
  codeColors: CodeColors
  /** The colors the user chose for the `custom` scheme (T111). Replaced as a whole, never changed in place. */
  codeCustomColors: CustomCodeColors
  editorFontSize: number
  editorLineHeight: 'compact' | 'comfortable' | 'relaxed'
  paragraphSpacing: ParagraphSpacing
  measure: Measure
  textAlign: 'left' | 'justify'
  firstLineIndent: boolean
  tableStyle: TableStyle
  /** How headings, quotes and rules are set, apart from the paper (T122). */
  layout: LayoutId
  /** How emphasis is shown in a Chinese document, where slanted characters read poorly (T129). */
  cjkEmphasis: 'italic' | 'kai' | 'dot'
  /** How Mermaid diagrams are drawn; every look takes its colors from the reading style. */
  diagramStyle: DiagramLook
  /** The pattern of plain edges; `auto` uses the look's own. */
  diagramLine: DiagramLine
  /** How edges are routed; `auto` uses the look's own. */
  diagramCurve: DiagramCurve
  /** How the hand-drawn looks fill their shapes. */
  diagramFill: DiagramFill
  /** The color scheme of diagrams, and the colors the user set when it is `custom`. */
  diagramColors: DiagramColorScheme
  diagramCustomColors: DiagramCustomColors
  /** The font of diagram labels: the look's own, one of the offered ones, or `sys:<family>`. */
  diagramFont: DiagramFont
  /** 0–100 in steps of 10. */
  textureStrength: number
  /** `auto` lays out mostly-Western documents the Western way. */
  latinLayout: 'auto' | 'off'
  imageCaptions: boolean
  imageDimming: boolean
  openInReadingMode: boolean
  exportStyle: 'current' | 'plain'
  pdfMode: 'print' | 'screen'
  pageSize: PageSize
  pageMargin: PageMargin
}

/** New installs; `settings.rs` fills missing fields of older files so their look does not change. */
export const defaultReadingSettings: ReadingSettings = {
  theme: 'system', dayTheme: 'white', nightTheme: 'dark', cjkFont: 'auto', latinFont: 'auto', codeFont: 'auto', codeColors: 'auto', codeCustomColors: noCustomCodeColors, editorFontSize: DEFAULT_EDITOR_FONT_SIZE, editorLineHeight: 'comfortable',
  paragraphSpacing: 'standard', measure: '36', textAlign: 'left', firstLineIndent: false, tableStyle: 'three-line', layout: 'standard', cjkEmphasis: 'italic', diagramStyle: 'page', diagramLine: 'auto', diagramCurve: 'auto', diagramFill: 'auto', diagramColors: 'auto', diagramCustomColors: noDiagramColors, diagramFont: 'auto', textureStrength: 60, latinLayout: 'auto',
  imageCaptions: true, imageDimming: true, openInReadingMode: true, exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard',
}

export const lineHeights = { compact: 1.5, comfortable: 1.8, relaxed: 2.05 } as const
/** Western text has ascenders, descenders and word spaces, so the same comfort needs less leading. */
export const latinLineHeights = { compact: 1.4, comfortable: 1.58, relaxed: 1.78 } as const
/** A measure of N Chinese characters holds about 2.1 N letters; these keep 60–80 characters a line. */
export const latinMeasures: Record<Measure, Measure | '28' | '32'> = { '30': '28', '36': '32', '42': '36', unlimited: 'unlimited' }

export function activeStyle(settings: Pick<ReadingSettings, 'theme' | 'dayTheme' | 'nightTheme'>, systemDark: boolean): ReadingStyle {
  return readingStyle(resolveStyleId(settings.theme, settings.dayTheme, settings.nightTheme, systemDark))
}

export function documentFontFamily(settings: Pick<ReadingSettings, 'cjkFont' | 'latinFont'>, style: ReadingStyle): string {
  return fontStack(settings.cjkFont, settings.latinFont, style.font)
}

/** The script used for layout: the document's own, unless Western layout is switched off. */
export function layoutScript(settings: Pick<ReadingSettings, 'latinLayout'>, script: DocumentScript): DocumentScript {
  return settings.latinLayout === 'auto' ? script : 'cjk'
}

export function documentTypography(settings: ReadingSettings, style: ReadingStyle, script: DocumentScript = 'cjk'): Typography {
  const latin = layoutScript(settings, script) === 'latin'
  const lineHeight = (latin ? latinLineHeights : lineHeights)[settings.editorLineHeight] ?? (latin ? latinLineHeights : lineHeights).comfortable
  return {
    fontFamily: layoutFontPrefix(settings.layout) + documentFontFamily(settings, style),
    codeFontFamily: codeFontStack(settings.codeFont),
    codeColors: settings.codeColors,
    codeCustomColors: settings.codeCustomColors,
    fontSize: settings.editorFontSize,
    lineHeight,
    paragraphSpacing: settings.paragraphSpacing,
    measure: latin ? latinMeasures[settings.measure] : settings.measure,
    // Western text is justified only when the user asks for it: forced justification tore lines with long inline code apart.
    textAlign: settings.textAlign,
    firstLineIndent: latin ? false : settings.firstLineIndent,
    imageDimming: settings.imageDimming,
    tableStyle: tableStyles.includes(settings.tableStyle) ? settings.tableStyle : 'three-line',
    textureStrength: settings.textureStrength,
    layout: isLayout(settings.layout) ? settings.layout : 'standard',
    // Western text keeps its italics: the choice is for Chinese.
    emphasis: latin ? 'italic' : settings.cjkEmphasis === 'kai' || settings.cjkEmphasis === 'dot' ? settings.cjkEmphasis : 'italic',
    hyphens: latin && settings.textAlign === 'justify',
  }
}

/** Switching between day and night from the floating button: the other side's remembered style, set explicitly. */
export function toggledDayNight(settings: Pick<ReadingSettings, 'theme' | 'dayTheme' | 'nightTheme'>, systemDark: boolean): Pick<ReadingSettings, 'theme'> {
  const current = activeStyle(settings, systemDark)
  return { theme: readingStyle(current.dark ? settings.dayTheme : settings.nightTheme).id }
}

/**
 * Picking a style applies it now and remembers it as the day or night choice. Following the system stays
 * on when the picked style suits the current macOS appearance; otherwise the pick becomes explicit.
 */
export function pickedStyle(style: ReadingStyle, settings: Pick<ReadingSettings, 'theme'>, systemDark: boolean): Partial<ReadingSettings> {
  const remembered = style.dark ? { nightTheme: style.id } : { dayTheme: style.id }
  return settings.theme === 'system' && style.dark === systemDark ? remembered : { theme: style.id, ...remembered }
}

/**
 * Files opened from disk start in reading mode. New documents (no file token), documents restored from a
 * draft and documents with unsaved changes open for editing, as does everything when the setting is off.
 */
export function opensInReadingMode(openInReadingMode: boolean, hasFile: boolean, dirty: boolean): boolean {
  return openInReadingMode && hasFile && !dirty
}

/** Side pane widths (T78): the file sidebar, the outline and the AI drawer are resized by dragging their inner edge. `settings.rs` checks the same ranges. */
export const SIDEBAR_MIN = 170
export const PANE_MIN = 180
export const PANE_MAX = 520
export const AI_MIN = 300
export const AI_MAX = 640

/** The choices of line height and of page width, with their labels, as the settings page and the appearance panel both offer them. */
export const lineHeightOptions = [['compact', '紧凑'], ['comfortable', '舒适'], ['relaxed', '宽松']] as const
export const editorWidthOptions = [['centered', '页面'], ['wide', '宽屏']] as const
