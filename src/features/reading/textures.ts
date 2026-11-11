import type { TextureId } from './styles'

/**
 * Paper tiles from scripts/generate-paper-textures.mjs. They are inlined as data URIs (about 350 KiB in
 * all), so the app, the preview and exported HTML use the same bytes without any file access.
 */
const tiles = import.meta.glob<string>('../../assets/paper/*.png', { query: '?inline', import: 'default', eager: true })

export const textureUrls: Record<TextureId, string> = Object.fromEntries(Object.entries(tiles).map(([path, url]) => [path.split('/').pop()!.replace('.png', ''), url])) as Record<TextureId, string>

export function textureUrl(id: TextureId | null): string | null {
  return id ? textureUrls[id] ?? null : null
}
