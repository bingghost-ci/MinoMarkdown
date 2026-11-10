import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export const defaultFindOptions: FindOptions = { caseSensitive: false, wholeWord: false, regex: false }

type Captures = { matched: string; groups: (string | undefined)[]; named: Record<string, string | undefined> }
export type FindMatch = { from: number; to: number; captures?: Captures }
type FindState = { query: string; options: FindOptions; matches: FindMatch[]; index: number }
type FindMeta = { query?: string; index?: number; options?: FindOptions }

function pattern(query: string, options: FindOptions): RegExp | null {
  const flags = options.caseSensitive ? 'g' : 'gi'
  if (!options.regex) return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  // Unicode mode rejects some loose escapes people type out of habit, so it falls back to legacy mode.
  try { return new RegExp(query, `${flags}u`) }
  catch {
    try { return new RegExp(query, flags) }
    catch { return null }
  }
}

export function isFindPatternValid(query: string, options: FindOptions): boolean {
  return !query || pattern(query, options) !== null
}

// CJK text has no spaces between words, so a CJK character never counts as part of a longer word.
const wordEnd = /(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{N}_]$/u
const wordStart = /^(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{N}_]/u

/** A post-filter rather than lookbehind, which the WebKit on the oldest supported macOS lacks. */
function isWholeWord(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 2), start)
  const first = text.slice(start, start + 2)
  const last = text.slice(Math.max(start, end - 2), end)
  const after = text.slice(end, end + 2)
  return !(wordEnd.test(before) && wordStart.test(first)) && !(wordEnd.test(last) && wordStart.test(after))
}

function scan(text: string, query: string, options: FindOptions): { start: number; end: number; captures?: Captures }[] {
  const regex = pattern(query, options)
  if (!regex) return []
  const found: { start: number; end: number; captures?: Captures }[] = []
  for (const match of text.matchAll(regex)) {
    const end = match.index + match[0].length
    if (match[0].length === 0 || (options.wholeWord && !isWholeWord(text, match.index, end))) continue
    found.push(options.regex ? { start: match.index, end, captures: { matched: match[0], groups: match.slice(1), named: match.groups ?? {} } } : { start: match.index, end })
  }
  return found
}

/** Expands `$1`, `$&`, `$<name>` and `$$` as String.replace does. A literal search inserts the text unchanged. */
export function replacementFor(match: FindMatch, template: string): string {
  const captures = match.captures
  if (!captures) return template
  return template.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/g, (token, reference: string) => {
    if (reference === '$') return '$'
    if (reference === '&') return captures.matched
    if (reference.startsWith('<')) {
      const name = reference.slice(1, -1)
      return name in captures.named ? captures.named[name] ?? '' : token
    }
    const number = Number(reference)
    if (number >= 1 && number <= captures.groups.length) return captures.groups[number - 1] ?? ''
    const single = Number(reference[0])
    return reference.length === 2 && single >= 1 && single <= captures.groups.length ? `${captures.groups[single - 1] ?? ''}${reference[1]}` : token
  })
}

/** Matches inside each text block; inline atoms occupy one placeholder character. */
export function findInDoc(doc: ProseNode, query: string, options: FindOptions = defaultFindOptions): FindMatch[] {
  if (!query) return []
  const matches: FindMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => { text += child.isText ? child.text ?? '' : '￼'.repeat(child.nodeSize) })
    for (const { start, end, captures } of scan(text, query, options)) matches.push({ from: position + 1 + start, to: position + 1 + end, ...(captures ? { captures } : {}) })
    return false
  })
  return matches
}

/** Offsets of each match in plain text, for the source editor. */
export function findInText(text: string, query: string, options: FindOptions = defaultFindOptions): FindMatch[] {
  if (!query) return []
  return scan(text, query, options).map(({ start, end, captures }) => ({ from: start, to: end, ...(captures ? { captures } : {}) }))
}

export const findKey = new PluginKey<FindState>('mino-find')

export function setFind(tr: Transaction, meta: FindMeta): Transaction {
  return tr.setMeta(findKey, meta)
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', options: defaultFindOptions, matches: [], index: 0 }),
    apply(tr, previous) {
      const meta = tr.getMeta(findKey) as FindMeta | undefined
      const query = meta?.query ?? previous.query
      const options = meta?.options ?? previous.options
      const matches = meta?.query !== undefined || meta?.options || tr.docChanged ? findInDoc(tr.doc, query, options) : previous.matches
      const index = meta?.index ?? (meta?.query !== undefined ? 0 : previous.index)
      return { query, options, matches, index: matches.length ? Math.min(index, matches.length - 1) : 0 }
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
