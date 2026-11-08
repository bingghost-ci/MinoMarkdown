import { describe, expect, it } from 'vitest'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'

describe('source-protected Markdown preview', () => {
  it('renders headings, tables and safe chapter anchors without changing source', () => {
    const source = '# 技术方案\n\n[附录](#source-study)\n\n<a id="source-study"></a>\n\n## 附录\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    const html = renderMarkdownPreview(source)
    expect(html).toContain('<h2 id="user-content-source-study">附录</h2>')
    expect(html).toContain('href="#source-study"')
    expect(html).toContain('<table>')
    expect(html).not.toContain('<a id="source-study">')
    expect(source).toContain('<a id="source-study"></a>')
  })

  it('drops executable HTML and does not load remote images', () => {
    const html = renderMarkdownPreview('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n![remote](https://example.com/x.png)\n\n[bad](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror=')
    expect(html).not.toContain('src="https:')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('[图片: remote]')
  })
})
