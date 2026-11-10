import { Fragment, type MarkType, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { safeLinkHref } from './linkSafety'

export const MAX_PASTED_TABLE_ROWS = 500
export const MAX_PASTED_TABLE_COLUMNS = 30

/** Rows of a rectangular tab-separated block, or null for anything that should paste as ordinary text. */
export function parseTabularText(text: string): string[][] | null {
  const lines = text.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/)
  if (lines.length < 2 || lines.length > MAX_PASTED_TABLE_ROWS) return null
  const rows = lines.map((line) => line.split('\t'))
  const columns = rows[0].length
  if (columns < 2 || columns > MAX_PASTED_TABLE_COLUMNS || rows.some((row) => row.length !== columns)) return null
  // Tab-indented code has an empty first column and is not a spreadsheet.
  if (rows.every((row) => row[0].trim() === '')) return null
  return rows
}

/** The href when the clipboard holds exactly one absolute address with an allowed scheme. */
export function pastedLinkHref(text: string): string | null {
  const candidate = text.trim()
  return /^(?:https?:\/\/|mailto:)\S+$/i.test(candidate) ? safeLinkHref(candidate) : null
}

function buildTable(schema: Schema, rows: string[][]): ProseNode | null {
  const { table, table_header_row: headerRow, table_row: bodyRow, table_header: header, table_cell: cell, paragraph } = schema.nodes
  if (!table || !headerRow || !bodyRow || !header || !cell || !paragraph) return null
  const cells = (row: string[], type: typeof cell) => row.map((value) => type.create(null, paragraph.create(null, value ? schema.text(value) : Fragment.empty)))
  return table.create(null, rows.map((row, index) => (index === 0 ? headerRow : bodyRow).create(null, cells(row, index === 0 ? header : cell))))
}

function isCodeOrTable(state: EditorState): boolean {
  const { $from, $to } = state.selection
  for (const $position of [$from, $to]) {
    for (let depth = $position.depth; depth >= 0; depth--) {
      const type = $position.node(depth).type
      if (type.spec.code || type.name === 'table') return true
    }
  }
  return false
}

/** Replaces the selection with a table. Returns null where a table does not belong. */
export function tablePasteTransaction(state: EditorState, rows: string[][]): Transaction | null {
  if (isCodeOrTable(state)) return null
  const node = buildTable(state.schema, rows)
  return node ? closeHistory(state.tr.replaceSelectionWith(node, false)).scrollIntoView() : null
}

function hasInlineCode(state: EditorState, code: MarkType | undefined): boolean {
  const { from, to } = state.selection
  return code ? state.doc.rangeHasMark(from, to, code) : false
}

/** Links the selected text to `href`. Returns null unless the selection is plain text within one block. */
export function linkPasteTransaction(state: EditorState, href: string): Transaction | null {
  const { selection } = state
  const link = state.schema.marks.link
  if (!link || !(selection instanceof TextSelection) || selection.empty) return null
  if (!selection.$from.sameParent(selection.$to) || selection.$from.parent.type.spec.code) return null
  if (hasInlineCode(state, state.schema.marks.inlineCode)) return null
  return closeHistory(state.tr.addMark(selection.from, selection.to, link.create({ href })))
}
