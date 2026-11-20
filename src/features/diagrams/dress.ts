import { fitColor, type DiagramTone } from './looks'
import { fromHsl, mix, toHsl } from '../reading/color'
import { colorHex, straightPoints } from './sketch'
import { make } from './svg'

/**
 * Finishes the looks Mermaid's variables and CSS cannot reach (T117). Like the sketch pass, these work on the
 * drawn diagram while it is in the document, where shapes can be measured.
 *
 * - `layBoard` puts a board under the whole diagram: a sheet for the cards, squared paper for the pen, a
 *   blackboard for chalk, a screen with a grid for the console.
 * - `dressCards` makes a technical document's architecture diagram: group frames with their titles at the top
 *   left, edges that carry a label in the accent color, chips for the shapes that are not plain boxes, and
 *   dark blocks for what is marked `dark`.
 * - `dressConsole` makes a ship's console: panels with cut corners, brackets on the frames, a dot where each
 *   data line starts.
 */
const BOARD_MARGIN = 20
const number = (value: number) => Number(value.toFixed(2))
const inlineStyle = (element: Element, css: string) => element.setAttribute('style', `${element.getAttribute('style') ?? ''};${css}`.replace(/^;+/, ''))
const ownShapes = (group: Element, kind: string) => Array.from(group.querySelectorAll<SVGGraphicsElement>('rect, polygon, circle, ellipse, path')).filter((shape) => shape.closest(kind) === group && !shape.closest('g.label, g.cluster-label, marker, defs, .mino-label-icon, svg svg'))
const bbox = (element: Element): DOMRect | null => typeof (element as SVGGraphicsElement).getBBox === 'function' ? (element as SVGGraphicsElement).getBBox() : null

/** Widens the diagram's box and lays the board in it. Call it last: the other passes measure the diagram as Mermaid drew it. */
export function layBoard(svg: Element, tone: DiagramTone, ruling = 0, screen = false): void {
  if (!tone.panel) return
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (box.length !== 4 || !box.every(Number.isFinite)) return
  const [x, y, width, height] = [box[0] - BOARD_MARGIN, box[1] - BOARD_MARGIN, box[2] + BOARD_MARGIN * 2, box[3] + BOARD_MARGIN * 2]
  svg.setAttribute('viewBox', `${number(x)} ${number(y)} ${number(width)} ${number(height)}`)
  // Mermaid caps the width at the diagram's own; the board is part of the diagram now.
  const style = svg.getAttribute('style') ?? ''
  const cap = /max-width:\s*([\d.]+)px/.exec(style)
  if (cap) svg.setAttribute('style', style.replace(cap[0], `max-width: ${number(parseFloat(cap[1]) + BOARD_MARGIN * 2)}px`))
  const board = make(svg, 'g', { class: 'mino-board' })
  board.append(make(svg, 'rect', { x: number(x), y: number(y), width: number(width), height: number(height), rx: 14, style: `fill:${tone.panel};stroke:${mix(tone.panel, tone.text, 0.1)};stroke-width:1px` }))
  if (screen) {
    // A lit screen: brighter toward the top middle, a heavier line every fifth, and the marks of an instrument round the edge.
    const id = `${(svg.getAttribute('id') ?? 'mino').replace(/[^\w-]/g, '')}-screen`
    const defs = make(svg, 'defs', {})
    defs.innerHTML = `<radialGradient id="${id}" cx="50%" cy="0%" r="95%"><stop offset="0" stop-color="${mix(tone.panel, tone.accent, 0.2)}"/><stop offset="0.55" stop-color="${tone.panel}"/><stop offset="1" stop-color="${mix(tone.panel, '#000000', 0.45)}"/></radialGradient>`
    board.append(defs)
    board.querySelector('rect')!.setAttribute('style', `fill:url(#${id});stroke:${mix(tone.panel, tone.accent, 0.35)};stroke-width:1px`)
    const step = ruling * 5, inset = 7
    let heavy = ''
    for (let at = x + step; at < x + width - inset; at += step) heavy += `M${number(at)} ${number(y + inset)}V${number(y + height - inset)}`
    for (let at = y + step; at < y + height - inset; at += step) heavy += `M${number(x + inset)} ${number(at)}H${number(x + width - inset)}`
    if (heavy) board.append(make(svg, 'path', { d: heavy, style: `fill:none;stroke:${mix(tone.panel, tone.accent, 0.2)};stroke-width:1px` }))
    const arm = 22, pad = 9, [l, t, r, b] = [x + pad, y + pad, x + width - pad, y + height - pad]
    let marks = `M${number(l)} ${number(t + arm)}V${number(t)}H${number(l + arm)}M${number(r - arm)} ${number(t)}H${number(r)}V${number(t + arm)}M${number(r)} ${number(b - arm)}V${number(b)}H${number(r - arm)}M${number(l + arm)} ${number(b)}H${number(l)}V${number(b - arm)}`
    for (let at = l + arm + 14, index = 0; at < r - arm - 10 && index < 400; at += 12, index++) marks += `M${number(at)} ${number(b)}v${index % 5 === 0 ? -6 : -3}`
    board.append(make(svg, 'path', { d: marks, style: `fill:none;stroke:${tone.accent};stroke-width:1.4px;opacity:0.75` }))
  }
  if (tone.grid && ruling > 0) {
    // The ruling stops short of the edge, so it never shows past the board's round corners.
    const inset = 7
    let d = ''
    for (let at = x + ruling; at < x + width - inset; at += ruling) d += `M${number(at)} ${number(y + inset)}V${number(y + height - inset)}`
    for (let at = y + ruling; at < y + height - inset; at += ruling) d += `M${number(x + inset)} ${number(at)}H${number(x + width - inset)}`
    if (d.length < 60_000) board.append(make(svg, 'path', { d, style: `fill:none;stroke:${tone.grid};stroke-width:0.8px` }))
  }
  svg.prepend(board)
}

