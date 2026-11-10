import { describe, expect, it, vi } from 'vitest'
import { Editor, SchemaReady, schemaCtx, SerializerReady, serializerCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { linkPasteTransaction, MAX_PASTED_TABLE_COLUMNS, MAX_PASTED_TABLE_ROWS, parseTabularText, pastedLinkHref, tablePasteTransaction } from '../src/features/editor/smartPaste'

type Pipeline = { schema: Schema; serialize: (doc: ProseNode) => string }

async function milkdown(): Promise<Pipeline> {
  const events = new EventTarget()
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  return new Promise((resolve) => {
    const capture: MilkdownPlugin = (ctx) => async () => {
      await ctx.wait(SchemaReady)
      await ctx.wait(SerializerReady)
      resolve({ schema: ctx.get(schemaCtx), serialize: ctx.get(serializerCtx) })
    }
    void Editor.make().use(commonmark).use(gfm).use(capture).create().catch(() => undefined)
  })
}

describe('tab-separated clipboard text', () => {
  it('accepts a rectangular block with any newline style', () => {
    expect(parseTabularText('a\tb\r\n1\t2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseTabularText('a\tb\r1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps empty cells', () => {
    expect(parseTabularText('a\t\n\t2')).toEqual([['a', ''], ['', '2']])
  })

  it.each([
    ['single line', 'a\tb'],
    ['single column', 'a\nb'],
    ['irregular rows', 'a\tb\n1\t2\t3'],
    ['blank line', 'a\tb\n\n1\t2'],
    ['tab-indented code', '\tfoo\tx\n\tbar\ty'],
  ])('rejects %s', (_, text) => {
    expect(parseTabularText(text)).toBeNull()
  })

  it('rejects blocks over the limits', () => {
    expect(parseTabularText(Array.from({ length: MAX_PASTED_TABLE_ROWS + 1 }, () => 'a\tb').join('\n'))).toBeNull()
    expect(parseTabularText(`${'a\t'.repeat(MAX_PASTED_TABLE_COLUMNS)}a\n${'b\t'.repeat(MAX_PASTED_TABLE_COLUMNS)}b`)).toBeNull()
  })
})

describe('pasted links', () => {
  it.each(['https://example.com/a?b=1', '  http://example.com\n', 'mailto:a@example.com'])('accepts %j', (text) => {
    expect(pastedLinkHref(text)).toBe(text.trim())
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'example.com', 'https://a.com and more', 'https://a.com\nhttps://b.com', 'https://a\u0007.com'])('rejects %j', (text) => {
    expect(pastedLinkHref(text)).toBeNull()
  })
})

describe('applying a paste with the real schema', () => {
  it('serializes a pasted table as GFM and escapes pipes', async () => {
    const { schema, serialize } = await milkdown()
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create())
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) })
    const next = state.apply(tablePasteTransaction(state, [['name', 'a|b'], ['**x**', '']])!)
    const markdown = serialize(next.doc)
    expect(markdown).toContain('a\\|b')
    expect(markdown).toContain('\\*\\*x\\*\\*')
    expect(markdown).toMatch(/\|\s*:?-+:?\s*\|/)
  })

  it('refuses a table inside a code block or another table', async () => {
    const { schema } = await milkdown()
    const code = schema.nodes.doc.create(null, schema.nodes.code_block.create(null, schema.text('x')))
    expect(tablePasteTransaction(EditorState.create({ doc: code, selection: TextSelection.create(code, 1) }), [['a', 'b'], ['1', '2']])).toBeNull()
    const start = schema.nodes.doc.create(null, schema.nodes.paragraph.create())
    const first = EditorState.create({ doc: start, selection: TextSelection.create(start, 1) })
    const withTable = first.apply(tablePasteTransaction(first, [['a', 'b'], ['1', '2']])!).doc
    expect(tablePasteTransaction(EditorState.create({ doc: withTable, selection: TextSelection.create(withTable, 4) }), [['a', 'b'], ['1', '2']])).toBeNull()
  })

  it('links only plain selected text', async () => {
    const { schema, serialize } = await milkdown()
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('hello')))
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 6) })
    expect(serialize(state.apply(linkPasteTransaction(state, 'https://a.com')!).doc).trim()).toBe('[hello](https://a.com)')
    expect(linkPasteTransaction(EditorState.create({ doc, selection: TextSelection.create(doc, 2) }), 'https://a.com')).toBeNull()
    const code = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('x', [schema.marks.inlineCode.create()])))
    expect(linkPasteTransaction(EditorState.create({ doc: code, selection: TextSelection.create(code, 1, 2) }), 'https://a.com')).toBeNull()
    const block = schema.nodes.doc.create(null, schema.nodes.code_block.create(null, schema.text('x')))
    expect(linkPasteTransaction(EditorState.create({ doc: block, selection: TextSelection.create(block, 1, 2) }), 'https://a.com')).toBeNull()
  })
})
