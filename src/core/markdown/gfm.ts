import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** One parser for plain GitHub-flavored Markdown, built once: no math, no extensions of the app's own. */
export const gfmMarkdown = unified().use(remarkParse).use(remarkGfm)

/** The syntax tree of GitHub-flavored Markdown, with source positions. Parses the whole text: not for the main thread on a large document. */
export function parseGfm(markdown: string): Root {
  return gfmMarkdown.parse(markdown) as Root
}
