import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

export type FindMatch = { from: number; to: number }
type FindState = { query: string; matches: FindMatch[]; index: number }
type FindMeta = { query?: string; index?: number }

function pattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
}

/** Case-insensitive matches inside each text block; inline atoms occupy one placeholder character. */
export function findInDoc(doc: ProseNode, query: string): FindMatch[] {
  if (!query) return []
  const matches: FindMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => { text += child.isText ? child.text ?? '' : '￼'.repeat(child.nodeSize) })
    for (const match of text.matchAll(pattern(query))) {
      const from = position + 1 + match.index
      matches.push({ from, to: from + match[0].length })
    }
    return false
  })
  return matches
}

/** Offsets of each match in plain text, for the source editor. */
export function findInText(text: string, query: string): FindMatch[] {
  if (!query) return []
  return Array.from(text.matchAll(pattern(query)), (match) => ({ from: match.index, to: match.index + match[0].length }))
}

export const findKey = new PluginKey<FindState>('mino-find')

export function setFind(tr: Transaction, meta: FindMeta): Transaction {
  return tr.setMeta(findKey, meta)
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', matches: [], index: 0 }),
    apply(tr, previous) {
      const meta = tr.getMeta(findKey) as FindMeta | undefined
      const query = meta?.query ?? previous.query
      const matches = meta?.query !== undefined || tr.docChanged ? findInDoc(tr.doc, query) : previous.matches
      const index = meta?.index ?? (meta?.query !== undefined ? 0 : previous.index)
      return { query, matches, index: matches.length ? Math.min(index, matches.length - 1) : 0 }
    },
  },
  props: {
    decorations(state) {
      const find = findKey.getState(state)
      if (!find?.matches.length) return null
      return DecorationSet.create(state.doc, find.matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === find.index ? 'find-match find-match-active' : 'find-match' })))
    },
  },
})
