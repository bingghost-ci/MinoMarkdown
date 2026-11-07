import { describe, expect, it } from 'vitest'
import { imageUrlsIn, localAssetPath, rewriteImageUrls } from '../src/features/export/snapshot'

describe('image manifest', () => {
  it('finds only image nodes and deduplicates references', () => {
    const source = '`![ignored](assets/code.png)`\n\n![a](assets/one.png) ![b](assets/one.png) [link](assets/not-image.png)'
    expect(imageUrlsIn(source)).toEqual(['assets/one.png'])
  })

  it('rewrites persisted image destinations without changing code, text, or links', () => {
    const source = '`blob:one` and blob:one\n\n![blob:one](blob:one "blob:one")\n\n[link](blob:one)\n\n```md\n![x](blob:one)\n```\n\n![again](blob:one)'
    const result = rewriteImageUrls(source, new Map([['blob:one', 'assets/image.png'], ['blob:deleted', 'assets/deleted.png']]))
    expect(result).toContain('`blob:one` and blob:one')
    expect(result).toContain('![blob:one](assets/image.png "blob:one")')
    expect(result).toContain('[link](blob:one)')
    expect(result).toContain('```md\n![x](blob:one)\n```')
    expect(result).toContain('![again](assets/image.png)')
    expect(result).not.toContain('assets/deleted.png')
  })

  it('hydrates a local image without changing an equal path in prose or code', () => {
    const source = '路径 assets/pic.png\n\n`assets/pic.png`\n\n![图](assets/pic.png)\n\n[附件](assets/pic.png)'
    const hydrated = rewriteImageUrls(source, new Map([['assets/pic.png', 'blob:local-picture']]))
    expect(hydrated).toBe('路径 assets/pic.png\n\n`assets/pic.png`\n\n![图](blob:local-picture)\n\n[附件](assets/pic.png)')
  })

  it('resolves reference images and encoded local paths without changing reference links', () => {
    const source = '[链接][ref] 和 ![图片][pic]\n\n[ref]: https://example.org/path\n[pic]: ./assets/中文%20图片%23%25%28a%29.png "标题"'
    const original = './assets/中文%20图片%23%25%28a%29.png'
    expect(imageUrlsIn(source)).toEqual([original])
    expect(localAssetPath(original)).toBe('assets/中文 图片#%(a).png')
    const hydrated = rewriteImageUrls(source, new Map([[original, 'blob:local-picture']]))
    expect(hydrated).toContain('[ref]: https://example.org/path')
    expect(hydrated).toContain('[pic]: blob:local-picture "标题"')
    expect(rewriteImageUrls(hydrated, new Map([['blob:local-picture', original]]))).toBe(source)
  })

  it('rejects shared image and link definitions during rewriting', () => {
    const source = '[链接][both] ![图][both]\n\n[both]: assets/a.png'
    expect(() => rewriteImageUrls(source, new Map([['assets/a.png', 'blob:image']]))).toThrow('INVALID_ASSET')
    expect(localAssetPath('assets/%2e%2e%2fsecret.png')).toBeNull()
  })

  it('restores a draft image without replacing the same URL in prose or a link', () => {
    const source = '草稿 blob:recovered\n\n[链接](blob:recovered) ![图片](blob:recovered)'
    const restored = rewriteImageUrls(source, new Map([['blob:recovered', 'blob:new-session']]))
    expect(restored).toBe('草稿 blob:recovered\n\n[链接](blob:recovered) ![图片](blob:new-session)')
  })

  it('rewrites angle-bracket and spaced image destinations without touching their titles', () => {
    const source = '![图](<assets/中文 图片.png> "标题")\n\n![另图](  assets/a.png "说明")'
    const result = rewriteImageUrls(source, new Map([['assets/中文 图片.png', 'blob:space'], ['assets/a.png', 'blob:a']]))
    expect(result).toBe('![图](<blob:space> "标题")\n\n![另图](  blob:a "说明")')
  })
})
