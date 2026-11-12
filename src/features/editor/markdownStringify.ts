import type { Options } from 'remark-stringify'
import { mathValues } from '../../core/markdown/math'

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

// Milkdown preserves trailing spaces in text, but its shortcut also bypasses
// escaping pipes at the end of a table cell's text run.
export const safeTextHandler: Handler = (node, parent, state, info) => {
  const value = node.value as string
  const keepDollars = value.includes('$') && dollarsAreLiteral(node, parent)
  if ((!value.includes('$') || keepDollars) && /^[^*_\\|]*\s+$/.test(value)) return value
  if (!keepDollars) return state.safe(value, { ...info, encode: [] })
  const unsafe = state.unsafe
  state.unsafe = unsafe.filter((pattern) => pattern.character !== '$')
  try { return state.safe(value, { ...info, encode: [] }) }
  finally { state.unsafe = unsafe }
}