/** The markers of this diagram by id; `querySelector` cannot be trusted with the dots in Mermaid's ids. */
const markerById = (svg: Element, id: string) => Array.from(svg.querySelectorAll('marker')).find((marker) => marker.getAttribute('id') === id)

/** Draws one edge in a color of its own. Arrowheads are shared between edges, so the edge gets a copy of each of its own. */
export function recolorEdge(svg: Element, edge: Element, color: string, width?: number): void {
  inlineStyle(edge, `stroke:${color}!important${width ? `;stroke-width:${width}px!important` : ''}`)
  const tag = color.replace(/[^0-9a-z]/gi, '')
  for (const name of ['marker-start', 'marker-end']) {
    const id = /#([^)"']+)/.exec(edge.getAttribute(name) ?? '')?.[1]
    const original = id ? markerById(svg, id) : undefined
    if (!id || !original) continue
    const copyId = `${id}-c${tag}`
    if (!markerById(svg, copyId)) {
      const copy = original.cloneNode(true) as Element
      copy.setAttribute('id', copyId)
      for (const shape of Array.from(copy.querySelectorAll('path, polygon, circle'))) inlineStyle(shape, `${colorHex(getComputedStyle(original.querySelector('path, polygon, circle') ?? original).fill) ? `fill:${color}!important;` : ''}stroke:${color}!important`)
      original.after(copy)
    }
    edge.setAttribute(name, `url(#${copyId})`)
  }
}

/** The path of an edge and the group of its label, paired by the id Mermaid gives both. */
function labelledEdges(svg: Element): { edge: Element; label: Element }[] {
  const edges = Array.from(svg.querySelectorAll('path.flowchart-link, path.transition, path.relation'))
  return Array.from(svg.querySelectorAll('g.edgeLabel g.label[data-id]')).flatMap((label) => {
    if (!label.textContent?.trim()) return []
    const id = label.getAttribute('data-id')!
    const edge = edges.find((candidate) => candidate.getAttribute('data-id') === id || candidate.getAttribute('id') === id || candidate.getAttribute('id')?.endsWith(`-${id}`))
    return edge ? [{ edge, label }] : []
  })
}

/** The rows of a label and everything in them: Mermaid sets weights on the inner pieces, so a row's style has to reach those. */
function styleRow(row: Element, css: string): void { for (const piece of [row, ...Array.from(row.querySelectorAll('tspan'))]) inlineStyle(piece, css) }

