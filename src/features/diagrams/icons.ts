import type { IconifyJSON } from '@iconify/types'
import { flowNodeName, SVG_NS } from './svg'

/**
 * Icons in diagrams (T116), drawn from the Lucide set that ships with the app, so nothing is fetched.
 * Mermaid's own icon nodes (`id@{ icon: "lucide:database" }`) read the set through `registerIconPacks`.
 * Besides those, a label may hold `:name:`, which puts the icon in the line of text: `A[:database: 保存]`.
 * Mermaid has no such thing, so the name is swapped for one private-use character before Mermaid lays the
 * diagram out, which keeps a place of one character's width, and the icon is drawn over that place afterwards.
 */
let pack: Promise<IconifyJSON> | null = null
export function loadIconPack(): Promise<IconifyJSON> {
  pack ??= import('@iconify-json/lucide/icons.json').then((module) => module.default as unknown as IconifyJSON)
  return pack
}

const TOKEN = /:([a-z][a-z0-9-]{0,40}):/g
/** The first of the private-use characters that stand for icons; the n-th icon of a diagram is `PLACE + n`. */
const PLACE = 0xe000
const MAX_ICONS = 400

/** A cheap check that spares most diagrams from loading the icon set. */
export function mayHoldIconTokens(source: string): boolean { TOKEN.lastIndex = 0; return TOKEN.test(source) }

/** The drawing of an icon, with aliases followed; `null` when the set has no such name. */
export function iconBody(icons: IconifyJSON, name: string): string | null {
  const known = Object.hasOwn(icons.icons, name) ? name : Object.hasOwn(icons.aliases ?? {}, name) ? icons.aliases![name].parent : null
  return known !== null && Object.hasOwn(icons.icons, known) ? icons.icons[known].body : null
}

/**
 * Swaps each `:name:` that names an icon for its placeholder. Anything else between colons is left as it
 * was, so `A:::class`, times and the colons of sequence messages are not touched.
 */
export function withIconPlaces(source: string, icons: IconifyJSON): { source: string; names: string[] } {
  const names: string[] = []
  const replaced = source.replace(TOKEN, (match, name: string) => {
    if (names.length >= MAX_ICONS || iconBody(icons, name) === null) return match
    names.push(name)
    return String.fromCharCode(PLACE + names.length - 1)
  })
  return { source: replaced, names }
}

/**
 * Draws the icons over their placeholders and hides the placeholder characters. The SVG must be in the
 * document: where a character sits is known only once the text is laid out. Returns how many were drawn.
 */
export function placeLabelIcons(svg: Element, names: readonly string[], icons: IconifyJSON): number {
  if (!names.length) return 0
  const document = svg.ownerDocument
  const walker = document.createTreeWalker(svg, NodeFilter.SHOW_TEXT)
  const found: { node: Text; at: number; name: string }[] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.parentElement?.closest('text')) continue
    for (let at = 0; at < node.data.length; at++) {
      const name = names[node.data.charCodeAt(at) - PLACE]
      if (name) found.push({ node, at, name })
    }
  }
  // Every place is measured before the first change, which would move the ones after it.
  const placed = found.map((item) => {
    const text = item.node.parentElement!.closest('text') as SVGGraphicsElement
    const parent = text.parentNode as SVGGraphicsElement | null
    const range = document.createRange()
    range.setStart(item.node, item.at)
    range.setEnd(item.node, item.at + 1)
    const box = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
    const matrix = typeof parent?.getScreenCTM === 'function' ? parent.getScreenCTM()?.inverse() : null
    if (!box || !matrix || !(box.width > 0 && box.height > 0)) return { ...item, text, spot: null }
    const corner = (x: number, y: number) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f })
    const from = corner(box.left, box.top), to = corner(box.right, box.bottom)
    return { ...item, text, spot: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, size: Math.min(Math.abs(to.x - from.x) * 1.3, Math.abs(to.y - from.y)) }, color: getComputedStyle(text).fill }
  })
  let drawn = 0
  // Last first, so splitting a text node leaves the earlier offsets in it right.
  for (const item of placed.reverse()) {
    const hidden = document.createElementNS(SVG_NS, 'tspan')
    hidden.setAttribute('style', 'visibility:hidden')
    const tail = item.node.splitText(item.at)
    tail.splitText(1)
    tail.replaceWith(hidden)
    hidden.append(tail)
    const body = iconBody(icons, item.name)
    if (!item.spot || body === null) continue
    const scale = item.spot.size / (icons.width ?? 24)
    const group = document.createElementNS(SVG_NS, 'g')
    group.setAttribute('class', 'mino-label-icon')
    group.setAttribute('transform', `translate(${(item.spot.x - item.spot.size / 2).toFixed(2)} ${(item.spot.y - item.spot.size / 2).toFixed(2)}) scale(${scale.toFixed(4)})`)
    // The set's own markup; its strokes take the color of the label they sit in.
    group.innerHTML = body.replace(/currentColor/g, /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,/%]+\))$/i.test(item.color ?? '') ? item.color! : '#444444')
    // Mermaid's sheet paints every `.node path`; the icon's own paint is written inline, which that cannot override.
    for (const shape of Array.from(group.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon'))) {
      const own = (name: string, fallback: string) => shape.closest(`[${name}]`)?.getAttribute(name) ?? fallback
      shape.setAttribute('style', `fill:${own('fill', 'none')};stroke:${own('stroke', 'none')};stroke-width:${own('stroke-width', '2')}px;stroke-linecap:round;stroke-linejoin:round`)
    }
    item.text.after(group)
    drawn++
  }
  return drawn
}

/** Nodes drawn as remarks beside the diagram rather than as steps of it: Mermaid's cloud, burst, bare text and brace shapes. */
const REMARK = /(^|[\s;&>|-])([\w一-鿿][\w一-鿿.-]*)@\{[^}]*\bshape\s*:\s*["']?(cloud|bang|text|brace|brace-r|braces|comment)\b/gm

/** The ids of the remark nodes of a diagram. */
export function remarkIds(source: string): Set<string> {
  const ids = new Set<string>()
  for (const match of source.matchAll(REMARK)) ids.add(match[2])
  return ids
}

/** The node of the drawn diagram with this id in the source: Mermaid names it `<diagram>-flowchart-<id>-<n>`. */
export function remarkNodes(svg: Element, ids: ReadonlySet<string>): Element[] {
  if (!ids.size) return []
  return Array.from(svg.querySelectorAll('g.node')).filter((node) => { const id = flowNodeName(node); return id !== undefined && ids.has(id) })
}

/**
 * Mermaid puts the label of a cloud or a burst beside the outline when labels are SVG text. This centers
 * each on its outline. The SVG must be in the document.
 */
export function centerRemarkLabels(svg: Element, ids: ReadonlySet<string>): void {
  for (const node of remarkNodes(svg, ids)) {
    const outline = node.querySelector<SVGGraphicsElement>(':scope > path.label-container'), label = node.querySelector<SVGGraphicsElement>(':scope > g.label')
    if (!outline || !label || typeof outline.getBBox !== 'function') continue
    const around = outline.getBBox(), inside = label.getBBox()
    if (!(around.width > 0 && inside.width > 0)) continue
    const [dx, dy] = (/translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)/.exec(outline.getAttribute('transform') ?? '') ?? ['', '0', '0']).slice(1).map(Number)
    label.setAttribute('transform', `translate(${(dx + around.x + around.width / 2 - inside.x - inside.width / 2).toFixed(2)}, ${(dy + around.y + around.height / 2 - inside.y - inside.height / 2).toFixed(2)})`)
  }
}
