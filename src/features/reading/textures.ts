export type TextureId = 'paper' | 'xuan' | 'parchment' | 'kraft'

/**
 * Paper layers from scripts/generate-paper-textures.mjs, by the URL the build gives each file. The app draws
 * them from those files. They used to be inlined as data URIs, which put 1.4 MB of text into the entry bundle
 * and again into the style sheet written at startup, for layers the default style never shows (T98). An
 * export still carries its paper inside the page: it reads the layers of its one style and inlines those.
 */
const files = import.meta.glob<string>('../../assets/paper/*.png', { query: '?url', import: 'default', eager: true })

/**
 * Each paper's layers, top first, with the side in CSS px each one is drawn at. This mirrors `textureSpecs`
 * in the generator (tests/paper-textures.test.ts keeps the two in step). The grain tile is small and
 * repeats often; the structure layers repeat every 1024 px, wider than a page column. Cloud layers are
 * stored at 256 px and drawn at 1024 px.
 */
const layers: Record<TextureId, Array<[name: string, size: number]>> = {
  paper: [['fibers', 1024], ['laid', 384], ['grain', 256]],
  xuan: [['fibers', 1024], ['laid', 432], ['grain', 256]],
  parchment: [['pores', 1024], ['clouds', 1024], ['grain', 256]],
  kraft: [['fibers', 1024], ['clouds', 1024], ['grain', 256]],
}

/** The files of a paper's layers, top layer first. */
export function textureFiles(id: TextureId | null): string[] {
  return id ? (layers[id] ?? []).map(([name]) => files[`../../assets/paper/${id}-${name}.png`]).filter(Boolean) : []
}

/**
 * CSS background layers for a paper, top layer first; null for no texture. `source` gives the address to write
 * for a layer's file: an export passes the data URIs it read, and a layer it could not read leaves the page plain.
 */
export function textureBackground(id: TextureId | null, source: (file: string) => string | undefined = (file) => file): { image: string; size: string } | null {
  const list = id ? layers[id] : undefined
  if (!id || !list) return null
  const urls = list.map(([name]) => { const file = files[`../../assets/paper/${id}-${name}.png`]; return file ? source(file) : undefined })
  if (urls.some((url) => !url)) return null
  return {
    image: urls.map((url) => `url("${url}")`).join(', '),
    size: list.map(([, size]) => `${size}px ${size}px`).join(', '),
  }
}
