// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { htmlImageSource, renderHtmlImages } from '../src/features/editor/htmlImages'
import { prepareMarkdown, composeVisualMarkdown } from '../src/core/markdown/codec'

const key = 'a'.repeat(32)

describe('raw HTML images in the editor', () => {
  it('draws a centered image beside the document through the asset scheme', () => {
    const drawn = renderHtmlImages('<p align="center"><img src="images/modules.svg" alt="Jarvis 代码分层" width="860"></p>', key)!
    expect(drawn).not.toBeNull()
    const box = drawn.querySelector('.mino-html-block') as HTMLElement
    expect(box.style.textAlign).toBe('center')
    const image = drawn.querySelector('img')!
    expect(image.getAttribute('src')).toBe(`mino-asset://localhost/${key}/images/modules.svg`)
    expect(image.alt).toBe('Jarvis 代码分层')
    expect(image.style.width).toBe('860px')
  })

  it('handles a bare image, <center>, line breaks and several images', () => {
    expect(renderHtmlImages('<img src="./a.png">', key)?.querySelector('img')?.getAttribute('src')).toBe(`mino-asset://localhost/${key}/a.png`)
    const many = renderHtmlImages('<center><img src="a.png"><br><img src="b%20c.png" width="50%"></center>', key)!
    expect(many.querySelectorAll('img')).toHaveLength(2)
    expect((many.querySelectorAll('img')[1] as HTMLElement).style.width).toBe('50%')
  })

  it('keeps showing the source of anything that is not just layout around images', () => {
    for (const value of ['<b>bold</b>', '<br>', '<div>text</div>', '<img src="a.png" onerror="alert(1)"><script>alert(1)</script>', '<a href="x"><img src="a.png"></a>', '<table><tr><td><img src="a.png"></td></tr></table>', '<details><img src="a.png"></details>']) {
      expect(renderHtmlImages(value, key), value).toBeNull()
    }
  })

  it('never copies event handlers, styles or other attributes', () => {
    const drawn = renderHtmlImages('<p align="center" style="background:url(https://x)" onclick="x()"><img src="a.png" onerror="x()" style="filter:url(https://x)" width="10;color:red"></p>', key)!
    expect(drawn.innerHTML).not.toMatch(/onerror|onclick|https:|color:red/)
  })

  it('loads nothing remote: such images show their alt text', () => {
    for (const src of ['https://example.com/a.png', '//example.com/a.png', '/etc/a.png', 'file:///a.png', 'javascript:alert(1)', '../outside.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      expect(htmlImageSource(src, key), src).toBeNull()
    }
    const drawn = renderHtmlImages('<img src="https://example.com/a.png" alt="远程">', key)!
    expect(drawn.querySelector('img')).toBeNull()
    expect(drawn.textContent).toBe('[图片: 远程]')
    expect(htmlImageSource('data:image/png;base64,iVBORw0KGgo=', key)).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(htmlImageSource('a.png', '')).toBeNull()
  })

  it('leaves the saved text unchanged', () => {
    const source = '# 1 总体结构\n\n<p align="center"><img src="images/modules.svg" alt="Jarvis 代码分层" width="860"></p>\n\n正文\n'
    const prepared = prepareMarkdown(source)
    expect(prepared.analysis.mode).toBe('visual')
    expect(composeVisualMarkdown(prepared.analysis, prepared.editorMarkdown)).toBe(source)
  })
})

import { parseHtmlImages } from '../src/core/markdown/htmlImages'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'
import { renderExport } from '../src/features/export/renderHtml'
import { htmlImageFilesIn } from '../src/core/markdown/htmlImagePaths'

const DOC = '# 1 总体结构\n\n<p align="center"><img src="images/modules.svg" alt="Jarvis 代码分层" width="860"></p>\n\n正文 <img src="assets/a.png" alt="行内"> 结束\n\n<div class="x"><b>其他 HTML</b></div>\n'

describe('the shared reader of raw HTML images', () => {
  it('reads the subset in one pass and refuses anything else whole', () => {
    expect(parseHtmlImages('<p align="center"><img src="a.svg" alt="&quot;图&quot; &amp; 说明" width="860px"/></p>')).toEqual([
      { type: 'box', tag: 'p', align: 'center', children: [{ type: 'img', src: 'a.svg', alt: '"图" & 说明', width: '860' }] },
    ])
    expect(parseHtmlImages('<!-- note --><IMG SRC=a.png>')).toEqual([{ type: 'img', src: 'a.png', alt: '' }])
    for (const value of ['<p>no image</p>', '<p><img src=a.png></div>', '<img src=a.png><!-- open', '<img src=a.png><svg onload=x>', 'x'.repeat(20_001) + '<img src=a.png>']) {
      expect(parseHtmlImages(value), value.slice(0, 40)).toBeNull()
    }
    expect(parseHtmlImages('<p>' + '<img src=a.png>'.repeat(65) + '</p>')).toBeNull()
  })

  it('lists only files beside the document', () => {
    expect(htmlImageFilesIn('<img src="images/a.svg"><img src="https://x/a.png"><img src="../b.png"><img src="images/a.svg">')).toEqual([{ url: 'images/a.svg', relative: 'images/a.svg' }])
    expect(htmlImageFilesIn(DOC)).toEqual([{ url: 'images/modules.svg', relative: 'images/modules.svg' }, { url: 'assets/a.png', relative: 'assets/a.png' }])
    expect(htmlImageFilesIn('<img src="./a%20b.png">')).toEqual([{ url: './a%20b.png', relative: 'a b.png' }])
    expect(htmlImageFilesIn('```html\n<img src="code.png">\n```\n')).toEqual([])
    expect(htmlImageFilesIn('no images here')).toEqual([])
  })

  it('shows the images in the preview and still leaves other raw HTML out', () => {
    const html = renderMarkdownPreview(DOC, key)
    // A lone centered image becomes a figure, as a Markdown image on its own line does.
    expect(html).toContain(`<figure class="mino-figure"><img src="mino-asset://localhost/${key}/images/modules.svg" alt="Jarvis 代码分层" width="860"><figcaption>Jarvis 代码分层</figcaption></figure>`)
    expect(renderMarkdownPreview('<p align="right"><img src="a.png"> 说明</p>', key)).toContain(`<p align="right"><img src="mino-asset://localhost/${key}/a.png" alt=""> 说明</p>`)
    expect(html).toContain(`正文 <span><img src="mino-asset://localhost/${key}/assets/a.png" alt="行内"></span> 结束`)
    expect(html).not.toContain('其他 HTML')
    expect(renderMarkdownPreview('<img src="https://example.com/t.png" alt="远程">', key)).not.toContain('example.com')
    expect(renderMarkdownPreview('<p align="center"><img src="a.png"></p>')).toContain('[图片: 未命名]')
  })

  it('embeds them in an exported page, SVG included, and shows a missing one as its alt text', async () => {
    const files = new Map([['images/modules.svg', { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: 'image/svg+xml' }]])
    const asked: string[] = []
    const { html, omittedHtml } = await renderExport(DOC, '方案', async (url) => { asked.push(url); return files.get(url) ?? null })
    expect(html).toMatch(/<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="Jarvis 代码分层" width="860">/)
    expect(html).toContain('[图片: 行内]')
    expect(html).not.toContain('其他 HTML')
    expect(omittedHtml).toBe(1)
    expect(asked.sort()).toEqual(['assets/a.png', 'images/modules.svg'])
  })
})
