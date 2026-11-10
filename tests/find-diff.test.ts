import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { findInDoc, findInText, isFindPatternValid, replacementFor } from '../src/features/editor/find'
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

describe('find options', () => {
  const options = { caseSensitive: false, wholeWord: false, regex: false }

  it('honors case sensitivity', () => {
    expect(findInText('Hello hello', 'hello', options)).toHaveLength(2)
    expect(findInText('Hello hello', 'hello', { ...options, caseSensitive: true })).toEqual([{ from: 6, to: 11 }])
  })

  it('matches whole Latin words only', () => {
    const wholeWord = { ...options, wholeWord: true }
    expect(findInText('cat concat cat_x cats cat.', 'cat', wholeWord).map((match) => match.from)).toEqual([0, 22])
  })

  it('does not treat CJK neighbors as part of a word', () => {
    const wholeWord = { ...options, wholeWord: true }
    expect(findInText('编辑器 API接口', 'API', wholeWord)).toEqual([{ from: 4, to: 7 }])
    expect(findInText('编辑器', '编辑', wholeWord)).toEqual([{ from: 0, to: 2 }])
  })

  it('treats a literal query literally, including its replacement', () => {
    const [match] = findInText('a.b', 'a.b', options)
    expect(replacementFor(match, '$1$&')).toBe('$1$&')
    expect(findInText('axb', 'a.b', options)).toEqual([])
  })

  it('finds and expands regular expression groups', () => {
    const regex = { ...options, regex: true }
    const [match] = findInText('2026-11', '(?<year>\\d+)-(\\d+)', regex)
    expect(match).toMatchObject({ from: 0, to: 7 })
    expect(replacementFor(match, '$2/$<year> $& $$ $9')).toBe('11/2026 2026-11 $ $9')
  })

  it('reports an invalid pattern without matching anything', () => {
    const regex = { ...options, regex: true }
    expect(isFindPatternValid('(', regex)).toBe(false)
    expect(findInText('(', '(', regex)).toEqual([])
    expect(isFindPatternValid('(', options)).toBe(true)
  })

  it('accepts loose escapes that strict Unicode mode rejects', () => {
    const regex = { ...options, regex: true }
    expect(isFindPatternValid('\\-', regex)).toBe(true)
    expect(findInText('a-b', '\\-', regex)).toHaveLength(1)
  })

  it('skips zero-length matches and terminates', () => {
    const regex = { ...options, regex: true }
    expect(findInText('aab', 'a*', regex).map((match) => [match.from, match.to])).toEqual([[0, 2]])
    expect(findInText('abc', '^', regex)).toEqual([])
    expect(findInText('中文😀', '(?:)', regex)).toEqual([])
  })

  it('applies options to document matches', () => {
    const doc = schema.nodes.doc.create(null, [paragraph(schema.text('Foo foo'))])
    expect(findInDoc(doc, 'foo', { ...options, caseSensitive: true })).toHaveLength(1)
    expect(findInDoc(doc, 'f.o', { ...options, regex: true })).toHaveLength(2)
  })
})
