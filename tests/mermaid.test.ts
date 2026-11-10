// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mayContainMermaid, mermaidSources } from '../src/core/markdown/diagrams'
import { analyzeMarkdown } from '../src/core/markdown/compatibility'
import { renderExport } from '../src/features/export/renderHtml'
import { renderMermaidPreview, sanitizeDiagramSvg } from '../src/features/diagrams/mermaid'

const fence = (code: string) => `# 图\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`

describe('finding diagrams', () => {
  it('reads each fence once, including in quotes, and ignores others', () => {
    const source = `${fence('graph TD\n A-->B')}\n> \`\`\`Mermaid\n> pie\n> \`\`\`\n\n${fence('graph TD\n A-->B')}\n\`\`\`js\nmermaid\n\`\`\`\n`
    expect(mermaidSources(source)).toEqual(['graph TD\n A-->B', 'pie'])
  })

  it('skips parsing when no fence can exist', () => {
    expect(mayContainMermaid('# 普通文档 mermaid\n')).toBe(false)
    expect(mayContainMermaid(fence('pie'))).toBe(true)
  })

  it('keeps a diagram as an ordinary code block in the file model', () => {
    const analysis = analyzeMarkdown(new TextEncoder().encode(fence('graph TD\n A-->B')))
    expect(analysis.mode).toBe('visual')
    expect(analysis.body).toContain('```mermaid\ngraph TD\n A-->B\n```')
  })
})

describe('sanitizing a diagram', () => {
  it('removes scripts, handlers, remote references and remote CSS', () => {
    const svg = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><style>@import url(https://evil.test/a.css); .a { background: url(https://evil.test/b.png); fill: red }</style><script>alert(1)</script><a href="javascript:alert(1)"><text>x</text></a><image href="https://evil.test/c.png"/><foreignObject><img src="https://evil.test/d.png" onerror="alert(1)"/></foreignObject><rect class="a" onclick="alert(1)" style="background:url(https://evil.test/e.png)" width="1" height="1"/><use href="https://evil.test/f.svg#a"/><use href="#marker"/></svg>')
    expect(svg).not.toMatch(/onload|onclick|onerror|<script|javascript:|evil\.test|<img|<image/i)
    expect(svg).toContain('<rect')
    expect(svg).toContain('fill: red')
    expect(svg).toContain('href="#marker"')
  })
})

describe('the editor preview hook', () => {
  it('ignores other languages and empty diagrams', () => {
    expect(renderMermaidPreview('javascript', 'x', () => undefined)).toBeNull()
    expect(renderMermaidPreview('mermaid', '   ', () => undefined)).toBeNull()
  })
})

describe('diagrams in export', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"></rect></svg>'

  it('embeds a sanitized static SVG in place of the fence', async () => {
    const { html, failedDiagrams } = await renderExport(fence('graph TD\n A-->B'), '图', async () => null, new Map([['graph TD\n A-->B', svg]]))
    expect(failedDiagrams).toBe(0)
    expect(html).toContain('<figure class="mermaid-diagram"><svg')
    expect(html).not.toContain('language-mermaid')
    expect(html).not.toContain('<script')
  })

  it('keeps the code and reports it when a diagram fails', async () => {
    const { html, failedDiagrams } = await renderExport(fence('这不是图<script>alert(1)</script>'), '图', async () => null, new Map())
    expect(failedDiagrams).toBe(1)
    expect(html).toContain('language-mermaid')
    expect(html).toContain('&#x3C;script>alert(1)')
    expect(html).not.toContain('<script>alert')
  })
})
