// @vitest-environment jsdom
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import type { DecorationSet } from '@milkdown/kit/prose/view'
import { describe, expect, it, vi } from 'vitest'

// Mermaid needs real layout; this stand-in records when each diagram is drawn.
const events: string[] = []
vi.mock('mermaid', () => ({ default: { initialize: () => undefined, render: async (_id: string, source: string) => { events.push(`draw ${source}`); return { svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${source}</text></svg>` } } } }))

const { numericColumnsPlugin, numericDecorations, touchesTable } = await import('../src/features/editor/numericColumns')
const { renderMermaidPreview } = await import('../src/features/diagrams/mermaid')

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    table: { group: 'block', content: 'table_row+' },
    table_row: { content: 'table_cell+' },
    table_cell: { content: 'paragraph', attrs: { alignment: { default: null } } },
    text: {},
  },
})
const text = (value: string) => value ? schema.text(value) : undefined
const paragraph = (value: string) => schema.nodes.paragraph.create(null, text(value))
const table = (rows: string[][]) => schema.nodes.table.create(null, rows.map((row) => schema.nodes.table_row.create(null, row.map((cell) => schema.nodes.table_cell.create(null, paragraph(cell))))))
const prices = () => table([['浮生六记', '156'], ['人间词话', '1,098']])
const shown = (set: DecorationSet | undefined) => set!.find().map((decoration) => [decoration.from, decoration.to])
const decorationsOf = (state: EditorState) => (numericColumnsPlugin.getState(state) as DecorationSet)
/** The position just inside the first paragraph that holds `needle`. */
function positionOf(doc: ProseNode, needle: string): number {
  let found = -1
  doc.descendants((node, position) => { if (found < 0 && node.isTextblock && node.textContent.includes(needle)) found = position + 1 })
  return found
}

describe('numeric columns while typing (T96)', () => {
  const start = () => EditorState.create({ doc: schema.nodes.doc.create(null, [paragraph('前言'), prices(), paragraph('结语')]), plugins: [numericColumnsPlugin] })

  it('moves the decorations instead of reading the tables again when the edit is outside every table', () => {
    const state = start()
    expect(shown(decorationsOf(state))).toHaveLength(2)
    for (const needle of ['前言', '结语']) {
      const tr = state.tr.insertText('多写几个字', positionOf(state.doc, needle))
      expect(touchesTable(tr), needle).toBe(false)
      const next = state.apply(tr)
      // Mapped, yet exactly what a fresh reading of the document gives.
      expect(shown(decorationsOf(next))).toEqual(shown(numericDecorations(next.doc)))
      expect(shown(decorationsOf(next))).toHaveLength(2)
    }
    // A paragraph removed, and one added, outside the table.
    const removed = state.tr.delete(0, state.doc.firstChild!.nodeSize)
    expect(touchesTable(removed)).toBe(false)
    expect(shown(decorationsOf(state.apply(removed)))).toEqual(shown(numericDecorations(removed.doc)))
    const added = state.tr.insert(state.doc.content.size, paragraph('新段落'))
    expect(touchesTable(added)).toBe(false)
  })

  it('reads the tables again when a cell changes or a table comes or goes', () => {
    const state = start()
    // A number column that gains a word is no longer a number column.
    const typed = state.tr.insertText(' 册', positionOf(state.doc, '156') + 3)
    expect(touchesTable(typed)).toBe(true)
    expect(shown(decorationsOf(state.apply(typed)))).toEqual([])
    const tableStart = state.doc.firstChild!.nodeSize
    const dropped = state.tr.delete(tableStart, tableStart + state.doc.child(1).nodeSize)
    expect(touchesTable(dropped)).toBe(true)
    expect(shown(decorationsOf(state.apply(dropped)))).toEqual([])
    const second = state.tr.insert(state.doc.content.size, table([['甲', '1'], ['乙', '2']]))
    expect(touchesTable(second)).toBe(true)
    const next = state.apply(second)
    expect(shown(decorationsOf(next))).toHaveLength(4)
    expect(shown(decorationsOf(next))).toEqual(shown(numericDecorations(next.doc)))
  })

  it('costs the same to type outside tables however many tables there are', () => {
    const many = EditorState.create({ doc: schema.nodes.doc.create(null, [paragraph('前言'), ...Array.from({ length: 300 }, () => table(Array.from({ length: 20 }, (_, row) => ['书名', String(row * 7)])))]), plugins: [numericColumnsPlugin] })
    const timed = (work: () => void) => { const started = performance.now(); for (let round = 0; round < 20; round++) work(); return (performance.now() - started) / 20 }
    const tr = many.tr.insertText('字', 1)
    const mapped = timed(() => { many.apply(many.tr.insertText('字', 1)) })
    const reread = timed(() => { numericDecorations(tr.doc) })
    console.log(`300 tables × 20 rows: one key press outside tables ${mapped.toFixed(2)} ms (was a full reading: ${reread.toFixed(2)} ms)`)
    expect(mapped).toBeLessThan(reread)
  })
})

describe('drawing several diagrams (T96)', () => {
  it('gives up the thread before each diagram and keeps their order', async () => {
    const drawn = Promise.all(['graph A', 'graph B', 'graph C'].map((source) => new Promise<void>((resolve) => { expect(renderMermaidPreview('mermaid', source, () => { events.push(`shown ${source}`); resolve() })).toBeUndefined() })))
    // A chain of timers stands for the input and scrolling waiting their turn.
    let ticks = 0
    let running = true
    const tick = () => { if (!running) return; ticks++; events.push('other work'); setTimeout(tick, 0) }
    setTimeout(tick, 0)
    await drawn
    running = false
    expect(events.filter((event) => event.startsWith('draw'))).toEqual(['draw graph A', 'draw graph B', 'draw graph C'])
    // Other work ran between the first diagram and the last, not only before or after all of them.
    const first = events.indexOf('draw graph A')
    const last = events.indexOf('draw graph C')
    expect(events.slice(first, last).filter((event) => event === 'other work').length).toBeGreaterThanOrEqual(2)
    expect(ticks).toBeGreaterThanOrEqual(2)
  })
})
