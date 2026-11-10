import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

type MathTreeNode = { type: string; value?: string; children?: MathTreeNode[]; position?: { start?: { offset?: number }; end?: { offset?: number } } }

const plainMarkdown = unified().use(remarkParse).use(remarkGfm)

/** Pandoc's rule: `$` opens before non-space, closes after non-space, and a closer is never followed by a digit. */
function isInlineMathSource(source: string, start: number, end: number): boolean {
  let width = 0
  while (source[start + width] === '$') width++
  const inner = source.slice(start + width, end - width)
  return inner.length > 0 && !/^\s/.test(inner) && !/\s$/.test(inner) && !/\d/.test(source[end] ?? '')
}

function plainChildren(markdown: string): MathTreeNode[] {
  const first = (plainMarkdown.parse(markdown) as unknown as MathTreeNode).children?.[0]
  return first?.type === 'paragraph' && first.children ? first.children : [{ type: 'text', value: markdown }]
}

function demote(node: MathTreeNode, source: string): void {
  if (!node.children) return
  const next: MathTreeNode[] = []
  for (const child of node.children) {
    demote(child, source)
    const start = child.position?.start?.offset
    const end = child.position?.end?.offset
    const isPlainText = child.type === 'inlineMath' && start !== undefined && end !== undefined && !isInlineMathSource(source, start, end)
    for (const item of isPlainText ? plainChildren(source.slice(start, end)).map(({ position: _position, ...rest }) => rest) : [child]) {
      const last = next.at(-1)
      if (item.type === 'text' && last?.type === 'text') {
        last.value = (last.value ?? '') + (item.value ?? '')
        delete last.position
      } else next.push(item)
    }
  }
  node.children = next
}

/** remark-math reads `$5 and $6` as a formula; this returns such text to the document as ordinary content. */
export function remarkDemoteCurrency() {
  return (tree: Root, file: { toString(): string }) => { demote(tree as unknown as MathTreeNode, String(file)) }
}

const mathMarkdown = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDemoteCurrency)

export function parseMathTree(markdown: string): Root {
  return mathMarkdown.runSync(mathMarkdown.parse(markdown), markdown) as Root
}

/** The value of every formula `markdown` would be read as containing, in order. */
export function mathValues(markdown: string): string[] {
  const values: string[] = []
  function collect(node: MathTreeNode): void {
    if (node.type === 'inlineMath' || node.type === 'math') values.push(node.value ?? '')
    for (const child of node.children ?? []) collect(child)
  }
  collect(parseMathTree(markdown) as unknown as MathTreeNode)
  return values
}

/** Crepe's source for its `$…$` input rule, which also fires on prices. */
export const CREPE_INLINE_MATH_RULE = String.raw`(?:\$)([^$]+)(?:\$)$`
export const STRICT_INLINE_MATH_RULE = /(?<![\\$])\$(?=[^\s$])([^$]*[^\s$])\$$/
