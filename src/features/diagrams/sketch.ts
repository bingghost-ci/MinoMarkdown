import type { Drawable, Options } from 'roughjs/bin/core'
import type { RoughGenerator } from 'roughjs/bin/generator'

/**
 * Redraws a diagram Mermaid has drawn as a pencil sketch (T115), the way Excalidraw draws: every outline
 * becomes two wobbly strokes, fills become hatching, arrowheads become two open strokes. Mermaid's own
 * hand-drawn look covers flowchart nodes only and barely shakes the lines, so Mermaid draws the plain
 * diagram and this pass replaces its shapes, whatever kind of diagram it is. Text is left alone.
 *
 * The stroke settings follow Excalidraw's `generateRoughOptions` (packages/element/src/shape.ts): roughness 1
 * ("artist"), halved for small shapes, hatching a quarter of the stroke apart at half its weight, and a
 * single stroke for dashed lines, whose dashes would otherwise overlap.
 */
export type SketchPalette = {
  /** Hatching colors, given to nodes in turn so neighbours differ. */
  fills: readonly string[]
  /** Outline colors of subgraphs, in turn. */
  frames: readonly string[]
  /** The fill Mermaid gave ordinary nodes; only these take a color from `fills`, so a color the document sets is kept. */
  plain: string
  /** The page color: a shape filled with it is not hatched. */
  paper: string
  /** Nodes that are remarks beside the diagram (clouds, bursts, bare text): each is drawn in one colored pen, unfilled and a little askew (T116). */
  remarks?: readonly Element[]
}

const SHAPES = 'rect, circle, ellipse, line, polygon, polyline, path'
const NOT_DRAWN = 'defs, marker, clipPath, mask, pattern, symbol, foreignObject'
const SVG_NS = 'http://www.w3.org/2000/svg'
/** Shapes smaller than this are filled solid: hatching a dot or a legend square leaves two stray lines. */
const SOLID_BELOW = 24

