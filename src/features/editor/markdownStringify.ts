import type { Options } from 'remark-stringify'
import { mathValues } from '../../core/markdown/math'

type Handler = NonNullable<NonNullable<Options['handlers']>['text']>
type Parent = Parameters<Handler>[1]
type InlineNode = { type: string; value?: string }

const literalDollarsCache = new WeakMap<object, boolean>()

/** Whether this block's `$` signs can be written as-is without a reader taking them for a formula. */
function dollarsAreLiteral(node: InlineNode, parent: Parent): boolean {
  const key = parent ?? node
  let literal = literalDollarsCache.get(key)
  if (literal === undefined) {
    const siblings = ((parent as { children?: InlineNode[] } | undefined)?.children ?? [node])
    // Real formulas become `$X$`, so any formula other than those would come from the `$` in the text.
    const found = mathValues(siblings.map((item) => item.type === 'text' ? item.value ?? '' : item.type === 'inlineMath' ? '$X$' : 'X').join(''))
    literal = found.length === siblings.filter((item) => item.type === 'inlineMath').length && found.every((value) => value === 'X')
    literalDollarsCache.set(key, literal)
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
