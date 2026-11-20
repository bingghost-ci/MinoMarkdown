/** Small SVG helpers shared by the code that finishes a diagram in the document. No dependencies. */

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** A new element in the document of `owner`, with its attributes set; the caller places it. */
export function make(owner: Element, tag: string, attributes: Record<string, string | number> = {}): Element {
  const element = owner.ownerDocument.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  return element
}
