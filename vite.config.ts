/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

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

export default defineConfig({
  plugins: [react(), woff2OnlyKatex()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  test: { css: { include: [/katex\.min\.css/] } },
})
