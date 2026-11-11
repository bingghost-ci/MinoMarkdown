export type TextureId = 'paper' | 'xuan' | 'parchment' | 'kraft'

/**
 * Paper layers from scripts/generate-paper-textures.mjs. They are inlined as data URIs (about 1 MiB in all),
 * so the app, the preview and exported HTML use the same bytes without any file access.
 */
const files = import.meta.glob<string>('../../assets/paper/*.png', { query: '?inline', import: 'default', eager: true })

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

/** CSS background layers for a paper, top layer first; null for no texture. */
export function textureBackground(id: TextureId | null): { image: string; size: string; blend?: string } | null {
  const list = id ? layers[id] : undefined
  if (!id || !list) return null
  const urls = list.map(([name]) => files[`../../assets/paper/${id}-${name}.png`])
  if (urls.some((url) => !url)) return null
  return {
    image: urls.map((url) => `url("${url}")`).join(', '),
    size: list.map(([, size]) => `${size}px ${size}px`).join(', '),
  }
}
