import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import { NodeSelection, Selection, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'

type Block = { start: number; end: number; node: ProseNode; parent: ProseNode; index: number }

const isBlockParent = (node: ProseNode) => node.type.name === 'doc' || node.type.name === 'blockquote'

/** The block the selection sits in. List items move as a unit; a table or code block moves whole. */
function currentBlock(state: EditorState): Block | null {
  const { selection } = state
  const { $from, $to } = selection
  if (selection instanceof NodeSelection && isBlockParent($from.parent)) return { start: $from.pos, end: $to.pos, node: selection.node, parent: $from.parent, index: $from.index() }
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name !== 'list_item' && !isBlockParent($from.node(depth - 1))) continue
    const end = $from.after(depth)
    return $to.pos > end ? null : { start: $from.before(depth), end, node, parent: $from.node(depth - 1), index: $from.index(depth - 1) }
  }
  return null
}

function followSelection(tr: Transaction, selection: Selection, delta: number, start: number): Transaction {
  if (selection instanceof TextSelection) return tr.setSelection(TextSelection.create(tr.doc, selection.anchor + delta, selection.head + delta))
  if (selection instanceof NodeSelection) return tr.setSelection(NodeSelection.create(tr.doc, selection.from + delta))
  return tr.setSelection(Selection.near(tr.doc.resolve(start + delta + 1)))
}

/** Swaps the current block with its neighbor. At the edge of its container the key is consumed and nothing moves. */
export function moveBlock(direction: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false
    const block = currentBlock(state)
    if (!block) return false
    const sibling = block.index + direction
    if (sibling < 0 || sibling >= block.parent.childCount) return true
    if (dispatch) {
      const neighbor = block.parent.child(sibling)
      const tr = direction < 0
        ? state.tr.replaceWith(block.start - neighbor.nodeSize, block.end, [block.node, neighbor])
        : state.tr.replaceWith(block.start, block.end + neighbor.nodeSize, [neighbor, block.node])
      dispatch(closeHistory(followSelection(tr, state.selection, direction * neighbor.nodeSize, block.start)).scrollIntoView())
    }
    return true
  }
}

/** Inserts a copy of the current block after it and moves the selection into the copy. */
export const duplicateBlock: Command = (state, dispatch, view) => {
  if (view?.composing) return false
  const block = currentBlock(state)
  if (!block) return false
  if (dispatch) dispatch(closeHistory(followSelection(state.tr.insert(block.end, block.node), state.selection, block.node.nodeSize, block.start)).scrollIntoView())
  return true
}
