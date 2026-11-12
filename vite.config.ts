/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
// @ts-expect-error This helper uses Node APIs, and the project has no Node type definitions.
import { moveSourceMapsOutOfDist, sourceMapDir } from './scripts/source-map-plugin.mjs'
// @ts-expect-error As above.
import { pdfAssets } from './scripts/pdf-assets-plugin.mjs'

// WebKit reads KaTeX's WOFF2 files, so the WOFF and TTF copies would only make the app larger.
function woff2OnlyKatex(): Plugin {
  return {
    name: 'woff2-only-katex',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [name, file] of Object.entries(bundle)) {
        if (/KaTeX_.*\.(?:woff|ttf)$/.test(name)) delete bundle[name]
        else if (file.type === 'asset' && name.endsWith('.css') && typeof file.source === 'string') file.source = file.source.replace(/,\s*url\([^)]+\)\s*format\("(?:woff|truetype)"\)/g, '')
      }
    },
  }
}

// Bundled fonts may not exceed the reading-experience budget (doc/08 §3); the build fails instead.
export const FONT_BUDGET_BYTES = 48 * 1024 * 1024
function fontBudget(): Plugin {
  return {
    name: 'font-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      let total = 0
      for (const [name, file] of Object.entries(bundle)) {
        // The PDF renderer's substitute fonts are not reading fonts and are never loaded by CSS (T86).
        if (name.startsWith('pdfjs/')) continue
        if (/\.(?:woff2?|ttf|otf)$/.test(name) && file.type === 'asset') total += typeof file.source === 'string' ? file.source.length : file.source.byteLength
        if (/\.(?:woff|ttf|otf)$/.test(name)) this.error(`Only WOFF2 fonts may be bundled: ${name}`)
      }
      if (total > FONT_BUDGET_BYTES) this.error(`Bundled fonts take ${(total / 1048576).toFixed(1)} MiB, over the ${FONT_BUDGET_BYTES / 1048576} MiB budget`)
      this.info(`bundled fonts: ${(total / 1048576).toFixed(1)} MiB of ${FONT_BUDGET_BYTES / 1048576} MiB`)
    },
  }
}

// The window appears only after the entry chunk has run, so what it holds is paid for at every launch.
// The editor, the source editor, PDF.js, Mermaid and KaTeX load when a document needs them; an import that
// pulls one of them back into the entry chunk, or lets the chunk outgrow its budget, fails the build (T98).
// 622,951 bytes when the budget was set (T104), plus a tenth.
export const ENTRY_BUDGET_BYTES = 685_000
const ENTRY_FORBIDDEN = /node_modules\/(?:@codemirror|@lezer|@milkdown|prosemirror-[a-z]+|katex|mermaid|pdfjs-dist)\//
function entryBudget(): Plugin {
  return {
    name: 'entry-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue
        // A style sheet leaves an empty module behind; only code counts.
        const heavy = Object.keys(chunk.modules).filter((id) => ENTRY_FORBIDDEN.test(id) && !/\.css(?:\?|$)/.test(id))
        if (heavy.length) this.error(`${file}: the entry chunk must not contain ${heavy[0]} (and ${heavy.length - 1} more); import it lazily`)
        const bytes = new TextEncoder().encode(chunk.code).length
        if (bytes > ENTRY_BUDGET_BYTES) this.error(`${file}: the entry chunk is ${bytes} bytes, over its budget of ${ENTRY_BUDGET_BYTES}`)
        this.info(`entry chunk: ${bytes} bytes of ${ENTRY_BUDGET_BYTES}`)
      }
    },
  }
}

// micromark's entity decoder has a `browser` build that calls `document.createElement` while loading. Inside
// the analysis worker that stopped the worker from starting, and the app then quietly did all analysis on the
// main thread. The alias below selects the DOM-free build; this fails the build if the other one comes back.
function workerWithoutDom(): Plugin {
  return {
    name: 'worker-without-dom',
    generateBundle(_options, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.code.includes('document.createElement("i")')) this.error(`${file}: the analysis worker contains the DOM build of decode-named-character-reference`)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), woff2OnlyKatex(), fontBudget(), entryBudget(), pdfAssets(), ...(sourceMapDir ? [moveSourceMapsOutOfDist(sourceMapDir)] : [])],
  build: { sourcemap: sourceMapDir ? 'hidden' : false },
  // Code highlighting loads language parsers on demand inside the analysis worker, which needs code splitting.
  worker: { format: 'es', plugins: () => [workerWithoutDom()] },
  // The package's `browser` build decodes entities with `document.createElement`, which does not exist in a
  // worker: the analysis worker then failed while loading and every analysis ran on the main thread (T77).
  resolve: { alias: [{ find: /^decode-named-character-reference$/, replacement: new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url).pathname }] },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  test: {
    // Under Node PDF.js runs its worker code on the test's own thread, so stopping a document that is still
    // loading leaves the worker's "terminated" rejection unhandled there. In the app that happens inside the
    // worker thread and never reaches the page. Nothing else is ignored.
    onUnhandledError(error) { if (error.message === 'Worker was terminated' && String(error.stack).includes('pdf.worker')) return false },
    css: { include: [/katex\.min\.css/] },
  },
})
