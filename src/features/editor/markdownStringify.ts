import type { Options } from 'remark-stringify'
import { mathValues } from '../../core/markdown/math'
import { ALERT_MARKER } from '../../core/markdown/alerts'
import { isTocMarker } from '../../core/markdown/toc'

type Handler = NonNullable<NonNullable<Options['handlers']>['text']>
type Parent = Parameters<Handler>[1]
type InlineNode = { type: string; value?: string }

// Keyed by the block's text: the editor builds a new tree for every serialization, so a cache keyed by node
// never hit, and each block holding `$` was parsed again on every draft and save (T92).
const literalDollarsCache = new Map<string, boolean>()
const LITERAL_DOLLARS_CACHE_SIZE = 5000

/** Whether this block's `$` signs can be written as-is without a reader taking them for a formula. */
function dollarsAreLiteral(node: InlineNode, parent: Parent): boolean {
  const siblings = ((parent as { children?: InlineNode[] } | undefined)?.children ?? [node])
  const formulas = siblings.filter((item) => item.type === 'inlineMath').length
  // Real formulas become `$X$`, so any formula other than those would come from the `$` in the text.
  const probe = siblings.map((item) => item.type === 'text' ? item.value ?? '' : item.type === 'inlineMath' ? '$X$' : 'X').join('')
  // A lone `$` has nothing to pair with.
  if (formulas === 0 && probe.indexOf('$') === probe.lastIndexOf('$')) return true
  let literal = literalDollarsCache.get(probe)
  if (literal === undefined) {
    const found = mathValues(probe)
    literal = found.length === formulas && found.every((value) => value === 'X')
    if (literalDollarsCache.size >= LITERAL_DOLLARS_CACHE_SIZE) literalDollarsCache.clear()
    literalDollarsCache.set(probe, literal)
  }
  return literal
}

// Milkdown keeps trailing spaces in text by writing such a run raw, but that also skipped escaping the rest of
// the run: `\# x **b**` came back as a heading, `1\. x **b**` as a list, `\<b> **b**` as HTML, and pipes at the
// end of a table cell's text broke the table. Only the trailing whitespace is written raw now; the text before
// it is escaped as anywhere else, with the whitespace as what follows it.
export const safeTextHandler: Handler = (node, parent, state, info) => keepAlertMarker(writeText(node, parent, state, info), node, parent, state)

/**
 * An alert's `[!NOTE]` (T121) opens the first paragraph of a block quote. Escaped as `\[!NOTE]` it would be a plain
 * quote again in every reader, so there, and only there, the bracket is written as typed.
 */
function keepAlertMarker(written: string, node: Parameters<Handler>[0], parent: Parent, state: Parameters<Handler>[2]): string {
  // A paragraph that is only `[TOC]` (T133) is the contents marker; escaped, no reader would take it for one.
  if (written.startsWith('\\[') && isTocMarker(written.slice(1)) && (parent as { type?: string; children?: unknown[] } | undefined)?.type === 'paragraph' && (parent as { children: unknown[] }).children.length === 1) return written.slice(1)
  if (!written.startsWith('\\[!') || !state.stack.includes('blockquote')) return written
  if ((parent as { children?: unknown[] } | undefined)?.children?.[0] !== node) return written
  return ALERT_MARKER.test(written.slice(1)) ? written.slice(1) : written
}

const writeText: Handler = (node, parent, state, info) => {
  const value = node.value as string
  const keepDollars = value.includes('$') && dollarsAreLiteral(node, parent)
  const escape = (text: string, after: string): string => {
    const options = { ...info, after, encode: [] }
    if (!keepDollars) return state.safe(text, options)
    const unsafe = state.unsafe
    state.unsafe = unsafe.filter((pattern) => pattern.character !== '$')
    try { return state.safe(text, options) }
    finally { state.unsafe = unsafe }
  }
  // Runs with emphasis markers, backslashes or pipes, and unpaired `$`, are escaped whole as before.
  const trailing = (!value.includes('$') || keepDollars) && /^[^*_\\|]*\s+$/.test(value) ? /\s+$/.exec(value) : null
  if (!trailing) return escape(value, info.after)
  const text = value.slice(0, trailing.index)
  return (text ? escape(text, trailing[0][0]) : '') + trailing[0]
}