/** `#rrggbb` of a computed or written color; `null` for none and for anything fully transparent or unreadable. */
export function colorHex(value: string | null | undefined): string | null {
  const color = (value ?? '').trim().toLowerCase()
  if (!color || color === 'none' || color === 'transparent') return null
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (/^#[0-9a-f]{6}$/.test(color)) return color
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(color)
  if (!rgb) return null
  if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0')).join('')}`
}

function numbers(value: string | null): number[] {
  return (value ?? '').split(/[\s,]+/).map((part) => parseFloat(part)).filter((part) => Number.isFinite(part))
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`
}

/** Excalidraw's `adjustRoughness`: a small shape shaken as much as a large one stops looking like itself. */
function roughnessFor(min: number, max: number, open: boolean): number {
  if ((min >= 20 && max >= 50) || (open && max >= 50)) return 1
  return max < 10 ? 1 / 3 : 0.5
}

type Plan = { element: Element; draw: (generator: RoughGenerator) => Drawable | null; back: ((generator: RoughGenerator) => Drawable | null) | null; stroke: string; width: number; dash: number[]; fill: string | null; solid: boolean; opacity: string; markers: [string, string][]; transform: string | null }

/** Reads what a shape is and how it is painted; `null` for a shape that stays as Mermaid drew it. */
function plan(element: Element, index: number, fillOverride: string | undefined, strokeOverride: string | undefined, palette: SketchPalette, bare = false): Plan | null {
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return null
  const width = parseFloat(style.strokeWidth || element.getAttribute('stroke-width') || '1')
  const stroke = strokeOverride ?? colorHex(style.stroke || element.getAttribute('stroke'))
  // A shape without an outline is a background (an edge label's, a row's): hatching it would bury the text.
  if (!stroke || !(width > 0) || parseFloat(style.strokeOpacity || '1') === 0) return null
  // Outlined in the page color, it is there to cover what is behind it, not to be seen.
  if (stroke === palette.paper && !strokeOverride) return null
  const attr = (name: string) => parseFloat(element.getAttribute(name) ?? '0') || 0
  const tag = element.tagName.toLowerCase()
  // The box Mermaid keeps around a node of bare text is never meant to show.
  if (tag === 'rect' && element.classList.contains('text')) return null
  let size: [number, number]
  let open = false
  let shape: (generator: RoughGenerator, options: Options) => Drawable
  if (tag === 'rect') {
    const [x, y, w, h] = [attr('x'), attr('y'), attr('width'), attr('height')]
    if (!(w > 0 && h > 0)) return null
    const radius = Math.min(parseFloat(style.getPropertyValue('rx')) || attr('rx') || attr('ry'), w / 2, h / 2)
    size = [w, h]
    shape = radius > 0.5 ? (generator, options) => generator.path(roundedRect(x, y, w, h, radius), options) : (generator, options) => generator.rectangle(x, y, w, h, options)
  } else if (tag === 'circle' || tag === 'ellipse') {
    const rx = tag === 'circle' ? attr('r') : attr('rx'), ry = tag === 'circle' ? attr('r') : attr('ry')
    if (!(rx > 0 && ry > 0)) return null
    size = [rx * 2, ry * 2]
    shape = (generator, options) => generator.ellipse(attr('cx'), attr('cy'), rx * 2, ry * 2, { ...options, curveFitting: 1 })
  } else if (tag === 'line') {
    const [x1, y1, x2, y2] = [attr('x1'), attr('y1'), attr('x2'), attr('y2')]
    size = [Math.abs(x2 - x1), Math.abs(y2 - y1)]
    open = true
    shape = (generator, options) => generator.line(x1, y1, x2, y2, options)
  } else if (tag === 'polygon' || tag === 'polyline') {
    const flat = numbers(element.getAttribute('points'))
    const points: [number, number][] = []
    for (let at = 0; at + 1 < flat.length; at += 2) points.push([flat[at], flat[at + 1]])
    if (points.length < 2) return null
    const xs = points.map((point) => point[0]), ys = points.map((point) => point[1])
    size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    open = tag === 'polyline'
    shape = open ? (generator, options) => generator.linearPath(points, options) : (generator, options) => generator.polygon(points, options)
  } else {
    const d = element.getAttribute('d')
    if (!d || !/[\d]/.test(d)) return null
    const box = typeof (element as SVGGraphicsElement).getBBox === 'function' ? (element as SVGGraphicsElement).getBBox() : { width: 60, height: 60 }
    size = [box.width, box.height]
    open = !/z\s*$/i.test(d)
    shape = (generator, options) => generator.path(d, options)
  }
  const painted = fillOverride ?? colorHex(style.fill || element.getAttribute('fill'))
  const fill = open && !fillOverride ? (tag === 'path' ? painted : null) : painted
  const filled = !bare && fill !== null && parseFloat(style.fillOpacity || '1') > 0
  const hatch = filled && fill !== palette.paper ? fill : null
  const min = Math.min(...size), max = Math.max(...size)
  const dash = style.strokeDasharray && style.strokeDasharray !== 'none' ? numbers(style.strokeDasharray) : []
  const solid = max < SOLID_BELOW
  const options: Options = {
    seed: 1 + index * 17,
    roughness: roughnessFor(min, max, open || min < 2),
    bowing: 1,
    stroke, strokeWidth: width,
    // Dashes of two strokes fall on each other and read as a smudge.
    disableMultiStroke: dash.length > 0,
    strokeLineDash: dash.length ? dash : undefined,
    // Edges keep their ends where Mermaid put them, so arrowheads stay on the line and the line on its node.
    preserveVertices: true,
    ...(hatch ? { fill: hatch, fillStyle: solid ? 'solid' : 'hachure', fillWeight: Math.max(0.7, width / 2), hachureGap: Math.max(4, width * 3.2), hachureAngle: -41 } : {}),
  }
  const markers = ['marker-start', 'marker-mid', 'marker-end'].flatMap((name): [string, string][] => { const value = element.getAttribute(name); return value ? [[name, value]] : [] })
  // Hatching is see-through; a filled shape still hides the lines that run behind it. A subgraph's frame does not.
  const backing: Options = { seed: options.seed, roughness: 0, stroke: 'none', fill: palette.paper, fillStyle: 'solid' }
  return {
    element, stroke, width, dash, fill: hatch, solid, markers,
    back: filled && !solid && !strokeOverride ? (generator) => { try { return shape(generator, backing) } catch { return null } } : null,
    opacity: style.opacity && style.opacity !== '1' ? style.opacity : '',
    transform: element.getAttribute('transform'),
    draw: (generator) => { try { return shape(generator, options) } catch { return null } },
  }
}

function replace(item: Plan, generator: RoughGenerator, paper: string): void {
  const drawable = item.draw(generator)
  if (!drawable) return
  const group = item.element.ownerDocument.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'mino-sketch')
  if (item.transform) group.setAttribute('transform', item.transform)
  const id = item.element.getAttribute('id')
  if (id) group.setAttribute('id', id)
  if (item.opacity) group.setAttribute('opacity', item.opacity)
  for (const set of item.back?.(generator)?.sets ?? []) {
    if (set.type !== 'fillPath') continue
    const path = item.element.ownerDocument.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', generator.opsToPath(set))
    path.setAttribute('style', `fill:${paper};stroke:none`)
    group.append(path)
  }
  for (const set of drawable.sets) {
    const d = generator.opsToPath(set)
    if (!d) continue
    const path = item.element.ownerDocument.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    // Inline styles, because Mermaid's own sheet paints `.node path` and would fill these strokes in.
    if (set.type === 'path') {
      path.setAttribute('style', `fill:none;stroke:${item.stroke};stroke-width:${item.width}px;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:${item.dash.length ? item.dash.join(' ') : 'none'}`)
      for (const [name, value] of item.markers) path.setAttribute(name, value)
    } else if (set.type === 'fillPath') {
      path.setAttribute('style', `fill:${item.fill};stroke:none`)
    } else {
      path.setAttribute('style', `fill:none;stroke:${item.fill};stroke-width:${drawable.options.fillWeight}px;stroke-linecap:round;stroke-dasharray:none`)
    }
    group.append(path)
  }
  item.element.replaceWith(group)
}

/** Arrowheads Mermaid draws as a filled wedge; the ones with a meaning of their own (inheritance, composition, crow's feet) are kept. */
const ARROW_MARKER = /(?:point(?:End|Start)|barbEnd|arrowhead|dependency(?:End|Start))(?:-margin)?(?:-pen\d+)?$/
/** Room around a marker's own box for the longer strokes, in the marker's units. */
const MARKER_ROOM = 6

/**
 * Turns a wedge into the two strokes a pen makes. The marker keeps its reference point and scale, so the tip
 * stays where it was; its box grows instead, because a marker clips what it draws.
 */
function sketchMarker(marker: Element, stroke: string | null, width: number): void {
  const path = marker.querySelector('path, polygon')
  if (!path || marker.children.length !== 1) return
  const flat = numbers((path.getAttribute('d') ?? path.getAttribute('points') ?? '').replace(/[a-z]/gi, ' '))
  const points: [number, number][] = []
  for (let at = 0; at + 1 < flat.length; at += 2) points.push([flat[at], flat[at + 1]])
  if (points.length < 3 || points.length > 4) return
  const middle = (Math.min(...points.map((point) => point[1])) + Math.max(...points.map((point) => point[1]))) / 2
  const wings = points.filter((point) => Math.abs(point[1] - middle) > 0.01)
  const axis = points.filter((point) => Math.abs(point[1] - middle) <= 0.01)
  if (wings.length !== 2 || axis.length < 1) return
  const back = (wings[0][0] + wings[1][0]) / 2
  const tip = axis.reduce((far, point) => Math.abs(point[0] - back) > Math.abs(far[0] - back) ? point : far)
  const color = stroke ?? colorHex(getComputedStyle(path).fill) ?? colorHex(getComputedStyle(path).stroke)
  if (!color) return
  const mw = parseFloat(marker.getAttribute('markerWidth') ?? '3'), mh = parseFloat(marker.getAttribute('markerHeight') ?? '3')
  const view = numbers(marker.getAttribute('viewBox'))
  const [vx, vy, vw, vh] = view.length === 4 ? view : [0, 0, mw, mh]
  const scale = vw > 0 ? mw / vw : 1
  // The wings reach back half as far again and a little wider than the wedge did, and are not quite alike.
  const wing = (point: [number, number], stretch: number) => `${(tip[0] + (point[0] - tip[0]) * stretch).toFixed(2)} ${(tip[1] + (point[1] - tip[1]) * (stretch * 0.92)).toFixed(2)}`
  const bend = (point: [number, number]) => `${(tip[0] + (point[0] - tip[0]) * 0.6).toFixed(2)} ${(tip[1] + (point[1] - tip[1]) * 0.45).toFixed(2)}`
  const d = `M${wing(wings[0], 1.55)} Q${bend(wings[0])} ${tip[0]} ${tip[1]} M${wing(wings[1], 1.4)} Q${bend(wings[1])} ${tip[0]} ${tip[1]} M${back.toFixed(2)} ${middle} L${tip[0]} ${tip[1]}`
  const room = MARKER_ROOM / scale
  marker.setAttribute('viewBox', `${vx - room} ${vy - room} ${vw + room * 2} ${vh + room * 2}`)
  marker.setAttribute('markerWidth', String(mw + MARKER_ROOM * 2))
  marker.setAttribute('markerHeight', String(mh + MARKER_ROOM * 2))
  const drawn = marker.ownerDocument.createElementNS(SVG_NS, 'path')
  drawn.setAttribute('d', d)
  const units = marker.getAttribute('markerUnits') === 'strokeWidth' ? 1 : width / scale
  drawn.setAttribute('style', `fill:none!important;stroke:${color}!important;stroke-width:${units.toFixed(2)}px!important;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none!important`)
  path.replaceWith(drawn)
}

/** A few degrees either way: a remark is written beside the diagram, not ruled into it. */
const TILTS = [-2.5, 2, -1.5, 3]

/**
 * Gives each remark a pen: its outline, its words and the edges that touch it are drawn in that color, the
 * outline is left unfilled, and the whole remark is turned a little. An edge takes a copy of its arrowhead,
 * because arrowheads are shared and the others stay in ink.
 */
function remarkPens(svg: Element, palette: SketchPalette, strokes: Map<Element, string>, bare: Set<Element>): void {
  const pens = palette.frames
  if (!palette.remarks?.length || !pens.length) return
  const edges = Array.from(svg.querySelectorAll('path[id], line[id]')).filter((edge) => !edge.closest(NOT_DRAWN) && !edge.closest('g.node'))
  palette.remarks.forEach((node, index) => {
    const pen = pens[(index + 1) % pens.length]
    // A remark of bare text has a box nobody sees; it stays unseen.
    for (const shape of Array.from(node.querySelectorAll(SHAPES))) if (colorHex(getComputedStyle(shape).stroke)) { strokes.set(shape, pen); bare.add(shape) }
    for (const text of Array.from(node.querySelectorAll('text'))) text.setAttribute('style', `${text.getAttribute('style') ?? ''};fill:${pen}!important`)
    const place = node.getAttribute('transform') ?? ''
    if (!/rotate/.test(place)) node.setAttribute('transform', `${place} rotate(${TILTS[index % TILTS.length]})`.trim())
    const id = /flowchart-(.+)-\d+$/.exec(node.getAttribute('id') ?? '')?.[1]
    if (!id) return
    for (const edge of edges) {
      const ends = /(?:^|[-_])L_(.+)_\d+$/.exec(edge.getAttribute('id') ?? '')?.[1]
      if (!ends || !(ends.startsWith(`${id}_`) || ends.endsWith(`_${id}`)) || strokes.has(edge)) continue
      strokes.set(edge, pen)
      for (const name of ['marker-start', 'marker-end']) {
        const marker = /#([^)"']+)/.exec(edge.getAttribute(name) ?? '')?.[1]
        const original = marker ? Array.from(svg.querySelectorAll('marker')).find((candidate) => candidate.getAttribute('id') === marker) : undefined
        if (!marker || !original) continue
        const copyId = `${marker}-pen${index}`
        if (!Array.from(svg.querySelectorAll('marker')).some((candidate) => candidate.getAttribute('id') === copyId)) {
          const copy = original.cloneNode(true) as Element
          copy.setAttribute('id', copyId)
          original.after(copy)
        }
        edge.setAttribute(name, `url(#${copyId})`)
      }
    }
  })
}