/** Moves each group's title to its top left corner, in bold; the lines under the first are set smaller, as a caption. */
function titleFrames(svg: Element, title: string, caption: string, pad = 14): void {
  for (const cluster of Array.from(svg.querySelectorAll('g.cluster'))) {
    const frame = cluster.querySelector<SVGGraphicsElement>(':scope > rect'), label = cluster.querySelector<SVGGraphicsElement>(':scope > g.cluster-label')
    if (!frame || !label) continue
    const rows = Array.from(label.querySelectorAll<SVGTSpanElement>('tspan.text-outer-tspan'))
    rows.forEach((row, index) => styleRow(row, index === 0 ? `font-weight:700!important;fill:${title}!important` : `font-size:12px;font-weight:400!important;fill:${caption}!important`))
    // Mermaid keeps room for one line above a group's contents, so the caption goes after the title on that
    // line, when the frame is wide enough for both.
    const room = bbox(frame)?.width ?? 0
    const lengths = rows.map((row) => typeof row.getComputedTextLength === 'function' ? row.getComputedTextLength() : 0)
    let at = lengths[0] ?? 0
    rows.slice(1).forEach((row, index) => {
      const fits = at + 10 + lengths[index + 1] + pad * 2 <= room
      if (fits) { row.setAttribute('x', String(number(at + 10))); row.setAttribute('y', rows[0].getAttribute('y') ?? '0'); row.setAttribute('dy', rows[0].getAttribute('dy') ?? '0'); at += 10 + lengths[index + 1] } else row.setAttribute('visibility', 'hidden')
    })
    const around = bbox(frame), inside = bbox(label)
    if (!around || !inside || !(inside.width > 0)) continue
    label.setAttribute('transform', `translate(${number(around.x + pad - inside.x)}, ${number(around.y + pad * 0.7 - inside.y)})`)
  }
}

/**
 * Rounds the corners of an edge made of straight pieces. Edges with curves in them are left as they are, and
 * the first and last points stay put, so arrowheads still meet their nodes.
 */
export function roundCorners(d: string, radius: number, chamfer = false): string {
  const turns = straightPoints(d)
  if (!turns || turns.length < 3) return d
  let path = `M${number(turns[0][0])} ${number(turns[0][1])}`
  for (let index = 1; index < turns.length - 1; index++) {
    const [before, corner, after] = [turns[index - 1], turns[index], turns[index + 1]]
    const into = Math.hypot(corner[0] - before[0], corner[1] - before[1]), out = Math.hypot(after[0] - corner[0], after[1] - corner[1])
    const r = Math.min(radius, into / 2, out / 2)
    const from = [corner[0] - ((corner[0] - before[0]) / into) * r, corner[1] - ((corner[1] - before[1]) / into) * r]
    const to = [corner[0] + ((after[0] - corner[0]) / out) * r, corner[1] + ((after[1] - corner[1]) / out) * r]
    path += chamfer ? `L${number(from[0])} ${number(from[1])}L${number(to[0])} ${number(to[1])}` : `L${number(from[0])} ${number(from[1])}Q${number(corner[0])} ${number(corner[1])} ${number(to[0])} ${number(to[1])}`
  }
  const end = turns[turns.length - 1]
  return `${path}L${number(end[0])} ${number(end[1])}`
}

const isPill = (shape: Element) => shape.tagName.toLowerCase() === 'rect' && parseFloat(shape.getAttribute('rx') ?? '0') >= parseFloat(shape.getAttribute('height') ?? '0') / 2 - 1 && parseFloat(shape.getAttribute('height') ?? '0') > 0

