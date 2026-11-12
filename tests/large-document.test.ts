import { describe, expect, it } from 'vitest'
import { HEAD_CHARS, QUICK_READ_CHARS, opensForQuickReading, previewHead, quickReadAnalysis } from '../src/features/document/largeDocument'

const section = (index: number) => `## 第 ${index} 节\n\n${'正文内容。'.repeat(120)}\n\n`
const long = (count: number) => Array.from({ length: count }, (_, index) => section(index)).join('')

describe('large documents (T77)', () => {
  it('uses quick reading only for a large document that opens in reading mode', () => {
    const large = 'x'.repeat(QUICK_READ_CHARS)
    expect(opensForQuickReading(large, true)).toBe(true)
    expect(opensForQuickReading(large, false)).toBe(false)
    expect(opensForQuickReading(large.slice(1), true)).toBe(false)
  })

  it('stands in with an analysis that keeps the source unchanged and cannot be composed as visual', () => {
    const analysis = quickReadAnalysis('---\ntitle: a\n---\n# 标题\r\n正文')
    expect(analysis.mode).toBe('source-protected')
    expect(analysis.issues).toEqual([])
  })

  it('gives no head for a document that is not long', () => {
    expect(previewHead(long(3))).toBeNull()
    expect(previewHead('')).toBeNull()
  })

  it('cuts the head before a heading, within the limit, and as a prefix of the source', () => {
    const source = long(400)
    const head = previewHead(source)!
    expect(head.length).toBeLessThanOrEqual(HEAD_CHARS)
    expect(head.length).toBeGreaterThan(HEAD_CHARS / 2)
    expect(source.startsWith(head)).toBe(true)
    expect(source.slice(head.length)).toMatch(/^## 第 \d+ 节\n/)
  })

  it('never cuts inside a code fence, even when the fence holds heading-like and blank lines', () => {
    const fenced = `# 开头\n\n段落\n\n\`\`\`\`md\n${'# 不是标题\n\n```\n内层\n```\n\n'.repeat(4000)}\`\`\`\`\n\n## 结尾\n\n${'尾'.repeat(200_000)}`
    const head = previewHead(fenced)!
    expect(head).toBe('# 开头\n\n段落\n')
    const tilde = `前言\n\n~~~\n${'# x\n\n'.repeat(30_000)}~~~\n`
    expect(previewHead(tilde)).toBe('前言\n')
  })

  it('falls back to a blank line when there is no heading, and handles CRLF', () => {
    const source = Array.from({ length: 3000 }, (_, index) => `段落 ${index} ${'字'.repeat(60)}`).join('\r\n\r\n')
    const head = previewHead(source)!
    expect(source.startsWith(head)).toBe(true)
    expect(head.endsWith('\r\n')).toBe(true)
    expect(source.slice(head.length)).toMatch(/^\r\n段落 \d+ /)
  })

  it('returns null when the whole limit is one unbroken block', () => {
    expect(previewHead('字'.repeat(300_000))).toBeNull()
    expect(previewHead(`\`\`\`\n${'code\n'.repeat(60_000)}\`\`\`\n`)).toBeNull()
  })
})
