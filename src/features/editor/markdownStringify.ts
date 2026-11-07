import type { Options } from 'remark-stringify'

// Milkdown preserves trailing spaces in text, but its shortcut also bypasses
// escaping pipes at the end of a table cell's text run.
export const safeTextHandler: NonNullable<Options['handlers']>['text'] = (node, _parent, state, info) => {
  const value = node.value as string
  if (/^[^*_\\|]*\s+$/.test(value)) return value
  return state.safe(value, { ...info, encode: [] })
}
