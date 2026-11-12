import { describe, expect, it } from 'vitest'
import { composeVisualMarkdown, prepareMarkdown } from '../src/core/markdown/codec'
import { describeIssues, exceedsVisualLimit, protectedFragments, VISUAL_SIZE_LIMIT_BYTES } from '../src/core/markdown/compatibility'
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

  it('routes unknown extensions to source protection without changing original text', () => {
    const source = ':::warn\n内容\n:::\n\n# 仍可编辑源码\n'
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
    expect(prepared.editorMarkdown).toContain('**流动性螺旋（liquidity spiral）**\u2009指')
    expect(prepared.editorMarkdown).toContain('`**代码）**字`')
    expect(prepared.editorMarkdown).toContain('\\**字面）**字')
    const paragraph = unified().use(remarkParse).parse(prepared.editorMarkdown).children[0]
    expect(paragraph.type).toBe('paragraph')
    if (paragraph.type !== 'paragraph') return
    expect(paragraph.children[0].type).toBe('strong')
  })
})

describe('visual size limit', () => {
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(exceedsVisualLimit('中'.repeat(1024 * 1024))).toBe(true)
    expect(exceedsVisualLimit('a'.repeat(VISUAL_SIZE_LIMIT_BYTES))).toBe(false)
    expect(exceedsVisualLimit('a'.repeat(VISUAL_SIZE_LIMIT_BYTES + 1))).toBe(true)
  })
})

describe('partial degradation', () => {
  it('keeps documents visual for raw HTML, comments, footnotes and plain dollars', () => {
    for (const source of ['<script>alert(1)</script>\n\n# 标题\n', 'a<br>b\n', '<img src="a.png">\n\ntext\n', '<!-- note -->\n\ntext\n', 'a[^1]\n\n[^1]: b\n', '价格 $5 到 $10\n']) {
      expect(prepareMarkdown(source).analysis.mode).toBe('visual')
    }
  })

  it('still protects directives and says where in readable text', () => {
    expect(prepareMarkdown('公式 $x_1$ 结束\n').analysis.mode).toBe('visual')
    expect(prepareMarkdown('$$\na\n$$\n').analysis.mode).toBe('visual')
    const analysis = prepareMarkdown('第一行\n\n:::note\n内容\n:::\n').analysis
    expect(describeIssues(analysis)).toContain('第 3 行')
    expect(describeIssues(analysis)).not.toContain('UNKNOWN_EXTENSION')
  })

  it('records fragments that must survive the visual editor', () => {
    expect(protectedFragments('a<br>b\n\n<!-- c -->\n\nd[^1]\n\n[^1]: e\n')).toEqual(['<br>', '<!-- c -->', 'ref:1', 'def:1'])
  })
})
