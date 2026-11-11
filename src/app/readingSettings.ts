import { fontStack } from '../features/reading/fonts'
import type { Measure, PageMargin, PageSize, ParagraphSpacing, TableStyle, Typography } from '../features/reading/css'
import type { DocumentScript } from '../features/reading/script'
import { readingStyle, resolveStyleId, type ReadingStyle, type StyleId, type ThemeId } from '../features/reading/styles'

/** The reading-related settings; `settings.rs` keeps the same whitelist and defaults. */
export type ReadingSettings = {
  theme: ThemeId
  dayTheme: StyleId
  nightTheme: StyleId
  /** `auto`, a bundled font ID, or `sys:<family>` for a font installed on this Mac; see `fonts.ts`. */
  cjkFont: string
  latinFont: string
  editorFontSize: number
  editorLineHeight: 'compact' | 'comfortable' | 'relaxed'
  paragraphSpacing: ParagraphSpacing
  measure: Measure
  textAlign: 'left' | 'justify'
  firstLineIndent: boolean
  tableStyle: TableStyle
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
  theme: 'system', dayTheme: 'white', nightTheme: 'dark', cjkFont: 'auto', latinFont: 'auto', editorFontSize: 16, editorLineHeight: 'comfortable',
  paragraphSpacing: 'standard', measure: '36', textAlign: 'left', firstLineIndent: false, tableStyle: 'three-line', textureStrength: 60, latinLayout: 'auto',
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
    fontFamily: documentFontFamily(settings, style),
    fontSize: settings.editorFontSize,
    lineHeight,
    paragraphSpacing: settings.paragraphSpacing,
    measure: latin ? latinMeasures[settings.measure] : settings.measure,
    textAlign: latin ? 'justify' : settings.textAlign,
    firstLineIndent: latin ? false : settings.firstLineIndent,
    imageDimming: settings.imageDimming,
    tableStyle: settings.tableStyle === 'grid' ? 'grid' : 'three-line',
    textureStrength: settings.textureStrength,
    hyphens: latin,
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
