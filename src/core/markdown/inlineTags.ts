/**
 * A few inline HTML tags that only mark a run of text (T125): `<kbd>`, `<mark>`, `<sub>`, `<sup>`. Raw HTML stays
 * out of the preview and of exports; these are let through as elements only when written bare (no attributes)
 * and closed in the same paragraph, so nothing but the tag name comes from the document.
 */
export const inlineTags = ['kbd', 'mark', 'sub', 'sup'] as const

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hName?: string } }

const OPEN = new RegExp(`^<(${inlineTags.join('|')})>$`)

export function remarkInlineTags() {
  return (tree: MdNode) => {
    const visit = (parent: MdNode) => {
      const children = parent.children
      if (!children) return
      for (let index = 0; index < children.length; index++) {
        const open = children[index]
        const tag = open.type === 'html' ? OPEN.exec(open.value ?? '')?.[1] : undefined
        if (!tag) continue
        const close = children.findIndex((child, at) => at > index && child.type === 'html' && child.value === `</${tag}>`)
        if (close < 0) continue
        const inner = children.slice(index + 1, close)
        // Block content between the tags would not be a run of text; such a pair is left as raw HTML.
        if (inner.some((child) => child.type === 'html')) continue
        children.splice(index, close - index + 1, { type: 'minoInlineTag', data: { hName: tag }, children: inner })
      }
      for (const child of children) visit(child)
    }
    visit(tree)
  }
}

/** A sanitizer schema that also keeps `mark`; the other tags are in the default schema already. */
export function withInlineTags<T extends { tagNames?: readonly string[] | null }>(schema: T): T {
  return { ...schema, tagNames: [...(schema.tagNames ?? []), 'mark'] }
}
