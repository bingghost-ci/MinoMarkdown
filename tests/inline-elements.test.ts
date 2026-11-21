import { describe, expect, it } from 'vitest'
import { contrast } from '../src/features/reading/color'
import { documentElementCss, styleVariables, DOC_ROOT, EDITOR_ROOT } from '../src/features/reading/css'
import { readingStyles } from '../src/features/reading/styles'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'

describe('inline and small elements (T125)', () => {
  it('lets bare kbd, mark, sub and sup through as elements and nothing else of raw HTML', () => {
    const html = renderMarkdownPreview('按 <kbd>⌘S</kbd> 保存，<mark>**重点**</mark>，H<sub>2</sub>O，x<sup>2</sup>。\n')
    expect(html).toContain('<kbd>⌘S</kbd>')
    expect(html).toContain('<mark><strong>重点</strong></mark>')
    expect(html).toContain('H<sub>2</sub>O')
    expect(html).toContain('x<sup>2</sup>')
  })

  it('keeps tags with attributes, unclosed tags and other tags out', () => {
    const html = renderMarkdownPreview('<kbd onclick="x()">A</kbd> <mark style="color:red">B</mark> <kbd>C <b>D</b> <span>E</span>\n\n<mark>块\n\n另一段</mark>\n')
    expect(html).not.toMatch(/<kbd|<mark|onclick|style=|<span|<b>/)
    expect(html).toContain('A')
  })

  it('styles them for the editor and the page alike, with a mark the text stays readable on', () => {
    for (const root of [DOC_ROOT, EDITOR_ROOT]) {
      const css = documentElementCss(root)
      for (const rule of [' mark{', ' kbd{', ' del{', ' .footnotes::before{', ' sup a[data-footnote-ref]{', 'li[data-item-type="task"][data-checked="true"]']) expect(css, rule).toContain(`${root}${rule.startsWith('li') ? ' ' : ''}${rule}`)
    }
    for (const style of readingStyles.filter((style) => !style.dark)) {
      const mark = styleVariables(style)['--mark']
      expect(contrast(style.text, mark), `${style.id} text on mark`).toBeGreaterThanOrEqual(7)
    }
  })

  it('hides the footnotes heading from sight and keeps the section', () => {
    const html = renderMarkdownPreview('脚注[^a]。\n\n[^a]: 内容。\n')
    expect(html).toContain('class="footnotes"')
    expect(html).toContain('class="sr-only"')
    expect(html).toContain('data-footnote-ref')
  })
})

describe('code block language labels (T127)', () => {
  it('names the language on the block, and only a plain name', () => {
    expect(renderMarkdownPreview('```rust\nfn main() {}\n```\n')).toContain('<pre data-lang="rust">')
    expect(renderMarkdownPreview('```C++\nint x;\n```\n')).toContain('<pre data-lang="c++">')
    expect(renderMarkdownPreview('```\nplain\n```\n')).toContain('<pre><code>')
    expect(renderMarkdownPreview('```mermaid\ngraph TD\n```\n')).not.toContain('data-lang')
    expect(renderMarkdownPreview('```a"b<c\nx\n```\n')).not.toContain('data-lang')
  })

  it('draws the label over the corner without taking room', () => {
    const css = documentElementCss(DOC_ROOT)
    expect(css).toContain('.mino-doc pre[data-lang]::after{content:attr(data-lang);position:absolute')
  })
})