/**
 * Mermaid draws the frame of an icon node as two paths of its own making, already doubled. They are swapped
 * for one plain rounded box, which is then sketched and hatched like any node.
 */
function frameIcons(svg: Element, palette: SketchPalette, fills: Map<Element, string>): void {
  Array.from(svg.querySelectorAll('g.icon-shape')).forEach((node, index) => {
    const frame = node.firstElementChild
    const paths = frame?.tagName.toLowerCase() === 'g' ? Array.from(frame.querySelectorAll<SVGGraphicsElement>(':scope > path')) : []
    if (paths.length !== 2 || typeof paths[1].getBBox !== 'function') return
    const stroke = colorHex(getComputedStyle(paths[1]).stroke)
    if (!stroke || !(parseFloat(getComputedStyle(paths[1]).strokeWidth) > 0)) return
    const box = paths[1].getBBox()
    if (!(box.width > 0 && box.height > 0)) return
    const rect = svg.ownerDocument.createElementNS(SVG_NS, 'rect')
    for (const [name, value] of [['x', box.x], ['y', box.y], ['width', box.width], ['height', box.height], ['rx', 6]] as const) rect.setAttribute(name, String(value))
    rect.setAttribute('style', `fill:${palette.plain};stroke:${stroke};stroke-width:1.6px`)
    paths[0].remove()
    paths[1].replaceWith(rect)
    if (palette.fills.length) fills.set(rect, palette.fills[(index + 3) % palette.fills.length])
  })
}

