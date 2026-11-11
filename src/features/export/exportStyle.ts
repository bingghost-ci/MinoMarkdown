import { exportReadingStyle, exportStylesheet, type Typography } from '../reading/css'
import { bundledFaces, CODE_FONT_STACK, facesForText, familiesIn, fontFaceCss, withoutBundledFonts, type FontFace } from '../reading/fonts'
import type { ReadingStyle } from '../reading/styles'

/** §3 budgets: exported HTML carries at most 6 MiB of fonts. Print pages are never saved, so they may carry more. */
export const HTML_FONT_BUDGET = 6 * 1024 * 1024
export const PRINT_FONT_BUDGET = 24 * 1024 * 1024

export type ExportStyleInput = {
  style: ReadingStyle
  typography: Typography
  exportStyle: 'current' | 'plain'
  pdfMode: 'print' | 'screen'
  pageSize: 'a4' | 'letter'
  pageMargin: 'narrow' | 'standard' | 'wide'
  /** The text whose characters decide which font subsets are embedded. */
  text: string
  mode: 'html' | 'print'
  /** Reads a bundled file by its built path (`/assets/…`); the app reads it through `read_app_asset`. */
  readAsset: (path: string) => Promise<Uint8Array>
  faces?: readonly FontFace[]
}

export type ExportStyle = { stylesheet: string; fontsEmbedded: boolean; fontFallback: boolean; fontBytes: number; diagramStyleId: string }

function base64(bytes: Uint8Array): string {
  let output = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) output += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(output)
}

export { withoutBundledFonts }

/**
 * Builds the stylesheet of an exported page. Only the font subsets that cover characters of the text are
 * embedded as data URIs; when they cannot be read or exceed the budget, the page falls back to system fonts.
 */
export async function buildExportStyle(input: ExportStyleInput): Promise<ExportStyle> {
  // Code blocks draw with the bundled monospace font, so its Latin subset travels with the page too.
  const families = new Set([...familiesIn(input.typography.fontFamily), ...familiesIn(CODE_FONT_STACK)])
  const faces = facesForText(input.text, families, input.faces ?? bundledFaces, /(^|[^\\*_])[*_][^\s*_]/.test(input.text))
  const budget = input.mode === 'html' ? HTML_FONT_BUDGET : PRINT_FONT_BUDGET
  let typography = input.typography
  let fontFaces = ''
  let fontBytes = 0
  let fallback = false
  if (faces.length > 0) {
    try {
      const sources = new Map<FontFace, string>()
      for (const face of faces) {
        if (face.url.startsWith('data:font/woff2')) { sources.set(face, face.url); fontBytes += Math.ceil(face.url.length * 0.75); continue }
        const bytes = await input.readAsset(face.url)
        fontBytes += bytes.byteLength
        if (fontBytes > budget) throw new Error('EXPORT_FONT_BUDGET')
        sources.set(face, `data:font/woff2;base64,${base64(bytes)}`)
      }
      fontFaces = fontFaceCss(faces, (face) => sources.get(face)!)
    } catch {
      fallback = true
      fontBytes = 0
      typography = { ...typography, fontFamily: withoutBundledFonts(typography.fontFamily) || 'serif' }
    }
  }
  const options = { styleId: input.style.id, exportStyle: input.exportStyle, pdfMode: input.pdfMode, pageSize: input.pageSize, pageMargin: input.pageMargin, typography, fontFaces }
  const drawn = exportReadingStyle(options)
  const printsWhite = input.mode === 'print' && input.pdfMode === 'print'
  return {
    stylesheet: exportStylesheet(options),
    fontsEmbedded: fontFaces !== '',
    fontFallback: fallback,
    fontBytes,
    diagramStyleId: printsWhite && drawn.dark ? 'white' : drawn.id,
  }
}
