import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExportStyle } from '../src/features/export/exportStyle'
import { renderExport } from '../src/features/export/renderHtml'
import { readingStyle, type StyleId } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'
import { readingSample } from '../src/app/previewSample'

/**
 * Writes export samples for people to review (T55/T56; `-pdf-<paper>` pages are what Export PDF prints, T106):
 *   MINO_EXPORT_SAMPLES=<dir> MINO_SAMPLE_IMAGE=<png> npx vitest run tests/export-samples.test.ts
 * Fonts are read from node_modules the way the app reads its built copies. Skipped in normal test runs.
 */
const out = process.env.MINO_EXPORT_SAMPLES

function readAsset(path: string): Promise<Uint8Array> {
  const clean = decodeURIComponent(path.replace(/^\/@fs/, '').split('?')[0])
  const file = clean.startsWith('/node_modules/') ? resolve(clean.slice(1)) : clean
  return Promise.resolve(new Uint8Array(readFileSync(file)))
}

/** Export embeds only raster images, so the sample's SVG picture is replaced by a PNG given in `MINO_SAMPLE_IMAGE`. */
async function resolveImage() {
  const file = process.env.MINO_SAMPLE_IMAGE
  return file ? { mime: 'image/png', bytes: new Uint8Array(readFileSync(file)) } : null
}

describe.skipIf(!out)('export samples', () => {
  it('writes HTML and print pages for the sample styles', async () => {
    mkdirSync(out!, { recursive: true })
    for (const id of ['paper', 'xuan', 'graphite', 'dusk'] as StyleId[]) {
      const style = readingStyle(id)
      const typography = documentTypography(defaultReadingSettings, style)
      for (const [mode, pdfMode] of [['html', 'print'], ['print', 'print'], ['print', 'screen'], ['pdf', 'print']] as const) {
        const look = await buildExportStyle({ style, typography, exportStyle: 'current', pdfMode, pageSize: 'a4', pageMargin: 'standard', text: readingSample, mode, readAsset })
        const { html } = await renderExport(readingSample, '春日读书记', resolveImage, new Map(), { stylesheet: look.stylesheet, fontsEmbedded: look.fontsEmbedded, captions: true })
        const name = mode === 'html' ? `${id}.html` : mode === 'pdf' ? `${id}-pdf-${look.paper.slice(1)}.html` : `${id}-print-${pdfMode}.html`
        writeFileSync(join(out!, name), html)
        console.log(name, `fonts=${look.fontsEmbedded} fallback=${look.fontFallback} fontBytes=${look.fontBytes} size=${html.length}`)
        expect(html).toContain('mino-doc')
      }
    }
    // Grid tables (T56 follow-up), printed in the book style.
    const style = readingStyle('paper')
    const typography = documentTypography({ ...defaultReadingSettings, tableStyle: 'grid' }, style)
    const look = await buildExportStyle({ style, typography, exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard', text: readingSample, mode: 'print', readAsset })
    const { html } = await renderExport(readingSample, '春日读书记', resolveImage, new Map(), { stylesheet: look.stylesheet, fontsEmbedded: look.fontsEmbedded, captions: true })
    writeFileSync(join(out!, 'paper-grid-print-print.html'), html)
  })
})