/**
 * Redraws the shapes of `svg` in place. The SVG must be in the document, since what a shape looks like is in
 * Mermaid's style sheet. Every stroke comes from a seed fixed by the shape's place in the diagram, so the
 * same diagram is always drawn the same way.
 */
export function sketchDiagram(svg: Element, generator: RoughGenerator, palette: SketchPalette): number {
  const fills = new Map<Element, string>(), strokes = new Map<Element, string>()
  const turn = (list: readonly string[], index: number) => list[index % list.length]
  const ownShapes = (group: Element, kind: string) => Array.from(group.querySelectorAll(SHAPES)).filter((shape) => shape.closest(kind) === group)
  if (palette.fills.length) {
    Array.from(svg.querySelectorAll('g.node')).forEach((node, index) => {
      for (const shape of ownShapes(node, 'g.node')) if (colorHex(getComputedStyle(shape).fill) === palette.plain) fills.set(shape, turn(palette.fills, index))
    })
    // A sequence diagram draws each participant at the top and again at the bottom: both take one color.
    const actors = new Map<string, number>()
    for (const actor of Array.from(svg.querySelectorAll('rect.actor'))) {
      const name = actor.getAttribute('name') ?? String(actors.size)
      if (!actors.has(name)) actors.set(name, actors.size)
      if (colorHex(getComputedStyle(actor).fill) === palette.plain) fills.set(actor, turn(palette.fills, actors.get(name)!))
    }
  }
  if (palette.frames.length) Array.from(svg.querySelectorAll('g.cluster')).forEach((cluster, index) => { for (const shape of ownShapes(cluster, 'g.cluster')) strokes.set(shape, turn(palette.frames, index)) })

  const bare = new Set<Element>()
  remarkPens(svg, palette, strokes, bare)
  frameIcons(svg, palette, fills)

  const plans: Plan[] = []
  Array.from(svg.querySelectorAll(SHAPES)).forEach((element, index) => {
    if (element.closest(NOT_DRAWN)) return
    const item = plan(element, index, fills.get(element), strokes.get(element), palette, bare.has(element))
    if (item) plans.push(item)
  })
  // The strokes of the lines that carry each arrowhead, read before anything is replaced.
  const markers = Array.from(svg.querySelectorAll('marker')).filter((marker) => ARROW_MARKER.test(marker.getAttribute('id') ?? ''))
  const carrier = new Map<string, Plan>()
  for (const item of plans) for (const [, value] of item.markers) { const id = /#([^)"']+)/.exec(value)?.[1]; if (id && !carrier.has(id)) carrier.set(id, item) }
  for (const marker of markers) { const line = carrier.get(marker.getAttribute('id') ?? ''); sketchMarker(marker, line?.stroke ?? null, line?.width ?? 1.5) }
  for (const item of plans) replace(item, generator, palette.paper)
  return plans.length
}
