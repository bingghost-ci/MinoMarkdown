import { describe, expect, it, vi } from 'vitest'
import { Editor, parserCtx, remarkStringifyOptionsCtx, SerializerReady, serializerCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { blockLatexSchema } from '../node_modules/@milkdown/crepe/src/feature/latex/block-latex'
import { mathInlineSchema } from '../node_modules/@milkdown/crepe/src/feature/latex/inline-latex'
import { remarkMathBlockPlugin, remarkMathPlugin } from '../node_modules/@milkdown/crepe/src/feature/latex/remark'
import { prepareMarkdown } from '../src/core/markdown/codec'
import { analyzeMarkdown, protectedFragments } from '../src/core/markdown/compatibility'
import { CREPE_INLINE_MATH_RULE, STRICT_INLINE_MATH_RULE } from '../src/core/markdown/math'
import { remarkDemoteCurrencyPlugin } from '../src/features/editor/mathEditor'
import { safeTextHandler } from '../src/features/editor/markdownStringify'
import { embedMathStyles } from '../src/features/export/katexStyles'
import { renderExport } from '../src/features/export/renderHtml'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'

const mode = (source: string) => analyzeMarkdown(new TextEncoder().encode(source)).mode

async function editorPipeline() {
  const events = new EventTarget()
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  return new Promise<(markdown: string) => string>((resolve) => {
    const capture: MilkdownPlugin = (ctx) => async () => {
      await ctx.wait(SerializerReady)
      const parse = ctx.get(parserCtx)
      const serialize = ctx.get(serializerCtx)
      resolve((markdown) => serialize(parse(markdown)))
    }
    void Editor.make()
      .config((ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, handlers: { ...options.handlers, text: safeTextHandler } })))
      .use(commonmark).use(gfm).use(remarkMathPlugin).use(remarkMathBlockPlugin).use(remarkDemoteCurrencyPlugin).use(mathInlineSchema).use(blockLatexSchema).use(capture)
      .create().catch(() => undefined)
  })
}

describe('which formulas stay visual', () => {
  it.each(['行内 $E=mc^2$ 公式\n', '$$\n\\sum_{i=1}^n i\n$$\n', '> 引用 $x$\n', '价格 $5 和 $6\n', '转义 \\$x\\$\n', '代码 `$x$`\n', '```js\nconst a = "$x$"\n```\n', 'US$5 到 C$6\n'])('%j', (source) => {
    expect(mode(source)).toBe('visual')
  })

  it.each(['$$x$$ 行内双美元\n', '$$\n未闭合\n', '```latex\n\\alpha\n```\n', ':::note\n指令\n:::\n'])('sends %j to source protection', (source) => {
    expect(mode(source)).toBe('source-protected')
  })

  it('treats a price as text but a formula as a formula', () => {
    expect(protectedFragments('价格 $5 和 $6\n')).toEqual([])
    expect(protectedFragments('行内 $x^2$\n')).toEqual(['inlineMath:x^2'])
    expect(protectedFragments('$$\na\n$$\n')).toEqual(['math:a'])
  })

  it('keeps inline formatting inside text that only looked like a formula', () => {
    expect(mode('花了 $5 买 **书** 和 $6\n')).toBe('visual')
    expect(renderMarkdownPreview('花了 $5 买 **书** 和 $6\n')).toContain('<strong>书</strong>')
  })
})

describe('round trip through the editor schema', () => {
  it.each([
    '行内 $E=mc^2$ 公式。\n',
    '$$\n\\sum_{i=1}^n i\n$$\n',
    '价格 $5 和 $6。\n',
    '转义 \\$x\\$ 文本。\n',
    '代码 `$x$` 不变。\n',
    '公式 $x$ 后面花了 $5。\n',
    '价格 $5 **粗体** 文本。\n',
  ])('keeps %j unchanged', async (source) => {
    const roundTrip = await editorPipeline()
    expect(roundTrip(prepareMarkdown(source).editorMarkdown).trimEnd()).toBe(source.trimEnd())
  })

  it('keeps a broken formula source', async () => {
    const roundTrip = await editorPipeline()
    const source = '错误 $\\frac{1$ 公式\n'
    expect(roundTrip(source).trimEnd()).toBe(source.trimEnd())
    expect(protectedFragments(roundTrip(source))).toEqual(protectedFragments(source))
  })
})

describe('typing a formula', () => {
  it('only fires on text that reads as a formula', () => {
    expect('$E=mc^2$'.match(STRICT_INLINE_MATH_RULE)?.[1]).toBe('E=mc^2')
    expect('公式 $x$'.match(STRICT_INLINE_MATH_RULE)?.[1]).toBe('x')
    expect('价格 $5 和 $').toSatisfy((text: string) => !STRICT_INLINE_MATH_RULE.test(text))
    expect('\\$x$').toSatisfy((text: string) => !STRICT_INLINE_MATH_RULE.test(text))
    expect('$ x$').toSatisfy((text: string) => !STRICT_INLINE_MATH_RULE.test(text))
    expect(new RegExp(CREPE_INLINE_MATH_RULE).test('价格 $5 和 $')).toBe(true)
  })
})

describe('formulas in preview and export', () => {
  it('renders inline and display math offline', async () => {
    const { html, hasMath } = await renderExport('行内 $x^2$\n\n$$\ny\n$$\n', '公式', async () => null)
    expect(hasMath).toBe(true)
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
    expect(html).not.toContain('language-math')
    expect(renderMarkdownPreview('行内 $x^2$\n')).toContain('class="katex"')
  })

  it('leaves a price and a math code fence alone', async () => {
    const { html, hasMath } = await renderExport('价格 $5 和 $6\n\n```math\nx\n```\n', '价格', async () => null)
    expect(hasMath).toBe(false)
    expect(html).toContain('价格 $5 和 $6')
    expect(html).toContain('language-math')
  })

  it('does not run dangerous TeX commands', async () => {
    const { html } = await renderExport('$\\href{javascript:alert(1)}{x}$ 和 $\\includegraphics{https://example.com/a.png}$ 和 $\\htmlId{a}{b}$\n', '危险', async () => null)
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('https://example.com/a.png"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('id="a"')
  })

  it('shows a broken formula instead of failing', async () => {
    const { html } = await renderExport('$\\frac{1$\n', '错误', async () => null)
    expect(html).toContain('katex-error')
    expect(html).toContain('frac')
  })

  it('still strips raw HTML next to a formula', async () => {
    const { html } = await renderExport('$x$ <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n', '安全', async () => null)
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script>alert')
  })

  it('embeds fonts so a formula page needs no other file', async () => {
    const { html } = await renderExport('$x$\n', '公式', async () => null)
    const page = embedMathStyles(html)
    expect(page).toContain('font-src data:')
    expect(page).toContain('src:url(data:font/woff2;base64,')
    expect(page).not.toContain('url(fonts/')
    expect(page).not.toMatch(/url\([^)]*\.(?:woff|ttf)\)/)
    expect(html).toContain("font-src 'none'")
  })
})
