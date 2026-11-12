import { describe, expect, it } from 'vitest'
import { renderExport, type ImageResolver } from '../src/features/export/renderHtml'

const renderHtml = async (markdown: string, title: string, resolveImage: ImageResolver) => (await renderExport(markdown, title, resolveImage)).html
import { snapshotResources } from '../src/features/export/snapshot'

describe('self-contained HTML export', () => {
  it('uses the current snapshot and embeds a verified local image', async () => {
    const html = await renderHtml('# 未保存的新内容\n\n![截图](assets/shot.png)\n', '记录', async (url) => {
      expect(url).toBe('assets/shot.png')
      return { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }
    })
    expect(html).toContain('未保存的新内容')
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).not.toContain('assets/shot.png')
    expect(html).toContain('@page { size: A4; margin: 18mm; }')
    expect(html).toContain('thead { display: table-header-group; }')
  })

  it('escapes the title and rejects unresolved images', async () => {
    const html = await renderHtml('[bad](javascript:alert(1))\n', '<script>alert(1)</script>', async () => null)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('href="javascript:')
    await expect(renderHtml('![remote](https://example.com/x.png)', 'test', async () => null)).rejects.toThrow('图片无法内嵌')
  })

  it('embeds a reference image without changing a separate reference link', async () => {
    const source = '[文档][link] 和 ![图片][pic]\n\n[link]: https://example.org/path\n[pic]: ./assets/中文%20图片%23%25%28a%29.png "本地图片"'
    const html = await renderHtml(source, '引用图片', async (url) => {
      expect(url).toBe('./assets/中文%20图片%23%25%28a%29.png')
      return { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }
    })
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).toContain('href="https://example.org/path"')
    expect(html).not.toContain('./assets/')
  })

  it('rejects a reference definition shared by a link and image', async () => {
    await expect(renderHtml('[文档][same] ![图片][same]\n\n[same]: assets/a.png', '共享', async () => ({ mime: 'image/png', bytes: new Uint8Array([1]) }))).rejects.toThrow('EXPORT_RESOURCE_SHARED_REFERENCE')
  })

  it('does not emit executable raw HTML, event attributes or active links', async () => {
    const html = await renderHtml('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](data:text/html,evil)', '安全检查', async () => null)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain(' onerror=')
    expect(html).not.toContain('href="data:')
    expect(html).toContain("default-src 'none'")
  })

  it('leaves front matter out of the page body', async () => {
    const html = await renderHtml('---\ntitle: 机密元数据\n---\n# 正文\n', '文档', async () => null)
    expect(html).toContain('<h1>正文</h1>')
    expect(html).not.toContain('机密元数据')
    const crlf = await renderHtml('\uFEFF---\r\ntitle: 机密元数据\r\n---\r\n# 正文\r\n', '文档', async () => null)
    expect(crlf).not.toContain('机密元数据')
  })

  it('reports raw HTML it removes from a source-protected document, but not comments', async () => {
    const source = '# 技术方案\n\n<div onclick="alert(1)">内容</div>\n\n<!-- 备注 -->\n\n<script>alert(1)</script>\n\n:::note\n指令\n:::\n'
    const { html, omittedHtml } = await renderExport(source, '技术方案', async () => null)
    expect(omittedHtml).toBe(2)
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('onclick')
    expect(html).toContain('技术方案')
    expect(html).toContain(':::note')
  })
})

describe('snapshot resources without an editor instance', () => {
  it('uses recovered assets and disk files for a source-protected document', () => {
    const recovered = { url: 'blob:one', mime: 'image/png' }
    expect(snapshotResources(['blob:one', 'assets/a.png'], new Map([['blob:one', recovered]]), true)).toEqual({ assets: [recovered], diskAssets: [{ url: 'assets/a.png', relative: 'assets/a.png' }] })
  })

  it('rejects images that can not be read locally', () => {
    expect(() => snapshotResources(['https://example.com/x.png'], new Map(), true)).toThrow('EXPORT_RESOURCE_MISSING')
    expect(() => snapshotResources(['assets/a.png'], new Map(), false)).toThrow('EXPORT_RESOURCE_MISSING')
    expect(() => snapshotResources(['../secret.png'], new Map(), true)).toThrow('EXPORT_RESOURCE_MISSING')
  })
})
