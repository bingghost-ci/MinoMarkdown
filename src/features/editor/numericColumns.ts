import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { NUMERIC_CLASS, numericColumns } from '../../core/markdown/numericColumns'

/**
 * Right-aligns number columns in the editor with node decorations, so the document is never changed.
 * Cells parsed without a Markdown alignment have `alignment: null`; any explicit alignment is kept.
 */
export function numericDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((table, tablePos) => {
    // Tables can sit in quotes and lists, never inside paragraphs or headings.
    if (table.type.name !== 'table') return !table.isTextblock
    const rows: { pos: number; cells: { pos: number; node: ProseNode }[] }[] = []
    table.forEach((row, rowOffset) => {
      const rowPos = tablePos + 1 + rowOffset
      const cells: { pos: number; node: ProseNode }[] = []
      row.forEach((cell, cellOffset) => cells.push({ pos: rowPos + 1 + cellOffset, node: cell }))
      rows.push({ pos: rowPos, cells })
    })
    const body = rows.filter((row) => row.cells.some((cell) => cell.node.type.name === 'table_cell'))
    const numeric = numericColumns(body.map((row) => row.cells.map((cell) => cell.node.textContent)))
    const aligned = new Set<number>()
    for (const row of rows) row.cells.forEach((cell, column) => { if (cell.node.attrs.alignment) aligned.add(column) })
    for (const row of rows) {
      row.cells.forEach((cell, column) => {
        if (numeric[column] && !aligned.has(column)) decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { class: NUMERIC_CLASS }))
      })
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

const key = new PluginKey<DecorationSet>('mino-numeric-columns')

export const numericColumnsPlugin = new Plugin<DecorationSet>({
  key,
  state: {
    init: (_, state) => numericDecorations(state.doc),
    apply: (tr, previous) => tr.docChanged ? numericDecorations(tr.doc) : previous,
  },
  props: { decorations: (state) => key.getState(state) },
})
