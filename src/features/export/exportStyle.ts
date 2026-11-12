import { exportReadingStyle, exportStylesheet, type Typography } from '../reading/css'
import { CODE_FONT_STACK, familiesIn, withoutBundledFonts } from '../reading/fonts'
import { bundledFaces, facesForText, fontFaceCss, type FontFace } from '../reading/fontFaces'
import type { ReadingStyle } from '../reading/styles'
import { base64 } from './appAssets'
import { textureFiles } from '../reading/textures'

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
  /** Reads a bundled font or paper layer by its built path (`/assets/…`); the app reads it through `read_app_asset`. */
  readAsset: (path: string) => Promise<Uint8Array>
  faces?: readonly FontFace[]
}

export type ExportStyle = { stylesheet: string; fontsEmbedded: boolean; fontFallback: boolean; fontBytes: number; diagramStyleId: string }

/**
 * Builds the stylesheet of an exported page. Only the font subsets that cover characters of the text are
 * embedded as data URIs; when they cannot be read or exceed the budget, the page falls back to system fonts.
 */
export async function buildExportStyle(input: ExportStyleInput): Promise<ExportStyle> {
  // Code blocks draw with the bundled monospace font, so its Latin subset travels with the page too.
  const families = new Set([...familiesIn(input.typography.fontFamily), ...familiesIn(input.typography.codeFontFamily ?? CODE_FONT_STACK)])
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
  const drawn = exportReadingStyle({ styleId: input.style.id, exportStyle: input.exportStyle })
  // The paper travels inside the page, like the fonts. If a layer cannot be read the page keeps its color and loses its grain.
  const textures = new Map<string, string>()
  try {
    for (const file of textureFiles(drawn.texture)) textures.set(file, file.startsWith('data:') ? file : `data:image/png;base64,${base64(await input.readAsset(file))}`)
  } catch { textures.clear() }
  const options = { styleId: input.style.id, exportStyle: input.exportStyle, pdfMode: input.pdfMode, pageSize: input.pageSize, pageMargin: input.pageMargin, typography, fontFaces, textures }
  const printsWhite = input.mode === 'print' && input.pdfMode === 'print'
  return {
    stylesheet: exportStylesheet(options),
    fontsEmbedded: fontFaces !== '',
    fontFallback: fallback,
    fontBytes,
    diagramStyleId: printsWhite && drawn.dark ? 'white' : drawn.id,
  }
}
