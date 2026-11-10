import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { cjkSpacingOffsets, textTransformTransaction, transformRun, type TextTransform } from '../src/features/editor/textTransform'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    math_inline: { group: 'inline', inline: true, atom: true },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
    link: { attrs: { href: {} } },
    inlineCode: { code: true },
  },
})
const { doc, paragraph } = schema.nodes
const strong = schema.marks.strong.create()
const code = schema.marks.inlineCode.create()
const p = (...content: ProseNode[]) => paragraph.create(null, content)
const t = (text: string, ...marks: ReturnType<typeof schema.marks.strong.create>[]) => schema.text(text, marks)

function apply(root: ProseNode, kind: TextTransform, from = 1, to = root.content.size - 1): EditorState {
  const state = EditorState.create({ doc: root, selection: TextSelection.create(root, from, to) })
  const tr = textTransformTransaction(state, kind)
  return tr ? state.apply(tr) : state
}
const space = (text: string) => {
  let out = text
  for (const offset of cjkSpacingOffsets(text).reverse()) out = `${out.slice(0, offset)} ${out.slice(offset)}`
  return out
}

describe('case transforms', () => {
  it('changes case', () => {
    expect(transformRun(['Hello 中文'], 'upper')).toEqual(['HELLO 中文'])
    expect(transformRun(['Hello'], 'lower')).toEqual(['hello'])
  })

  it('capitalizes words and keeps apostrophes inside them', () => {
    expect(transformRun(["don't STOP me-now"], 'title')).toEqual(["Don't Stop Me-Now"])
  })

  it('tracks words across marks', () => {
    expect(transformRun(['fo', 'o b', 'ar'], 'title')).toEqual(['Fo', 'o B', 'ar'])
  })
})

describe('CJK spacing', () => {
  it('adds spaces only between CJK and Latin text', () => {
    expect(space('中文English中文123')).toBe('中文 English 中文 123')
    expect(space('中文，English')).toBe('中文，English')
  })

  it('is idempotent', () => {
    const once = space('用Python写Web')
    expect(once).toBe('用 Python 写 Web')
    expect(cjkSpacingOffsets(once)).toEqual([])
  })

  it('handles characters outside the basic plane', () => {
    expect(space('𠀀A')).toBe('𠀀 A')
  })

  it('keeps a boundary space outside bold so the delimiters still parse', () => {
    const next = apply(doc.create(null, p(t('中文'), t('Bold', strong))), 'cjkSpacing').doc.child(0)
    expect(next.child(0).text).toBe('中文 ')
    expect(next.child(0).marks).toHaveLength(0)
    expect(next.child(1).text).toBe('Bold')
  })

  it('keeps a space inside bold when both sides are bold', () => {
    const next = apply(doc.create(null, p(t('中文Bold', strong))), 'cjkSpacing').doc.child(0)
    expect(next.childCount).toBe(1)
    expect(next.child(0).text).toBe('中文 Bold')
    expect(next.child(0).marks).toHaveLength(1)
  })
})

describe('punctuation', () => {
  it('converts to full width', () => {
    expect(transformRun(['你好, 世界! (测试)?'], 'fullPunct')).toEqual(['你好， 世界！ （测试）？'])
  })

  it('pairs straight double quotes', () => {
    expect(transformRun(['"a" and "b"'], 'fullPunct')).toEqual(['“a” and “b”'])
  })

  it('leaves numbers, times, addresses and ellipses alone', () => {
    const text = '3.14 1,000 12:30 example.com https://a.cn wait...'
    expect(transformRun([text], 'fullPunct')).toEqual([text])
  })

  it('converts to half width', () => {
    expect(transformRun(['你好，世界！“引用”（括号）、顿号'], 'halfPunct')).toEqual(['你好,世界!"引用"(括号),顿号'])
  })
})

describe('applying to the document', () => {
  it('changes only the selection', () => {
    expect(apply(doc.create(null, p(t('abc def'))), 'upper', 1, 4).doc.textContent).toBe('ABC def')
  })

  it('keeps marks', () => {
    const next = apply(doc.create(null, p(t('ab', strong), t('cd'))), 'upper').doc.child(0)
    expect(next.child(0).text).toBe('AB')
    expect(next.child(0).marks).toHaveLength(1)
    expect(next.child(1).text).toBe('CD')
  })

  it('does not change a link address', () => {
    const link = schema.marks.link.create({ href: 'https://a.com/Path' })
    const next = apply(doc.create(null, p(t('text', link))), 'upper').doc.child(0).child(0)
    expect(next.text).toBe('TEXT')
    expect(next.marks[0].attrs.href).toBe('https://a.com/Path')
  })

  it('skips inline code, code blocks and formulas', () => {
    const root = doc.create(null, [p(t('a'), t('code', code), schema.nodes.math_inline.create(), t('b')), schema.nodes.code_block.create(null, t('x'))])
    const next = apply(root, 'upper').doc
    expect(next.child(0).child(1).text).toBe('code')
    expect(next.child(0).child(0).text).toBe('A')
    expect(next.child(0).lastChild?.text).toBe('B')
    expect(next.child(1).textContent).toBe('x')
  })

  it('does not space across inline code or formulas', () => {
    const root = doc.create(null, p(t('中'), t('a', code), t('中')))
    expect(apply(root, 'cjkSpacing').doc.eq(root)).toBe(true)
  })

  it('keeps the selection over the transformed text', () => {
    const next = apply(doc.create(null, p(t('中文abc'))), 'cjkSpacing')
    expect(next.doc.textBetween(next.selection.from, next.selection.to)).toBe('中文 abc')
  })

  it('does nothing without a selection or a change', () => {
    const root = doc.create(null, p(t('abc')))
    expect(textTransformTransaction(EditorState.create({ doc: root, selection: TextSelection.create(root, 2) }), 'upper')).toBeNull()
    expect(textTransformTransaction(EditorState.create({ doc: root, selection: TextSelection.create(root, 1, 4) }), 'lower')).toBeNull()
  })
})