export function dressCards(svg: Element, tone: DiagramTone): void {
  titleFrames(svg, tone.text, tone.muted)
  const accentText = fitColor(tone.accent, tone.ground, 4.5)
  const chip = mix(tone.ground, tone.accent, tone.dark ? 0.16 : 0.07)
  // What is marked `dark` becomes the block the eye goes to first: near black with the accent around it.
  const block = tone.dark ? mix(tone.ground, '#000000', 0.55) : mix(tone.text, '#000000', 0.25)
  const blockText = '#f4f2ee', inner = mix(block, '#ffffff', 0.07), innerLine = mix(block, '#ffffff', 0.16)
  const darkFrames = Array.from(svg.querySelectorAll('g.cluster.dark')).flatMap((cluster) => {
    const frame = cluster.querySelector<SVGGraphicsElement>(':scope > rect'), around = frame ? bbox(frame) : null
    if (!frame || !around) return []
    inlineStyle(frame, `fill:${block}!important;stroke:${tone.accent}!important;stroke-width:1.8px!important;stroke-dasharray:none!important`)
    Array.from(cluster.querySelectorAll('g.cluster-label tspan.text-outer-tspan')).forEach((row, index) => styleRow(row, `fill:${index > 0 ? mix(blockText, block, 0.4) : blockText}!important`))
    // Nested groups are drawn in coordinates of their own, so what lies on the block is settled on the screen.
    return typeof frame.getBoundingClientRect === 'function' ? [frame.getBoundingClientRect()] : []
  })
  const within = (element: Element) => { const box = element.getBoundingClientRect(); const x = box.left + box.width / 2, y = box.top + box.height / 2; return box.width > 0 && darkFrames.some((frame) => x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom) }

  for (const node of Array.from(svg.querySelectorAll('g.node'))) {
    const shapes = ownShapes(node, 'g.node')
    const shape = shapes[0]
    if (!shape) continue
    const onBlock = within(shape), marked = node.classList.contains('dark')
    const texts = Array.from(node.querySelectorAll('g.label text'))
    const special = isPill(shape) || node.classList.contains('accent') || !['rect'].includes(shape.tagName.toLowerCase())
    // A color the document gave the node itself is the document's business.
    if (/fill\s*:/.test(node.getAttribute('style') ?? '') || /fill\s*:/.test(shape.getAttribute('style') ?? '')) continue
    if (marked) {
      for (const one of shapes) inlineStyle(one, `fill:${block}!important;stroke:${tone.accent}!important;stroke-width:1.8px!important`)
      for (const text of texts) inlineStyle(text, `fill:${blockText}!important;font-weight:600`)
    } else if (special) {
      for (const one of shapes) inlineStyle(one, `fill:${onBlock ? mix(block, tone.accent, 0.14) : chip}!important;stroke:${tone.accent}!important;stroke-width:1.4px!important`)
      for (const text of texts) inlineStyle(text, `fill:${onBlock ? mix(tone.accent, '#ffffff', 0.45) : accentText}!important;font-weight:600`)
    } else if (onBlock) {
      for (const one of shapes) inlineStyle(one, `fill:${inner}!important;stroke:${innerLine}!important`)
      for (const text of texts) inlineStyle(text, `fill:${blockText}!important`)
    }
  }
  // An edge that says something is the story of the diagram; the rest are plumbing.
  for (const { edge, label } of labelledEdges(svg)) {
    recolorEdge(svg, edge, tone.accent, 1.9)
    for (const text of Array.from(label.querySelectorAll('text'))) inlineStyle(text, `fill:${accentText}!important;font-weight:600;font-size:13px`)
  }
  for (const edge of Array.from(svg.querySelectorAll('path.flowchart-link, path.transition'))) {
    const d = edge.getAttribute('d')
    if (d) edge.setAttribute('d', roundCorners(d, 7))
  }
}

/** A box with its top left and bottom right corners cut off. */
const cutBox = (x: number, y: number, w: number, h: number, cut: number) => `M${number(x + cut)} ${number(y)}H${number(x + w)}V${number(y + h - cut)}L${number(x + w - cut)} ${number(y + h)}H${number(x)}V${number(y + cut)}Z`

/**
 * A ship's console. Every box is a panel of equipment: corners cut, lit from the top, a second line inside
 * the first, a bright bar down its left side and its number in the corner. Frames carry brackets and a tab
 * with their name; data lines turn at 45° and end in terminals.
 */
