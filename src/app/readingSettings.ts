import { fontFamilies, type EditorFontId, type FontPreset } from './appearance'
import { presetFontFamily, type Measure, type PageMargin, type PageSize, type ParagraphSpacing, type TableStyle, type Typography } from '../features/reading/css'
import { readingStyle, resolveStyleId, type ReadingStyle, type StyleId, type ThemeId } from '../features/reading/styles'

/** The reading-related settings; `settings.rs` keeps the same whitelist and defaults. */
export type ReadingSettings = {
  theme: ThemeId
  dayTheme: StyleId
  nightTheme: StyleId
  editorFont: EditorFontId
  editorFontSize: number
  editorLineHeight: 'compact' | 'comfortable' | 'relaxed'
  fontPreset: FontPreset
  paragraphSpacing: ParagraphSpacing
  measure: Measure
  textAlign: 'left' | 'justify'
  firstLineIndent: boolean
  tableStyle: TableStyle
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
  theme: 'system', dayTheme: 'paper', nightTheme: 'graphite', editorFont: 'system', editorFontSize: 15, editorLineHeight: 'comfortable',
  fontPreset: 'auto', paragraphSpacing: 'standard', measure: '36', textAlign: 'left', firstLineIndent: false, tableStyle: 'three-line',
  imageCaptions: true, imageDimming: true, openInReadingMode: true, exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard',
}

export const lineHeights = { compact: 1.45, comfortable: 1.7, relaxed: 1.95 } as const

export function activeStyle(settings: Pick<ReadingSettings, 'theme' | 'dayTheme' | 'nightTheme'>, systemDark: boolean): ReadingStyle {
  return readingStyle(resolveStyleId(settings.theme, settings.dayTheme, settings.nightTheme, systemDark))
}

/** `system` keeps the font chosen before presets existed; other presets use bundled fonts. */
export function documentFontFamily(settings: Pick<ReadingSettings, 'fontPreset' | 'editorFont'>, style: ReadingStyle): string {
  return settings.fontPreset === 'system' ? fontFamilies[settings.editorFont] ?? fontFamilies.system : presetFontFamily(settings.fontPreset, style)
}

export function documentTypography(settings: ReadingSettings, style: ReadingStyle): Typography {
  return {
    fontFamily: documentFontFamily(settings, style),
    fontSize: settings.editorFontSize,
    lineHeight: lineHeights[settings.editorLineHeight] ?? lineHeights.comfortable,
    paragraphSpacing: settings.paragraphSpacing,
    measure: settings.measure,
    textAlign: settings.textAlign,
    firstLineIndent: settings.firstLineIndent,
    imageDimming: settings.imageDimming,
    tableStyle: settings.tableStyle === 'grid' ? 'grid' : 'three-line',
  }
}

/**
 * Files opened from disk start in reading mode. New documents (no file token), documents restored from a
 * draft and documents with unsaved changes open for editing, as does everything when the setting is off.
 */
export function opensInReadingMode(openInReadingMode: boolean, hasFile: boolean, dirty: boolean): boolean {
  return openInReadingMode && hasFile && !dirty
}
