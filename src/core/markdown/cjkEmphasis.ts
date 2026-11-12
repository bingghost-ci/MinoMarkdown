import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

type PositionedNode = {
  type: string
  children?: PositionedNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

// CommonMark reads **text）**字 as literal text: punctuation before the closing
// delimiter and a letter after it make the delimiter invalid. A thin space
// makes the intended emphasis unambiguous without changing code spans/blocks.
export function normalizeAdjacentStrong(markdown: string): string {
  // The pattern is rare. Whatever matches inside a text node also matches this looser form in the whole text,
  // so a document without it needs no parse (T92).
  if (!/\*\*[^*\n]+\p{P}\*\*(?=[\p{L}\p{N}])/u.test(markdown)) return markdown
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const insertions: number[] = []
  const marker = /(?<!\\)\*\*[^*\n]+\p{P}\*\*(?=[\p{L}\p{N}])/gu

  function visit(node: PositionedNode): void {
    if (node.type === 'text') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const source = markdown.slice(start, end)
        for (const match of source.matchAll(marker)) insertions.push(start + match.index + match[0].length)
      }
    }
    for (const child of node.children ?? []) visit(child)
  }

  visit(tree)
  let result = markdown
  for (const offset of insertions.sort((a, b) => b - a)) result = result.slice(0, offset) + '\u2009' + result.slice(offset)
  return result
}
