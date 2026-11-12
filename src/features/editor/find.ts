import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { defaultFindOptions, findInText, type FindMatch, type FindOptions } from './findText'

/**
 * Matches highlighted at once. A one-character query matches tens of thousands of places in a long document,
 * and drawing them all rewraps nearly every text node. All matches are still counted, stepped through and
 * replaced; only the ones around the current match are drawn (T94).
 */
export const FIND_DECORATION_LIMIT = 2000

type FindState = { query: string; options: FindOptions; matches: FindMatch[]; index: number; /** The first highlighted match. */ first: number; decorations: DecorationSet }
type FindMeta = { query?: string; index?: number; options?: FindOptions }

/** Matches inside each text block; inline atoms occupy one placeholder character. */
export function findInDoc(doc: ProseNode, query: string, options: FindOptions = defaultFindOptions): FindMatch[] {
  if (!query) return []
  const matches: FindMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => { text += child.isText ? child.text ?? '' : '￼'.repeat(child.nodeSize) })
    for (const { from, to, captures } of findInText(text, query, options)) matches.push({ from: position + 1 + from, to: position + 1 + to, ...(captures ? { captures } : {}) })
    return false
  })
  return matches
}

export const findKey = new PluginKey<FindState>('mino-find')

export function setFind(tr: Transaction, meta: FindMeta): Transaction {
  return tr.setMeta(findKey, meta)
}

/** The highlighted window stays put while the current match is inside it, so stepping redraws two matches, not two thousand. */
function firstHighlighted(index: number, total: number, previous: number): number {
  if (total <= FIND_DECORATION_LIMIT) return 0
  if (index >= previous && index < previous + FIND_DECORATION_LIMIT && previous + FIND_DECORATION_LIMIT <= total) return previous
  return Math.max(0, Math.min(total - FIND_DECORATION_LIMIT, index - FIND_DECORATION_LIMIT / 2))
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', options: defaultFindOptions, matches: [], index: 0, first: 0, decorations: DecorationSet.empty }),
    apply(tr, previous) {
      const meta = tr.getMeta(findKey) as FindMeta | undefined
      const rescan = meta?.query !== undefined || meta?.options !== undefined || tr.docChanged
      // Caret moves and other plugins' transactions leave the search, and so its highlights, as they are.
      if (!rescan && meta?.index === undefined) return previous
      const query = meta?.query ?? previous.query
      const options = meta?.options ?? previous.options
      const matches = rescan ? findInDoc(tr.doc, query, options) : previous.matches
      const wanted = meta?.index ?? (meta?.query !== undefined ? 0 : previous.index)
      const index = matches.length ? Math.min(wanted, matches.length - 1) : 0
      if (!rescan && index === previous.index) return previous
      const first = firstHighlighted(index, matches.length, rescan ? 0 : previous.first)
      const decorations = matches.length ? DecorationSet.create(tr.doc, matches.slice(first, first + FIND_DECORATION_LIMIT).map((match, offset) => Decoration.inline(match.from, match.to, { class: first + offset === index ? 'find-match find-match-active' : 'find-match' }))) : DecorationSet.empty
      return { query, options, matches, index, first, decorations }
    },
  },
  props: {
    decorations(state) { return findKey.getState(state)?.decorations ?? null },
  },
})
