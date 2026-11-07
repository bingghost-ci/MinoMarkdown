import { describe, expect, it } from 'vitest'
import { composeVisualMarkdown, prepareMarkdown } from '../src/core/markdown/codec'

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
})
