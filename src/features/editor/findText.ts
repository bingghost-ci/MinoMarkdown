/** Matching in plain text. Nothing here depends on the editor, so the app shell can use it without loading ProseMirror (T94). */

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export const defaultFindOptions: FindOptions = { caseSensitive: false, wholeWord: false, regex: false }

type Captures = { matched: string; groups: (string | undefined)[]; named: Record<string, string | undefined> }
export type FindMatch = { from: number; to: number; captures?: Captures }

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

/** Offsets of each match in `text`, at most `limit` of them. */
export function findInText(text: string, query: string, options: FindOptions = defaultFindOptions, limit = Infinity): FindMatch[] {
  const regex = query ? pattern(query, options) : null
  if (!regex) return []
  const found: FindMatch[] = []
  for (const match of text.matchAll(regex)) {
    if (found.length >= limit) break
    const end = match.index + match[0].length
    if (match[0].length === 0 || (options.wholeWord && !isWholeWord(text, match.index, end))) continue
    found.push(options.regex ? { from: match.index, to: end, captures: { matched: match[0], groups: match.slice(1), named: match.groups ?? {} } } : { from: match.index, to: end })
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
