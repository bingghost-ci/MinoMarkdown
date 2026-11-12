import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'pdfjs-dist')

/**
 * The files PDF.js reads at run time (T86), by the folder they are served from under `/pdfjs/`:
 * - `cmaps`: character maps for CJK fonts that name a predefined encoding;
 * - `standard_fonts`: substitutes for the 14 standard fonts a PDF may use without embedding them;
 * - `wasm`: only the JavaScript fallbacks of the JBIG2 and JPEG 2000 decoders. The `.wasm` files stay out:
 *   the app's CSP does not allow WebAssembly, and `openPdf` turns it off.
 * Licenses travel with the files they cover.
 */
const folders = {
  cmaps: (name) => name.endsWith('.bcmap') || name === 'LICENSE',
  standard_fonts: (name) => /\.(?:pfb|ttf)$/.test(name) || name.startsWith('LICENSE'),
  wasm: (name) => name.endsWith('_nowasm_fallback.js') || name.startsWith('LICENSE'),
}

export function pdfAssetFiles() {
  const files = []
  for (const [folder, wanted] of Object.entries(folders)) {
    for (const name of readdirSync(join(packageRoot, folder)).sort()) {
      if (wanted(name)) files.push({ served: `pdfjs/${folder}/${name}`, path: join(packageRoot, folder, name) })
    }
  }
  return files
}

const types = { js: 'text/javascript', bcmap: 'application/octet-stream', pfb: 'application/octet-stream', ttf: 'font/ttf' }

/** Copies those files into the build, and serves them from `node_modules` under `vite dev`. */
export function pdfAssets() {
  return {
    name: 'pdf-assets',
    generateBundle() {
      // Worker builds run this hook too; the files belong to the page build only.
      if (this.environment?.name && this.environment.name !== 'client') return
      for (const file of pdfAssetFiles()) this.emitFile({ type: 'asset', fileName: file.served, source: readFileSync(file.path) })
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const [, folder, name] = /^\/([a-z_]+)\/([\w.-]+)$/.exec((request.url ?? '').split('?')[0]) ?? []
        const path = folder && folders[folder]?.(name) ? join(packageRoot, folder, name) : null
        if (!path || !existsSync(path)) { next(); return }
        response.setHeader('Content-Type', types[name.split('.').pop()] ?? 'text/plain')
        response.end(readFileSync(path))
      })
    },
  }
}
