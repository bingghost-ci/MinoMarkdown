import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { isTocMarker } from '../src/core/markdown/toc'
import { findAlerts } from '../src/features/editor/alerts'
import { safeTextHandler } from '../src/features/editor/markdownStringify'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'
import { layoutRules } from '../src/features/reading/layouts'
import { bootMilkdown } from './helpers/milkdownPipeline'

describe('table of contents (T133)', () => {
  afterAll(() => vi.unstubAllGlobals())
  const source = '# 题目\n\n[TOC]\n\n## 第一节\n\n### 小节 `a`\n\n## 第二节\n\n##### 太深\n'

  it('recognizes a line that says only [TOC]', () => {
    for (const text of ['[TOC]', '[toc]', ' [Toc] ']) expect(isTocMarker(text)).toBe(true)
    for (const text of ['[TOC] 目录', 'TOC', '[TOC][x]']) expect(isTocMarker(text)).toBe(false)
  })

  it('draws the headings in its place, linked to ids of its own, without the lone title or deep headings', () => {
    const html = renderMarkdownPreview(source)
    expect(html).not.toContain('[TOC]')
    expect(html).toContain('<nav class="mino-toc"><p class="mino-toc-title"></p><ul>')
    expect(html).toContain('<li class="mino-toc-2"><a href="#user-content-mino-h-1">第一节</a></li>')
    expect(html).toContain('<li class="mino-toc-3"><a href="#user-content-mino-h-2">小节 a</a></li>')
    expect(html).toContain('<h2 id="user-content-mino-h-1">第一节</h2>')
    expect(html).not.toContain('>题目</a>')
    expect(html).not.toContain('>太深</a>')
  })

  it('lists first-level headings when the document has several, and leaves other text alone', () => {
    expect(renderMarkdownPreview('[TOC]\n\n# 上篇\n\n# 下篇\n')).toContain('<li class="mino-toc-1"><a href="#user-content-mino-h-1">上篇</a></li>')
    expect(renderMarkdownPreview('见 [TOC] 一词\n\n## 节\n')).toContain('[TOC]')
    expect(renderMarkdownPreview('> [TOC]\n\n## 节\n')).not.toContain('mino-toc')
  })

  it('takes nothing but text from the headings', () => {
    const html = renderMarkdownPreview('[TOC]\n\n## <img src=x onerror=alert(1)> 节 <script>x</script>\n')
    expect(html).not.toMatch(/onerror|<script/)
  })

  it('numbers its entries as the layout numbers the sections', () => {
    const css = layoutRules('technical', '.mino-doc')
    expect(css).toContain('.mino-doc .mino-toc{counter-reset:mino-t2 mino-t3 mino-t4}')
    expect(css).toContain('.mino-doc .mino-toc-3 > a::before{content:counter(mino-t2) "." counter(mino-t3)')
  })

  it('keeps the marker as typed when the editor writes the document, and marks its line', async () => {
    const { roundTrip, parse } = await bootMilkdown({ configure: (ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, handlers: { ...options.handlers, text: safeTextHandler } })) })
    expect(roundTrip('[TOC]\n\n# 标题\n')).toBe('[TOC]\n\n# 标题\n')
    expect(roundTrip('[toc]\n')).toBe('[toc]\n')
    // Inside a sentence the bracket is escaped as before.
    expect(roundTrip('见 \\[TOC] 一词\n')).toBe('见 \\[TOC] 一词\n')
    const doc = parse('[TOC]\n\n正文 [TOC]\n\n> [TOC]\n')
    const found = findAlerts(doc).filter((item) => item.type === 'toc')
    expect(found).toHaveLength(1)
    expect(doc.nodeAt(found[0].quote)?.textContent).toBe('[TOC]')
  })
})
