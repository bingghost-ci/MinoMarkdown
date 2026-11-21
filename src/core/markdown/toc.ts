import { textOf, type Element, type Node, type Root, type Text } from './hast'

/**
 * A table of contents (T133): a paragraph that says only `[TOC]`, as Typora and others write it. The document keeps
 * that line; the preview and exports draw the list of headings in its place.
 */
export const TOC_MARKER = /^\[toc\]$/i

export function isTocMarker(text: string): boolean {
  return TOC_MARKER.test(text.trim())
}

/** Headings below this level are left out: a contents list is for finding a section, not every paragraph title. */
const DEEPEST = 4
/** The sanitizer's prefix: ids it has seen carry it, and the ones made here take it too so they cannot collide with the page's own. */
const ID_PREFIX = 'user-content-'

/**
 * Replaces each `[TOC]` paragraph with `<nav class="mino-toc">`: an empty title paragraph (its words come from
 * CSS, by the document's language) and a flat list whose items carry their level as a class. It runs after
 * sanitizing and adds only text, class names and ids it made itself. A lone first-level heading is the document's
 * title and is not listed.
 */
export function rehypeToc() {
  return (tree: Root) => {
    const slots: number[] = []
    const headings: { element: Element; level: number }[] = []
    tree.children.forEach((child, index) => {
      if (child.type !== 'element') return
      const element = child as Element
      const level = /^h([1-6])$/.exec(element.tagName)?.[1]
      if (level) { if (Number(level) <= DEEPEST) headings.push({ element, level: Number(level) }); return }
      if (element.tagName === 'p' && element.children.every((item) => item.type === 'text') && isTocMarker(textOf(element))) slots.push(index)
    })
    if (slots.length === 0) return
    const listed = headings.filter((heading) => heading.level > 1).length > 0 && headings.filter((heading) => heading.level === 1).length === 1 ? headings.filter((heading) => heading.level > 1) : headings
    const items: Node[] = listed.map(({ element, level }, index) => {
      const id = typeof element.properties?.id === 'string' && element.properties.id ? element.properties.id : `${ID_PREFIX}mino-h-${index + 1}`
      element.properties = { ...element.properties, id }
      const link: Element = { type: 'element', tagName: 'a', properties: { href: `#${id}` }, children: [{ type: 'text', value: textOf(element).trim() } as Text] }
      return { type: 'element', tagName: 'li', properties: { className: [`mino-toc-${level}`] }, children: [link] } as Element
    })
    for (const index of slots) {
      const title: Element = { type: 'element', tagName: 'p', properties: { className: ['mino-toc-title'] }, children: [] }
      const list: Element = { type: 'element', tagName: 'ul', properties: {}, children: items.map((item) => structuredClone(item)) }
      tree.children[index] = { type: 'element', tagName: 'nav', properties: { className: ['mino-toc'] }, children: [title, list] } as Element
    }
  }
}
