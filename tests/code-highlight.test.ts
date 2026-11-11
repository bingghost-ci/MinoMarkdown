import { describe, expect, it } from 'vitest'
import { codeLanguages, HIGHLIGHT_BLOCK_LIMIT, loadCodeParsers } from '../src/core/markdown/highlight'
import { syntaxRoles } from '../src/core/markdown/syntaxRoles'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'
import { renderExport } from '../src/features/export/renderHtml'
import { documentElementCss, DOC_ROOT } from '../src/features/reading/css'

const sample = '# 代码\n\n```js\nconst total = 1 // 注释\nconsole.log("<script>alert(1)</script>")\n```\n\n```\nplain <b>text</b>\n```\n\n```nosuchlang\nconst x = 1\n```\n'

describe('code highlighting in preview and export', () => {
  it('finds the fence languages a document uses', () => {
    expect(codeLanguages(sample)).toEqual(['js', 'nosuchlang'])
    expect(codeLanguages('~~~Python title\nx\n~~~\n    ```js indented code is not a fence\n')).toEqual(['python'])
  })

  it('loads parsers for known languages only', async () => {
    const parsers = await loadCodeParsers(sample)
    expect([...parsers.keys()]).toEqual(['js'])
  })

  it('colors tokens with fixed classes and keeps code text escaped', async () => {
    const html = renderMarkdownPreview(sample, undefined, true, await loadCodeParsers(sample))
    expect(html).toContain('<span class="tok-keyword">const</span>')
    expect(html).toMatch(/<span class="tok-comment">\/\/ 注释<\/span>/)
    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/\sstyle=/)
    expect(html).toContain('<code>plain &#x3C;b>text&#x3C;/b>\n</code>')
    expect(html).toContain('<code class="language-nosuchlang">const x = 1\n</code>')
    const classes = new Set(Array.from(html.matchAll(/class="([^"]+)"/g), (match) => match[1]).filter((name) => name.startsWith('tok-')))
    for (const name of classes) expect(syntaxRoles.map((role) => `tok-${role}`)).toContain(name)
  })

  it('renders plain code without parsers and for blocks over the size limit', async () => {
    expect(renderMarkdownPreview(sample)).not.toContain('tok-')
    const big = '```js\n' + 'const a = 1\n'.repeat(Math.ceil(HIGHLIGHT_BLOCK_LIMIT / 12) + 1) + '```\n'
    expect(renderMarkdownPreview(big, undefined, true, await loadCodeParsers(big))).not.toContain('tok-')
  })

  it('highlights exported pages and styles the token classes from the syntax palette', async () => {
    const { html } = await renderExport(sample, '导出', async () => null)
    expect(html).toContain('<span class="tok-keyword">const</span>')
    const css = documentElementCss(DOC_ROOT)
    for (const role of syntaxRoles) expect(css).toContain(`.mino-doc pre .tok-${role}{color:var(--syntax-${role})}`)
  })
})
