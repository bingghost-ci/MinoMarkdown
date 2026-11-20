/**
 * Minimal HAST shapes and helpers shared by the rehype steps of the preview and the exports, so none of them
 * needs an extra type package. No dependencies: this is loaded in the analysis worker.
 */
export type Text = { type: 'text'; value: string }
export type Element = { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: Node[] }
export type Node = Element | Text | { type: string; children?: Node[] }
export type Root = { type: 'root'; children: Node[] }

/** A looser shape for steps that only look at a tag, its classes and its text. */
export type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] }

/** The text below a node: its text nodes joined, nothing else (comments have a value too and are left out). */
export function textOf(node: { type: string; value?: string; children?: readonly unknown[] }): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map((child) => textOf(child as Parameters<typeof textOf>[0])).join('')
}

/** Whether a node is a `code` element carrying a class the test accepts. */
export function isCodeWithClass(node: HastNode | undefined, accepts: (name: unknown) => boolean): boolean {
  return node?.tagName === 'code' && Array.isArray(node.properties?.className) && node.properties.className.some(accepts)
}
