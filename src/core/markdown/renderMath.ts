import katex from 'katex'

type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] }

/** Lets the class names remark-math sets survive sanitizing. User-written `html` nodes never reach this schema. */
export function withMathClasses<T extends { attributes?: Record<string, unknown> | null }>(schema: T): T {
  return { ...schema, attributes: { ...schema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] } }
}

function isMath(node: HastNode | undefined, kind: 'math-inline' | 'math-display'): boolean {
  return node?.tagName === 'code' && Array.isArray(node.properties?.className) && node.properties.className.includes(kind)
}

function textOf(node: HastNode): string { return node.value ?? (node.children ?? []).map(textOf).join('') }

/** Runs after sanitizing, so the only raw HTML in the tree is what KaTeX generates with `trust` off. */
export function rehypeRenderMath(report?: { hasMath: boolean }) {
  function render(code: HastNode, displayMode: boolean): HastNode {
    if (report) report.hasMath = true
    return { type: 'raw', value: katex.renderToString(textOf(code), { displayMode, throwOnError: false, trust: false, strict: 'ignore' }) }
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
