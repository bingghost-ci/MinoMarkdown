import { describe, expect, it } from 'vitest'
import { composeVisualMarkdown, prepareMarkdown } from '../src/core/markdown/codec'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

describe('Markdown codec', () => {
  it('keeps BOM, CRLF, front matter, and final newline when visual text changes', () => {
    const source = '\uFEFF---\r\ntitle: 原始标题\r\n---\r\n\r\n# 标题\r\n'
    const prepared = prepareMarkdown(source)
    expect(prepared.analysis.mode).toBe('visual')
    expect(prepared.editorMarkdown).not.toContain('title: 原始标题')
    const saved = composeVisualMarkdown(prepared.analysis, '# 新标题\n')
    expect(saved).toBe('\uFEFF---\r\ntitle: 原始标题\r\n---\r\n# 新标题\r\n')
  })

  it('routes unknown HTML to source protection without changing original text', () => {
    const source = '<script>alert(1)</script>\n\n# 仍可编辑源码\n'
    const prepared = prepareMarkdown(source)
    expect(prepared.analysis.mode).toBe('source-protected')
    expect(prepared.editorMarkdown).toBe(source)
    expect(() => composeVisualMarkdown(prepared.analysis, source)).toThrow('UNSUPPORTED_SYNTAX')
  })

  it('routes documents above 5 MiB to editable source protection', () => {
    const source = 'a'.repeat(5 * 1024 * 1024 + 1)
    const prepared = prepareMarkdown(source)
    expect(prepared.analysis.mode).toBe('source-protected')
    expect(prepared.analysis.issues[0]?.code).toBe('VISUAL_SIZE_LIMIT')
    expect(prepared.editorMarkdown).toBe(source)
  })

  it('renders punctuation-ended strong text followed by Chinese without changing source on open', () => {
    const source = '**流动性螺旋（liquidity spiral）**指市场变化。\n\n`**代码）**字`\n\n\\**字面）**字'
    const prepared = prepareMarkdown(source)
    expect(prepared.analysis.mode).toBe('visual')
    expect(prepared.analysis.source).toBe(source)
    expect(prepared.editorMarkdown).toContain('**流动性螺旋（liquidity spiral）**\u2009指')
    expect(prepared.editorMarkdown).toContain('`**代码）**字`')
    expect(prepared.editorMarkdown).toContain('\\**字面）**字')
    const paragraph = unified().use(remarkParse).parse(prepared.editorMarkdown).children[0]
    expect(paragraph.type).toBe('paragraph')
    if (paragraph.type !== 'paragraph') return
    expect(paragraph.children[0].type).toBe('strong')
  })
})
