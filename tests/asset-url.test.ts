import { describe, expect, it } from 'vitest'
import { assetUrl, isAssetUrl, relativeFromAssetUrl } from '../src/features/editor/assetUrl'
import { imageUrlsIn, rewriteImageUrls } from '../src/features/export/snapshot'
import { prepareMarkdownAsync } from '../src/core/markdown/analysisClient'

describe('asset URLs', () => {
  const key = 'a'.repeat(32)

  it('round-trips names with spaces, Chinese and parentheses', () => {
    for (const relative of ['assets/图 1.png', 'a(b)/c).png', "it's!.jpg", 'x%20y.png']) {
      const url = assetUrl(key, relative)
      expect(isAssetUrl(url)).toBe(true)
      expect(relativeFromAssetUrl(url)).toBe(relative)
    }
  })

  it('stays a single valid Markdown destination after rewriting', () => {
    const url = assetUrl(key, 'assets/a(1.png')
    const markdown = rewriteImageUrls('![x](assets/b.png)\n', new Map([['assets/b.png', url]]))
    expect(imageUrlsIn(markdown)).toEqual([url])
  })

  it('leaves other URLs alone', () => {
    expect(relativeFromAssetUrl('blob:tauri://localhost/1')).toBeNull()
  })

  it('skips parsing when no image marker exists', () => {
    expect(imageUrlsIn('[link](a.png)\n')).toEqual([])
  })

  it('falls back to the main thread without a Worker', async () => {
    const source = '# 标题\n\n' + '内容\n\n'.repeat(3000)
    expect((await prepareMarkdownAsync(source)).analysis.mode).toBe('visual')
  })
})
