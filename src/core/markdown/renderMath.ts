import { isCodeWithClass, textOf, type HastNode } from './hast'

/** Lets the class names remark-math sets survive sanitizing. User-written `html` nodes never reach this schema. */
export function withMathClasses<T extends { attributes?: Record<string, unknown> | null }>(schema: T): T {
  return { ...schema, attributes: { ...schema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] } }
}

function isMath(node: HastNode | undefined, kind: 'math-inline' | 'math-display'): boolean {
  return isCodeWithClass(node, (name) => name === kind)
}

/** The largest size, in em, a formula may ask for with `\rule` or spacing commands; KaTeX's default has no limit. */
export const KATEX_MAX_SIZE = 50

/** Draws one formula as HTML. */
export type MathRenderer = (source: string, displayMode: boolean) => string

/**
 * KaTeX for a document that has formulas, and nothing for one that has none: it is a quarter of a megabyte that
 * the analysis worker used to parse before it could show any document at all (T98). A formula is written with
 * `$`, or as a `math` code block.
 */
export async function loadMathRenderer(markdown: string): Promise<MathRenderer | undefined> {
  if (!markdown.includes('$') && !/math/i.test(markdown)) return undefined
  const katex = (await import('katex')).default
  return (source, displayMode) => katex.renderToString(source, { displayMode, throwOnError: false, trust: false, strict: 'ignore', maxSize: KATEX_MAX_SIZE })
}

/**
 * Runs after sanitizing, so the only raw HTML in the tree is what KaTeX generates with `trust` off.
 * `draw` comes from `loadMathRenderer`; without it formulas stay as their source in a code element.
 */
export function rehypeRenderMath(draw?: MathRenderer, report?: { hasMath: boolean }) {
  function render(code: HastNode, displayMode: boolean): HastNode {
    if (report) report.hasMath = true
    return draw ? { type: 'raw', value: draw(textOf(code), displayMode) } : code
  }
  function transform(node: HastNode): void {
    if (!node.children) return
    node.children = node.children.map((child) => {
      if (child.tagName === 'pre' && child.children?.length === 1 && isMath(child.children[0], 'math-display')) return render(child.children[0], true)
      if (isMath(child, 'math-inline')) return render(child, false)
      transform(child)
      return child
    })
  }
  return (tree: unknown) => transform(tree as HastNode)
}