export function dressConsole(svg: Element, tone: DiagramTone): void {
  titleFrames(svg, tone.panel ?? tone.ground, tone.muted, 12)
  const base = (svg.getAttribute('id') ?? 'mino').replace(/[^\w-]/g, '')
  const lit = (color: string) => `filter:drop-shadow(0 0 2px ${color}) drop-shadow(0 0 8px ${color}99)`
  const defs = make(svg, 'defs', {})
  const gradient = (name: string, color: string) => `<linearGradient id="${base}-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(tone.ground, color, 0.34)}"/><stop offset="1" stop-color="${mix(tone.ground, color, 0.06)}"/></linearGradient>`
  defs.innerHTML = gradient('panel', tone.accent) + gradient('alert', tone.second)
  svg.prepend(defs)
  let count = 0
  Array.from(svg.querySelectorAll('g.node, rect.actor, rect.note')).forEach((node) => {
    const shapes = node.tagName.toLowerCase() === 'rect' ? [node as SVGGraphicsElement] : ownShapes(node, 'g.node')
    for (const shape of shapes) {
      const tag = shape.tagName.toLowerCase()
      if (/fill\s*:/.test(shape.getAttribute('style') ?? '')) continue
      if (tag !== 'rect' || isPill(shape)) {
        // Decisions and the other odd shapes are alerts on the console: the second color.
        inlineStyle(shape, `fill:url(#${base}-alert)!important;stroke:${tone.second}!important;stroke-width:1.5px!important;${lit(tone.second)}`)
        continue
      }
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) => parseFloat(shape.getAttribute(name) ?? '0'))
      if (!(w > 12 && h > 12) || shape.classList.contains('text') || shape.classList.contains('background')) continue
      count++
      const cut = Math.min(12, h / 3)
      const parts: Element[] = [
        make(svg, 'path', { d: cutBox(x, y, w, h, cut), class: shape.getAttribute('class') ?? '', style: `fill:url(#${base}-panel);stroke:${tone.accent};stroke-width:1.4px;${lit(tone.accent)}` }),
        make(svg, 'path', { d: cutBox(x + 4, y + 4, w - 8, h - 8, Math.max(2, cut - 3)), style: `fill:none;stroke:${mix(tone.accent, tone.ground, 0.55)};stroke-width:0.7px` }),
        // The bar down the left side and the tab in the cut corner.
        make(svg, 'path', { d: `M${number(x)} ${number(y + cut + 2)}V${number(y + h)}`, style: `fill:none;stroke:${tone.accent};stroke-width:4px` }),
        make(svg, 'path', { d: `M${number(x + w - cut + 4)} ${number(y + h)}L${number(x + w)} ${number(y + h - cut + 4)}V${number(y + h)}Z`, style: `fill:${tone.second};stroke:none` }),
        make(svg, 'path', { d: `M${number(x + cut + 8)} ${number(y)}h${number(Math.min(30, w / 4))}`, style: `fill:none;stroke:${mix(tone.accent, '#ffffff', 0.5)};stroke-width:2.5px` }),
      ]
      if (w >= 84 && h >= 38) {
        const tag = make(svg, 'text', { x: number(x + w - 7), y: number(y + 11), 'text-anchor': 'end', style: `fill:${mix(tone.accent, tone.ground, 0.25)};font-size:8px;font-weight:600;letter-spacing:0.12em;filter:none` })
        tag.textContent = String(count).padStart(2, '0')
        parts.push(tag)
      }
      const transform = shape.getAttribute('transform')
      if (transform) for (const part of parts) part.setAttribute('transform', transform)
      shape.replaceWith(...parts)
    }
  })
  for (const cluster of Array.from(svg.querySelectorAll('g.cluster'))) {
    const frame = cluster.querySelector<SVGGraphicsElement>(':scope > rect'), around = frame ? bbox(frame) : null
    if (!frame || !around) continue
    const { x, y, width: w, height: h } = around, arm = Math.min(18, w / 4, h / 4)
    // Brackets at the corners, and the frame's name on a tab that hangs from its top left corner.
    frame.after(make(svg, 'path', {
      d: `M${number(x)} ${number(y + arm)}V${number(y)}H${number(x + arm)}M${number(x + w - arm)} ${number(y)}H${number(x + w)}V${number(y + arm)}M${number(x + w)} ${number(y + h - arm)}V${number(y + h)}H${number(x + w - arm)}M${number(x + arm)} ${number(y + h)}H${number(x)}V${number(y + h - arm)}`,
      style: `fill:none;stroke:${tone.accent};stroke-width:2px;${lit(tone.accent)}`,
    }))
    const rows = Array.from(cluster.querySelectorAll<SVGTSpanElement>(':scope > g.cluster-label tspan.text-outer-tspan'))
    const length = rows[0] && typeof rows[0].getComputedTextLength === 'function' ? rows[0].getComputedTextLength() : 0
    if (length > 0) {
      const tab = Math.min(w - 10, length + 30)
      frame.after(make(svg, 'path', { d: `M${number(x)} ${number(y)}H${number(x + tab)}L${number(x + tab - 10)} ${number(y + 21)}H${number(x)}Z`, style: `fill:${tone.accent};stroke:none;${lit(tone.accent)}` }))
      rows.slice(1).forEach((row) => { const at = parseFloat(row.getAttribute('x') ?? '0'); if (at > 0) row.setAttribute('x', String(number(at + 16))) })
    }
  }
  // Data lines: corners cut at 45°, a terminal at each end.
  for (const edge of Array.from(svg.querySelectorAll<SVGPathElement>('path.flowchart-link, path.transition'))) {
    const d = edge.getAttribute('d')
    if (d) edge.setAttribute('d', roundCorners(d, 9, true))
    if (typeof edge.getPointAtLength !== 'function' || typeof edge.getTotalLength !== 'function') continue
    const start = edge.getPointAtLength(0)
    edge.after(make(svg, 'circle', { cx: number(start.x), cy: number(start.y), r: 3, style: `fill:${tone.ground};stroke:${tone.accent};stroke-width:1.5px;${lit(tone.accent)}` }))
  }
  for (const { edge } of labelledEdges(svg)) {
    recolorEdge(svg, edge, tone.second)
    inlineStyle(edge, lit(tone.second))
  }
}

