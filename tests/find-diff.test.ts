import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { findInDoc, findInText } from '../src/features/editor/find'
import { lineDiff } from '../src/features/document/lineDiff'

const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' }, image: { group: 'inline', inline: true, atom: true } } })
const paragraph = (...children: Parameters<typeof schema.nodes.paragraph.create>[1][]) => schema.nodes.paragraph.create(null, children as never)

describe('find', () => {
  it('maps matches to document positions across blocks and inline atoms', () => {
    const doc = schema.nodes.doc.create(null, [paragraph(schema.text('中文 Hello')), paragraph(schema.text('a'), schema.nodes.image.create(), schema.text('hello'))])
    const matches = findInDoc(doc, 'hello')
    expect(matches).toHaveLength(2)
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe('Hello')
    expect(doc.textBetween(matches[1].from, matches[1].to)).toBe('hello')
  })

  it('treats the query as literal text', () => {
    expect(findInText('a.b axb', 'a.b')).toEqual([{ from: 0, to: 3 }])
    expect(findInText('text', '')).toEqual([])
  })
})

describe('line diff', () => {
  it('reports changed lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')?.map((line) => `${line.kind}:${line.text}`)).toEqual(['same:a', 'removed:b', 'added:x', 'same:c'])
  })

  it('refuses very large changed regions', () => {
    const large = (seed: string) => Array.from({ length: 3000 }, (_, index) => `${seed}${index}`).join('\n')
    expect(lineDiff(large('a'), large('b'))).toBeNull()
  })
})
