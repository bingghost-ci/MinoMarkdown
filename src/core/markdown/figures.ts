// Minimal HAST shapes, so this file needs no extra type package.
type Text = { type: 'text'; value: string }
type Element = { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: Node[] }
type Node = Element | Text | { type: string; children?: Node[] }
type Root = { type: 'root'; children: Node[] }
type ElementContent = Node

/**
 * Render-only image captions (T57): a paragraph holding just one image becomes a figure whose caption is
 * the image title, or its alt text when there is no title. It runs after sanitizing and adds text nodes
 * only, so no markup from the document gets through. The Markdown itself is never changed.
 */
export function rehypeFigures(options: { captions: boolean }) {
  return (tree: Root) => {
    const visit = (parent: Root | Element) => {
      parent.children = parent.children.map((child) => {
        if (child.type !== 'element') return child
        const element = child as Element
        const image = element.tagName === 'p' ? soleImage(element) : null
        if (!image) { visit(element); return element }
        const caption = String(image.properties?.title ?? '').trim() || String(image.properties?.alt ?? '').trim()
        const children: ElementContent[] = [image]
        if (options.captions && caption) children.push({ type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: caption }] })
        return { type: 'element', tagName: 'figure', properties: { className: ['mino-figure'] }, children }
      })
    }
    visit(tree)
  }
}

function soleImage(paragraph: Element): Element | null {
  const content = paragraph.children.filter((child) => !(child.type === 'text' && (child as Text).value.trim() === ''))
  const only = content[0] as Element | undefined
  return content.length === 1 && only?.type === 'element' && only.tagName === 'img' ? only : null
}
