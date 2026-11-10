import { parseMathTree } from './math'

type TreeNode = { type: string; lang?: string | null; value?: string; children?: TreeNode[] }
type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] }

/** A cheap check that spares documents without diagrams from any parsing. */
export function mayContainMermaid(markdown: string): boolean { return /(?:`{3,}|~{3,})[ \t]*mermaid/i.test(markdown) }

export function mermaidSources(markdown: string): string[] {
  const sources = new Set<string>()
  function collect(node: TreeNode): void {
    if (node.type === 'code' && node.lang?.toLowerCase() === 'mermaid' && node.value?.trim()) sources.add(node.value)
    for (const child of node.children ?? []) collect(child)
  }
  collect(parseMathTree(markdown) as unknown as TreeNode)
  return [...sources]
}

function textOf(node: HastNode): string { return node.value ?? (node.children ?? []).map(textOf).join('') }

function isMermaid(node: HastNode | undefined): boolean {
  return node?.tagName === 'code' && Array.isArray(node.properties?.className) && node.properties.className.some((name) => String(name).toLowerCase() === 'language-mermaid')
}

/** Runs after sanitizing. `diagrams` holds SVG that has already been sanitized; a fence without one stays as code. */
export function rehypeEmbedDiagrams(options: { diagrams: ReadonlyMap<string, string>; report: { failedDiagrams: number } }) {
  function transform(node: HastNode): void {
    if (!node.children) return
    node.children = node.children.map((child) => {
      if (child.tagName === 'pre' && child.children?.length === 1 && isMermaid(child.children[0])) {
        const svg = options.diagrams.get(textOf(child.children[0]).replace(/\n$/, ''))
        if (svg) return { type: 'raw', value: `<figure class="mermaid-diagram">${svg}</figure>` }
        options.report.failedDiagrams++
        return child
      }
      transform(child)
      return child
    })
  }
  return (tree: unknown) => transform(tree as HastNode)
}
