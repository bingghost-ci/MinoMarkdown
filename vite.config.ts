/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
// @ts-expect-error This helper uses Node APIs, and the project has no Node type definitions.
import { moveSourceMapsOutOfDist, sourceMapDir } from './scripts/source-map-plugin.mjs'

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
export const FONT_BUDGET_BYTES = 32 * 1024 * 1024
function fontBudget(): Plugin {
  return {
    name: 'font-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      let total = 0
      for (const [name, file] of Object.entries(bundle)) {
        if (/\.(?:woff2?|ttf|otf)$/.test(name) && file.type === 'asset') total += typeof file.source === 'string' ? file.source.length : file.source.byteLength
        if (/\.(?:woff|ttf|otf)$/.test(name)) this.error(`Only WOFF2 fonts may be bundled: ${name}`)
      }
      if (total > FONT_BUDGET_BYTES) this.error(`Bundled fonts take ${(total / 1048576).toFixed(1)} MiB, over the ${FONT_BUDGET_BYTES / 1048576} MiB budget`)
      this.info(`bundled fonts: ${(total / 1048576).toFixed(1)} MiB of ${FONT_BUDGET_BYTES / 1048576} MiB`)
    },
  }
}

export default defineConfig({
  plugins: [react(), woff2OnlyKatex(), fontBudget(), ...(sourceMapDir ? [moveSourceMapsOutOfDist(sourceMapDir)] : [])],
  build: { sourcemap: sourceMapDir ? 'hidden' : false },
  // Code highlighting loads language parsers on demand inside the analysis worker, which needs code splitting.
  worker: { format: 'es' },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  test: { css: { include: [/katex\.min\.css/, /@fontsource\/noto-serif-sc\/\d+\.css/] } },
})