/**
 * The colorful look: each node takes its own color, with a darker edge of the same hue and a flat shadow set
 * off behind it; an edge takes the color of the node it leaves, and a group is tinted with a color of its own.
 */
export function dressColors(svg: Element, tone: DiagramTone): void {
  if (!tone.pens.length) return
  const darker = (fill: string) => { const [hue, saturation] = toHsl(fill); return fitColor(fromHsl(hue, Math.min(0.5, saturation), tone.dark ? 0.72 : 0.43), tone.ground, 3) }
  const byId = new Map<string, string>()
  const paint = (shapes: Element[], fill: string) => {
    const edge = darker(fill)
    for (const shape of shapes) {
      if (/fill\s*:/.test(shape.getAttribute('style') ?? '')) continue
      const shadow = shape.cloneNode(false) as Element
      shadow.removeAttribute('id')
      shadow.setAttribute('class', 'mino-shadow')
      shadow.setAttribute('style', `fill:${edge}!important;stroke:none!important;opacity:0.3`)
      shadow.setAttribute('transform', `${shape.getAttribute('transform') ?? ''} translate(3.5 4)`.trim())
      shape.before(shadow)
      inlineStyle(shape, `fill:${fill}!important;stroke:${edge}!important`)
    }
    return edge
  }
  Array.from(svg.querySelectorAll('g.node')).forEach((node, index) => {
    if (/fill\s*:/.test(node.getAttribute('style') ?? '')) return
    const edge = paint(ownShapes(node, 'g.node'), tone.pens[index % tone.pens.length])
    const id = /flowchart-(.+)-\d+$/.exec(node.getAttribute('id') ?? '')?.[1]
    if (id) byId.set(id, edge)
  })
  const actors = new Map<string, number>()
  for (const actor of Array.from(svg.querySelectorAll('rect.actor'))) {
    const name = actor.getAttribute('name') ?? String(actors.size)
    if (!actors.has(name)) actors.set(name, actors.size)
    paint([actor], tone.pens[actors.get(name)! % tone.pens.length])
  }
  Array.from(svg.querySelectorAll('g.cluster')).forEach((cluster, index) => {
    const frame = cluster.querySelector(':scope > rect')
    if (!frame) return
    const fill = tone.pens[(index * 3 + 5) % tone.pens.length], edge = darker(fill)
    inlineStyle(frame, `fill:${mix(tone.ground, fill, 0.4)}!important;stroke:${edge}!important`)
    for (const text of Array.from(cluster.querySelectorAll('g.cluster-label text, g.cluster-label tspan'))) inlineStyle(text, `fill:${edge}!important;font-weight:700`)
  })
  // An edge is the color of the node it leaves: `L_<from>_<to>_<n>`, with the longest id that fits.
  const ids = [...byId.keys()].sort((a, b) => b.length - a.length)
  for (const edge of Array.from(svg.querySelectorAll('path.flowchart-link'))) {
    const ends = /(?:^|[-_])L_(.+)_\d+$/.exec(edge.getAttribute('id') ?? '')?.[1]
    const from = ends ? ids.find((id) => ends.startsWith(`${id}_`)) : undefined
    if (from) recolorEdge(svg, edge, byId.get(from)!)
  }
}
