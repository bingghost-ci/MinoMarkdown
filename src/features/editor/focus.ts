import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/** The class of the top-level block the caret is in (T135). */
export const FOCUS_CLASS = 'mino-focus'

/**
 * Marks the block being written in, with a decoration only. The stylesheet does the rest: in focus mode every
 * other block steps back, and a heading under the caret shows its level in the margin. One class on one node,
 * worked out from the selection, so it costs nothing as a document grows.
 */
export const focusPlugin = new Plugin({
  props: {
    decorations(state) {
      const { $head } = state.selection
      if ($head.depth < 1) return null
      const from = $head.before(1)
      return DecorationSet.create(state.doc, [Decoration.node(from, from + $head.node(1).nodeSize, { class: FOCUS_CLASS })])
    },
  },
})
