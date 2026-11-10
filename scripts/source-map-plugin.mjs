import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Set by build.sh. Without it the build produces no source maps. */
export const sourceMapDir = process.env.MINO_SOURCEMAP_DIR

/** Tauri embeds everything in dist, so source maps have to leave it before the app is compiled. */
export function moveSourceMapsOutOfDist(destination) {
  let outDir = ''
  return {
    name: 'move-source-maps-out-of-dist',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    closeBundle() {
      for (const entry of readdirSync(outDir, { recursive: true, encoding: 'utf8' })) {
        if (!entry.endsWith('.map')) continue
        const moved = join(destination, entry)
        mkdirSync(dirname(moved), { recursive: true })
        renameSync(join(outDir, entry), moved)
      }
    },
  }
}
