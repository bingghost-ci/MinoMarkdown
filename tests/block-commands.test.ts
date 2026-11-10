import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, NodeSelection, TextSelection, type Command } from '@milkdown/kit/prose/state'
import { history, undo, undoDepth } from '@milkdown/kit/prose/history'
import { duplicateBlock, moveBlock } from '../src/features/editor/blockCommands'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*', code: true },
    blockquote: { group: 'block', content: 'block+' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    table: { group: 'block', content: 'table_row+' },
    table_row: { content: 'table_cell+' },
    table_cell: { content: 'paragraph+' },
    hr: { group: 'block' },
    text: {},
  },
})
const { doc, paragraph, code_block: code, blockquote, bullet_list: list, list_item: item, table, table_row: row, table_cell: cell, hr } = schema.nodes
const p = (text: string) => paragraph.create(null, schema.text(text))
const li = (text: string, ...rest: ProseNode[]) => item.create(null, [p(text), ...rest])
const grid = (text: string) => table.create(null, row.create(null, cell.create(null, p(text))))

function positionOf(node: ProseNode, text: string): number {
  let found = -1
  node.descendants((child, position) => { if (child.isText && child.text === text) found = position; return found < 0 })
  return found + 1
}
function stateAt(root: ProseNode, text: string): EditorState {
  return EditorState.create({ doc: root, plugins: [history()], selection: TextSelection.create(root, positionOf(root, text)) })
}
function run(state: EditorState, command: Command): { state: EditorState; handled: boolean } {
  let next = state
  const handled = command(state, (tr) => { next = next.apply(tr) })
  return { state: next, handled }
}
const texts = (root: ProseNode) => { const out: string[] = []; root.descendants((node) => { if (node.isText) out.push(node.text ?? ''); return true }); return out }
const caretText = (state: EditorState) => state.selection.$from.parent.textContent

describe('moving blocks', () => {
  it('swaps paragraphs and keeps the caret in the moved block', () => {
    const start = stateAt(doc.create(null, [p('a'), p('b'), p('c')]), 'b')
    const up = run(start, moveBlock(-1)).state
    expect(texts(up.doc)).toEqual(['b', 'a', 'c'])
    expect(caretText(up)).toBe('b')
    const down = run(start, moveBlock(1)).state
    expect(texts(down.doc)).toEqual(['a', 'c', 'b'])
    expect(caretText(down)).toBe('b')
  })

  it('consumes the key at document edges without changing anything', () => {
    const first = stateAt(doc.create(null, [p('a'), p('b')]), 'a')
    const result = run(first, moveBlock(-1))
    expect(result.handled).toBe(true)
    expect(result.state.doc.eq(first.doc)).toBe(true)
    const last = stateAt(doc.create(null, [p('a'), p('b')]), 'b')
    expect(run(last, moveBlock(1)).state.doc.eq(last.doc)).toBe(true)
  })

  it('moves a list item with its nested list and stays inside the list', () => {
    const nested = list.create(null, li('child'))
    const root = doc.create(null, [list.create(null, [li('one', nested), li('two')])])
    const moved = run(stateAt(root, 'one'), moveBlock(1)).state
    expect(texts(moved.doc)).toEqual(['two', 'one', 'child'])
    expect(moved.doc.childCount).toBe(1)
    const inner = stateAt(root, 'child')
    expect(run(inner, moveBlock(-1)).state.doc.eq(root)).toBe(true)
  })

  it('moves a table as one block when the caret is in a cell', () => {
    const moved = run(stateAt(doc.create(null, [grid('cell'), p('after')]), 'cell'), moveBlock(1)).state
    expect(moved.doc.child(1).type.name).toBe('table')
    expect(caretText(moved)).toBe('cell')
  })

  it('moves a code block', () => {
    const root = doc.create(null, [p('a'), code.create(null, schema.text('x = 1'))])
    expect(run(stateAt(root, 'x = 1'), moveBlock(-1)).state.doc.child(0).type.name).toBe('code_block')
  })

  it('stays inside a blockquote', () => {
    const root = doc.create(null, [p('out'), blockquote.create(null, [p('q1'), p('q2')])])
    const moved = run(stateAt(root, 'q2'), moveBlock(-1)).state
    expect(texts(moved.doc)).toEqual(['out', 'q2', 'q1'])
    expect(moved.doc.child(1).type.name).toBe('blockquote')
  })

  it('moves a selected atom block and keeps it selected', () => {
    const root = doc.create(null, [p('a'), hr.create()])
    const state = EditorState.create({ doc: root, selection: NodeSelection.create(root, 3) })
    const moved = run(state, moveBlock(-1)).state
    expect(moved.doc.child(0).type.name).toBe('hr')
    expect(moved.selection).toBeInstanceOf(NodeSelection)
    expect(moved.selection.from).toBe(0)
  })

  it('ignores a selection that spans several blocks', () => {
    const root = doc.create(null, [p('a'), p('b'), p('c')])
    const state = EditorState.create({ doc: root, selection: TextSelection.create(root, 1, positionOf(root, 'b') + 1) })
    expect(run(state, moveBlock(1)).handled).toBe(false)
  })

  it('makes every move its own undo step', () => {
    let state = stateAt(doc.create(null, [p('a'), p('b'), p('c')]), 'c')
    state = run(state, moveBlock(-1)).state
    state = run(state, moveBlock(-1)).state
    expect(texts(state.doc)).toEqual(['c', 'a', 'b'])
    expect(undoDepth(state)).toBe(2)
    state = run(state, undo).state
    expect(texts(state.doc)).toEqual(['a', 'c', 'b'])
  })
})

describe('duplicating blocks', () => {
  it('copies the block after itself and selects the copy', () => {
    const root = doc.create(null, [p('a'), p('b')])
    const next = run(stateAt(root, 'a'), duplicateBlock).state
    expect(texts(next.doc)).toEqual(['a', 'a', 'b'])
    expect(next.selection.$from.index(0)).toBe(1)
  })

  it('copies a list item inside its list', () => {
    const root = doc.create(null, [list.create(null, [li('one')])])
    const next = run(stateAt(root, 'one'), duplicateBlock).state
    expect(next.doc.child(0).childCount).toBe(2)
  })

  it('copies a table once', () => {
    const next = run(stateAt(doc.create(null, [grid('cell')]), 'cell'), duplicateBlock).state
    expect(next.doc.childCount).toBe(2)
    expect(next.doc.child(1).type.name).toBe('table')
  })
})
