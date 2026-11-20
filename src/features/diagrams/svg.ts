/** Small SVG helpers shared by the code that finishes a diagram in the document. No dependencies. */

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** A new element in the document of `owner`, with its attributes set; the caller places it. */
export function make(owner: Element, tag: string, attributes: Record<string, string | number> = {}): Element {
  const element = owner.ownerDocument.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  return element
}

/** The markers of a diagram by id; `querySelector` cannot be trusted with the dots in Mermaid's ids. */
export const markerById = (svg: Element, id: string) => Array.from(svg.querySelectorAll('marker')).find((marker) => marker.getAttribute('id') === id)

/**
 * Gives an edge arrowheads of its own. Mermaid shares one marker between all edges, so changing it would change
 * them all: each marker the edge uses is copied under `<id><suffix>` (once per suffix) and the edge pointed at
 * the copy. `paint` dresses a copy when it is made, before it enters the document.
 */
export function ownMarkers(svg: Element, edge: Element, suffix: string, paint?: (copy: Element, original: Element) => void): void {
  for (const name of ['marker-start', 'marker-end']) {
    const id = /#([^)"']+)/.exec(edge.getAttribute(name) ?? '')?.[1]
    const original = id ? markerById(svg, id) : undefined
    if (!id || !original) continue
    const copyId = `${id}${suffix}`
    if (!markerById(svg, copyId)) {
      const copy = original.cloneNode(true) as Element
      copy.setAttribute('id', copyId)
      paint?.(copy, original)
      original.after(copy)
    }
    edge.setAttribute(name, `url(#${copyId})`)
  }
}

/** The name the author gave a flowchart node, out of the id Mermaid builds from it. */
export const flowNodeName = (node: Element) => /flowchart-(.+)-\d+$/.exec(node.getAttribute('id') ?? '')?.[1]

/** The two node names an edge joins, as `from_to`, out of the id Mermaid builds from them. */
export const edgeEnds = (edge: Element) => /(?:^|[-_])L_(.+)_\d+$/.exec(edge.getAttribute('id') ?? '')?.[1]

