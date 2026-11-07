import { describe, expect, it } from 'vitest'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { safeTextHandler } from '../src/features/editor/markdownStringify'

describe('table Markdown serialization', () => {
  it('keeps a trailing-space text run with a pipe inside one cell', () => {
    const tree = {
      type: 'root',
      children: [{
        type: 'table', align: [null, null], children: [
          { type: 'tableRow', children: [
            { type: 'tableCell', children: [{ type: 'text', value: '名称' }] },
            { type: 'tableCell', children: [{ type: 'text', value: '值' }] },
          ] },
          { type: 'tableRow', children: [
            { type: 'tableCell', children: [{ type: 'text', value: '中文' }] },
            { type: 'tableCell', children: [{ type: 'text', value: 'A|B 与 ' }, { type: 'strong', children: [{ type: 'text', value: '粗体' }] }] },
          ] },
        ],
      }],
    }
    const markdown = unified().use(remarkGfm).use(remarkStringify, { handlers: { text: safeTextHandler }, encode: [] }).stringify(tree as never)
    expect(markdown).toContain('A\\|B 与 **粗体**')
    const parsed = unified().use(remarkParse).use(remarkGfm).parse(markdown)
    const table = parsed.children[0]
    expect(table.type).toBe('table')
    if (table.type !== 'table') throw new Error('table was lost')
    expect(table.children[1].children).toHaveLength(2)
  })
})
