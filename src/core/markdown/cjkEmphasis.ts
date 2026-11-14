import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

type PositionedNode = {
  type: string
  children?: PositionedNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

/**
 * What the editor sees after such a `**`: a thin space, which makes the delimiter a valid closer, then a word
 * joiner, which marks the pair as the app's own so `composeVisualMarkdown` removes it again. A thin space the
 * user typed has no word joiner after it and is kept.
 */
export const STRONG_SPACER = '\u2009\u2060'

// CommonMark reads **text）**字 as literal text: punctuation before the closing
// delimiter and a letter after it make the delimiter invalid. The spacer
// makes the intended emphasis unambiguous without changing code spans/blocks.
export function normalizeAdjacentStrong(markdown: string): string {
  // The pattern is rare. Whatever matches inside a text node also matches this looser form in the whole text,
  // so a document without it needs no parse (T92).
  if (!/\*\*[^*\n]+\p{P}\*\*(?=[\p{L}\p{N}])/u.test(markdown)) return markdown
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const insertions: number[] = []
  const marker = /\*\*[^*\n]+\p{P}\*\*(?=[\p{L}\p{N}])/gu

  function visit(node: PositionedNode): void {
    if (node.type === 'text') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const source = markdown.slice(start, end)
        // An escaped opening `\**` is no delimiter; the check before the match stands in for a lookbehind,
        // which the WebKit of macOS 12 cannot parse.
        marker.lastIndex = 0
        for (let match = marker.exec(source); match; match = marker.exec(source)) {
          if (source[match.index - 1] === '\\') { marker.lastIndex = match.index + 1; continue }
          insertions.push(start + match.index + match[0].length)
        }
      }
    }
    for (const child of node.children ?? []) visit(child)
  }

  visit(tree)
  let result = markdown
  for (const offset of insertions.sort((a, b) => b - a)) result = result.slice(0, offset) + STRONG_SPACER + result.slice(offset)
  return result
}

/** Takes out the spacers `normalizeAdjacentStrong` put in, so the file keeps the text it had. */
export function removeStrongSpacers(markdown: string): string {
  return markdown.includes(STRONG_SPACER) ? markdown.split(STRONG_SPACER).join('') : markdown
}
