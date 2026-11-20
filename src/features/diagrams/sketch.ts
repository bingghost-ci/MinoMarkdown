import type { Drawable, Options } from 'roughjs/bin/core'
import type { RoughGenerator } from 'roughjs/bin/generator'
import type { SketchHand } from './looks'
import { edgeEnds, flowNodeName, ownMarkers, SVG_NS } from './svg'

const MARKER: SketchHand = { roughness: 1, twice: false, fill: 'hatch', coloredOutline: false, grain: 'none', hatchGap: 5, hatchWeight: 0.8, inner: false, solidArrows: false, wobble: 1.4, overshoot: 0 }

/**
 * Redraws a diagram Mermaid has drawn as if by hand (T115, T117). Mermaid's own hand-drawn look covers
 * flowchart nodes only and barely shakes the lines, so Mermaid draws the plain diagram and this pass replaces
 * its shapes, whatever kind of diagram it is. Text is left alone.
 *
 * How the hand holds the pen is a `SketchHand` (`looks.ts`): a marker over a wash of watercolor, a pencil
 * that goes over each line twice and shades with hatching, chalk on a board, a fountain pen that rules a
 * second line inside each box. rough.js makes the strokes; the washes, the inner lines, the arrowheads and
 * the grain of the tool are made here.
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
  /** How the pen is held; a marker when left out. */
  hand?: SketchHand
  /** Nodes that are remarks beside the diagram (clouds, bursts, bare text): each is drawn in one colored pen, unfilled and a little askew (T116). */
  remarks?: readonly Element[]
}

const SHAPES = 'rect, circle, ellipse, line, polygon, polyline, path'
const NOT_DRAWN = 'defs, marker, clipPath, mask, pattern, symbol, foreignObject'
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

/** A small repeatable random source, so a wash is the same every time the diagram is drawn. */
function seeded(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

type Point = readonly [number, number]

/** A curve through the points, as a pen moves through them without stopping; `lead` is false when it continues a stroke. */
function through(points: readonly Point[], lead = true): string {
  const n = (value: number) => value.toFixed(1)
  let d = lead ? `M${n(points[0][0])} ${n(points[0][1])}` : ''
  for (let index = 0; index + 1 < points.length; index++) {
    const before = points[Math.max(0, index - 1)], from = points[index], to = points[index + 1], after = points[Math.min(points.length - 1, index + 2)]
    d += `C${n(from[0] + (to[0] - before[0]) / 6)} ${n(from[1] + (to[1] - before[1]) / 6)} ${n(to[0] - (after[0] - from[0]) / 6)} ${n(to[1] - (after[1] - from[1]) / 6)} ${n(to[0])} ${n(to[1])}`
  }
  return d
}

/**
 * The points of a line from `from` to `to` as a hand rules it without a ruler: it bows a little one way and
 * wavers as it goes, more over a long run than a short one, and still arrives where it was going.
 */
function wavering(from: Point, to: Point, random: () => number, wobble: number): Point[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (length < 6) return [from, to]
  const steps = Math.max(2, Math.round(length / 20))
  const nx = -(to[1] - from[1]) / length, ny = (to[0] - from[0]) / length
  const bow = (random() - 0.5) * 2 * wobble * Math.min(1.4, length / 90)
  const sway = wobble * 0.5 * Math.min(1, length / 50), first = random() * 6.28, second = random() * 6.28, turns = 0.7 + random() * 0.9
  const points: Point[] = [from]
  for (let step = 1; step < steps; step++) {
    const t = step / steps
    const off = (bow + sway * (Math.sin(t * 6.28 * turns + first) + 0.55 * Math.sin(t * 6.28 * turns * 2.3 + second))) * Math.sin(Math.PI * t)
    points.push([from[0] + (to[0] - from[0]) * t + nx * off, from[1] + (to[1] - from[1]) * t + ny * off])
  }
  points.push(to)
  return points
}

/** How a hand goes round a shape; the numbers are pixels. */
export type HandStroke = { wobble: number; overshoot: number; twice: boolean }

/**
 * The outline of a shape with corners, drawn by hand: no side is quite straight and no corner quite where a
 * ruler would put it. A pencil draws each side as a stroke of its own and runs past the corners; a pen goes
 * round in one stroke and ends a little past where it began. `rounded` is the radius of the corners.
 */
export function handOutline(corners: readonly Point[], seed: number, hand: HandStroke, rounded = 0): string {
  const pass = (salt: number, wobble: number): string => {
    const random = seeded(seed + salt)
    const off = () => (random() - 0.5) * 2 * wobble * 0.85
    const moved = corners.map(([x, y]) => [x + off(), y + off()] as Point)
    const at = (index: number) => moved[(index + moved.length) % moved.length]
    if (hand.overshoot > 0) {
      return moved.map((from, index) => {
        const to = at(index + 1), length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
        const ux = (to[0] - from[0]) / length, uy = (to[1] - from[1]) / length
        const before = hand.overshoot * (0.3 + random() * 0.7), after = hand.overshoot * (0.3 + random() * 0.7)
        return through(wavering([from[0] - ux * before + off() * 0.4, from[1] - uy * before + off() * 0.4], [to[0] + ux * after + off() * 0.4, to[1] + uy * after + off() * 0.4], random, wobble))
      }).join('')
    }
    if (rounded > 1) {
      // Each corner is turned through three points, and the whole outline is one unbroken curve.
      const loop: Point[] = []
      moved.forEach((corner, index) => {
        const before = at(index - 1), after = at(index + 1)
        const inLength = Math.hypot(corner[0] - before[0], corner[1] - before[1]) || 1, outLength = Math.hypot(after[0] - corner[0], after[1] - corner[1]) || 1
        const r = Math.min(rounded, inLength / 2, outLength / 2)
        const start: Point = [corner[0] - ((corner[0] - before[0]) / inLength) * r, corner[1] - ((corner[1] - before[1]) / inLength) * r]
        const end: Point = [corner[0] + ((after[0] - corner[0]) / outLength) * r, corner[1] + ((after[1] - corner[1]) / outLength) * r]
        const turn: Point = [(start[0] + end[0] + corner[0] * 2) / 4, (start[1] + end[1] + corner[1] * 2) / 4]
        const previous = loop[loop.length - 1]
        if (previous) loop.push(...wavering(previous, start, random, wobble).slice(1)); else loop.push(start)
        loop.push(turn, end)
      })
      loop.push(...wavering(loop[loop.length - 1], loop[0], random, wobble).slice(1), [loop[1][0] + off() * 0.5, loop[1][1] + off() * 0.5])
      return through(loop)
    }
    // Round in one stroke: sharp at the corners, and past the start by a few pixels where the pen is lifted.
    let d = ''
    moved.forEach((from, index) => { d += through(wavering(from, at(index + 1), random, wobble), index === 0) })
    const first = moved[0], second = at(1), run = Math.hypot(second[0] - first[0], second[1] - first[1]) || 1, past = Math.min(5, run / 4)
    return `${d}L${(first[0] + ((second[0] - first[0]) / run) * past + off() * 0.4).toFixed(1)} ${(first[1] + ((second[1] - first[1]) / run) * past + off() * 0.4).toFixed(1)}`
  }
  return hand.twice ? pass(0, hand.wobble) + pass(5, hand.wobble * 0.75) : pass(0, hand.wobble)
}

/** A circle or an ellipse by hand: never quite round, and closed by running over its own beginning. */
export function handEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, hand: HandStroke): string {
  const pass = (salt: number, wobble: number): string => {
    const random = seeded(seed + salt)
    const start = random() * 6.28, count = Math.max(8, Math.min(18, Math.round((rx + ry) / 7)))
    const swell = Math.min(0.12, wobble / Math.max(6, Math.min(rx, ry))), first = random() * 6.28, lean = (random() - 0.5) * swell
    const points: Point[] = []
    for (let step = 0; step <= count + 1; step++) {
      const angle = start + (step / count) * 6.28
      const stretch = 1 + swell * 0.6 * Math.sin(angle * 2 + first) + lean * Math.cos(angle) + (step > count - 1 ? swell * 0.5 : 0)
      points.push([cx + Math.cos(angle) * rx * stretch, cy + Math.sin(angle) * ry * stretch])
    }
    return through(points)
  }
  return hand.twice ? pass(0, hand.wobble) + pass(5, hand.wobble * 0.75) : pass(0, hand.wobble)
}

/**
 * An open line by hand: through corner points (an edge of straight pieces) or through points taken along a
 * curve. Its two ends stay exactly where they were, so it still meets its nodes and carries its arrowhead.
 */
export function handLine(points: readonly Point[], seed: number, hand: HandStroke, sampled = false): string {
  const pass = (salt: number, wobble: number): string => {
    const random = seeded(seed + salt)
    if (sampled) {
      const first = random() * 6.28, second = random() * 6.28, last = points.length - 1
      return through(points.map((point, index) => {
        if (index === 0 || index === last) return point
        const before = points[index - 1], after = points[index + 1], length = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1
        const off = wobble * 0.75 * (Math.sin(index * 0.5 + first) + 0.5 * Math.sin(index * 1.3 + second)) * Math.min(1, index / 2, (last - index) / 2)
        return [point[0] - ((after[1] - before[1]) / length) * off, point[1] + ((after[0] - before[0]) / length) * off] as Point
      }))
    }
    const off = () => (random() - 0.5) * 2 * wobble * 0.5
    const moved = points.map((point, index) => index === 0 || index === points.length - 1 ? point : [point[0] + off(), point[1] + off()] as Point)
    let d = ''
    for (let index = 0; index + 1 < moved.length; index++) d += through(wavering(moved[index], moved[index + 1], random, wobble), index === 0)
    return d
  }
  return hand.twice ? pass(0, hand.wobble) + pass(5, hand.wobble * 0.7) : pass(0, hand.wobble)
}

/** The corner points of a path made only of straight pieces; `null` for one with curves in it. */
/** The corners of a path made of straight pieces only (one subpath), or null when it has curves or fewer than two points. */
export function straightPoints(d: string): Point[] | null {
  if (!/^[\sMLHV\d.,e+-]+$/.test(d) || (d.match(/M/g) ?? []).length !== 1) return null
  const points: Point[] = []
  for (const [, command, values] of d.matchAll(/([MLHV])([^MLHV]*)/g)) {
    const list = values.split(/[\s,]+/).filter(Boolean).map(Number)
    if (list.some((value) => !Number.isFinite(value))) return null
    const last = points[points.length - 1] ?? [0, 0]
    if (command === 'H') for (const x of list) points.push([x, last[1]])
    else if (command === 'V') for (const y of list) points.push([last[0], y])
    else for (let at = 0; at + 1 < list.length; at += 2) points.push([list[at], list[at + 1]])
  }
  const kept = points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 0.01)
  return kept.length >= 2 ? kept : null
}

/**
 * A wash of color for a shape: its outline set off down and to the right, each corner nudged and each side
 * bowed a little, as a brush fills a box without keeping to its lines.
 */
export function washPath(points: readonly (readonly [number, number])[], seed: number, smooth = false): string {
  const random = seeded(seed)
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1])
  const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const shift = Math.max(1.5, Math.min(4.5, size * 0.09)), stray = Math.max(0.6, Math.min(2.4, size * 0.04))
  const moved = points.map(([x, y]) => [x + shift + (random() - 0.5) * 2 * stray, y + shift + (random() - 0.5) * 2 * stray] as const)
  const at = (index: number) => moved[(index + moved.length) % moved.length]
  const n = (value: number) => value.toFixed(1)
  if (smooth) {
    // Through the middles of the sides, with the corners as control points: a closed curve.
    const mid = (index: number) => [(at(index)[0] + at(index + 1)[0]) / 2, (at(index)[1] + at(index + 1)[1]) / 2]
    return `M${n(mid(-1)[0])} ${n(mid(-1)[1])}${moved.map((point, index) => `Q${n(point[0])} ${n(point[1])} ${n(mid(index)[0])} ${n(mid(index)[1])}`).join('')}Z`
  }
  return `M${n(moved[0][0])} ${n(moved[0][1])}${moved.map((_, index) => {
    const from = at(index), to = at(index + 1)
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, bow = (random() - 0.5) * 2 * stray
    return `Q${n((from[0] + to[0]) / 2 - ((to[1] - from[1]) / length) * bow)} ${n((from[1] + to[1]) / 2 + ((to[0] - from[0]) / length) * bow)} ${n(to[0])} ${n(to[1])}`
  }).join('')}Z`
}

/** Excalidraw's `adjustRoughness`: a small shape shaken as much as a large one stops looking like itself. */
function roughnessFor(min: number, max: number, open: boolean): number {
  if ((min >= 20 && max >= 50) || (open && max >= 50)) return 1
  return max < 10 ? 1 / 3 : 0.5
}

type Plan = { element: Element; draw: (generator: RoughGenerator) => Drawable | null; inner: string | null; outline: string | null; wash: { d: string; shift: number } | null; flat: boolean; thin: boolean; back: ((generator: RoughGenerator) => Drawable | null) | null; stroke: string; width: number; dash: number[]; fill: string | null; solid: boolean; opacity: string; markers: [string, string][]; transform: string | null }

/** Reads what a shape is and how it is painted; `null` for a shape that stays as Mermaid drew it. */
function plan(element: Element, index: number, fillOverride: string | undefined, strokeOverride: string | undefined, palette: SketchPalette, bare = false): Plan | null {
  const hand = palette.hand ?? MARKER
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
  const seed = 1 + index * 17
  // The box Mermaid keeps around a node of bare text is never meant to show.
  if (tag === 'rect' && element.classList.contains('text')) return null
  let size: [number, number]
  let open = false
  let shape: (generator: RoughGenerator, options: Options, inset?: number) => Drawable
  // The corners a wash follows, and whether the shape is round; a free path has neither and is washed as it is.
  let corners: [number, number][] | null = null
  let round = false
  let d: string | null = null
  // The outline as this hand draws it, when the shape is one this module knows how to draw; rough.js draws the rest.
  let outline: ((inset: number, salt: number, stroke: HandStroke) => string) | null = null
  if (tag === 'rect') {
    const [x, y, w, h] = [attr('x'), attr('y'), attr('width'), attr('height')]
    if (!(w > 0 && h > 0)) return null
    const radius = Math.min(parseFloat(style.getPropertyValue('rx')) || attr('rx') || attr('ry'), w / 2, h / 2)
    size = [w, h]
    corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    outline = (inset, salt, stroke) => handOutline([[x + inset, y + inset], [x + w - inset, y + inset], [x + w - inset, y + h - inset], [x + inset, y + h - inset]], seed + salt, stroke, Math.max(0, radius - inset))
    shape = (generator, options, inset = 0) => radius - inset > 0.5 ? generator.path(roundedRect(x + inset, y + inset, w - inset * 2, h - inset * 2, radius - inset), options) : generator.rectangle(x + inset, y + inset, w - inset * 2, h - inset * 2, options)
  } else if (tag === 'circle' || tag === 'ellipse') {
    const rx = tag === 'circle' ? attr('r') : attr('rx'), ry = tag === 'circle' ? attr('r') : attr('ry')
    if (!(rx > 0 && ry > 0)) return null
    size = [rx * 2, ry * 2]
    const cx = attr('cx'), cy = attr('cy')
    corners = Array.from({ length: 10 }, (_, index) => [cx + Math.cos(index * Math.PI / 5) * rx * 1.04, cy + Math.sin(index * Math.PI / 5) * ry * 1.04])
    round = true
    outline = (inset, salt, stroke) => handEllipse(cx, cy, Math.max(1, rx - inset), Math.max(1, ry - inset), seed + salt, stroke)
    shape = (generator, options, inset = 0) => generator.ellipse(cx, cy, (rx - inset) * 2, (ry - inset) * 2, { ...options, curveFitting: 1 })
  } else if (tag === 'line') {
    const [x1, y1, x2, y2] = [attr('x1'), attr('y1'), attr('x2'), attr('y2')]
    size = [Math.abs(x2 - x1), Math.abs(y2 - y1)]
    open = true
    outline = (_inset, salt, stroke) => handLine([[x1, y1], [x2, y2]], seed + salt, stroke)
    shape = (generator, options) => generator.line(x1, y1, x2, y2, options)
  } else if (tag === 'polygon' || tag === 'polyline') {
    const flat = numbers(element.getAttribute('points'))
    const points: [number, number][] = []
    for (let at = 0; at + 1 < flat.length; at += 2) points.push([flat[at], flat[at + 1]])
    if (points.length < 2) return null
    const xs = points.map((point) => point[0]), ys = points.map((point) => point[1])
    size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    open = tag === 'polyline'
    if (!open) corners = points
    const cx = xs.reduce((sum, value) => sum + value, 0) / xs.length, cy = ys.reduce((sum, value) => sum + value, 0) / ys.length
    // Drawn smaller about its middle: near enough to an inset for the simple shapes Mermaid makes of polygons.
    const within = (inset: number): [number, number][] => { const scale = Math.max(0.1, 1 - (inset * 2) / Math.max(1, Math.min(size[0], size[1]))); return points.map(([px, py]) => [cx + (px - cx) * scale, cy + (py - cy) * scale]) }
    outline = open ? (_inset, salt, stroke) => handLine(points, seed + salt, stroke) : (inset, salt, stroke) => handOutline(inset ? within(inset) : points, seed + salt, stroke)
    shape = open ? (generator, options) => generator.linearPath(points, options) : (generator, options, inset = 0) => generator.polygon(inset ? within(inset) : points, options)
  } else {
    d = element.getAttribute('d')
    if (!d || !/[\d]/.test(d)) return null
    const whole = d
    const box = typeof (element as SVGGraphicsElement).getBBox === 'function' ? (element as SVGGraphicsElement).getBBox() : { width: 60, height: 60 }
    size = [box.width, box.height]
    open = !/z\s*$/i.test(whole)
    // An edge: by its corners when it is made of straight pieces, otherwise by points taken along its curve.
    const unfilled = !colorHex(style.fill || element.getAttribute('fill'))
    const straight = open && unfilled ? straightPoints(whole) : null
    const curve = element as unknown as SVGGeometryElement
    if (straight) outline = (_inset, salt, stroke) => handLine(straight, seed + salt, stroke)
    else if (open && unfilled && (whole.match(/M/gi) ?? []).length === 1 && typeof curve.getTotalLength === 'function') {
      const total = curve.getTotalLength(), count = Math.max(2, Math.min(60, Math.round(total / 16)))
      const taken: Point[] = total > 0 ? Array.from({ length: count + 1 }, (_, index) => { const point = curve.getPointAtLength((total * index) / count); return [point.x, point.y] as Point }) : []
      if (taken.length > 2) outline = (_inset, salt, stroke) => handLine(taken, seed + salt, stroke, true)
    }
    shape = (generator, options) => generator.path(whole, options)
  }
  const painted = fillOverride ?? colorHex(style.fill || element.getAttribute('fill'))
  const fill = open && !fillOverride ? (tag === 'path' ? painted : null) : painted
  const filled = !bare && fill !== null && parseFloat(style.fillOpacity || '1') > 0
  const hatch = filled && fill !== palette.paper ? fill : null
  const min = Math.min(...size), max = Math.max(...size)
  const dash = style.strokeDasharray && style.strokeDasharray !== 'none' ? numbers(style.strokeDasharray) : []
  const small = max < SOLID_BELOW
  const mode = small ? 'solid' : hand.fill
  const solid = mode === 'solid'
  const options: Options = {
    seed,
    roughness: roughnessFor(min, max, open || min < 2) * hand.roughness,
    bowing: 1,
    stroke, strokeWidth: width,
    // Dashes of two strokes fall on each other and read as a smudge.
    disableMultiStroke: dash.length > 0 || !hand.twice,
    strokeLineDash: dash.length ? dash : undefined,
    // Edges keep their ends where Mermaid put them, so arrowheads stay on the line and the line on its node; a
    // closed shape has no such duty, and its corners are let stray.
    preserveVertices: open,
    ...(hatch && (mode === 'solid' || mode === 'hatch') ? { fill: hatch, fillStyle: solid ? 'solid' : 'hachure', fillWeight: hand.hatchWeight, hachureGap: hand.hatchGap, hachureAngle: -41 } : {}),
  }
  const markers = ['marker-start', 'marker-mid', 'marker-end'].flatMap((name): [string, string][] => { const value = element.getAttribute(name); return value ? [[name, value]] : [] })
  // Hatching is see-through; a filled shape still hides the lines that run behind it. A subgraph's frame does not.
  const backing: Options = { seed: options.seed, roughness: 0, stroke: 'none', fill: palette.paper, fillStyle: 'solid' }
  const shift = Math.max(1.5, Math.min(4.5, min * 0.09))
  const wash = hatch && mode === 'wash' ? (corners ? { d: washPath(corners, seed, round), shift: 0 } : d ? { d, shift } : null) : null
  // The second line a pen rules inside a box: thinner, and not quite parallel.
  const gap = Math.max(4, width * 1.9)
  const stroke_ = { wobble: hand.wobble * Math.min(1, Math.max(0.35, max / 60)), overshoot: min >= 26 && dash.length === 0 ? hand.overshoot : 0, twice: hand.twice && dash.length === 0 }
  const ruled = hand.inner && !open && !bare && corners !== null && min >= 26 && dash.length === 0
  return {
    element, stroke, width, dash, fill: hatch, solid, markers, wash, flat: small, thin: min < 6,
    // The same hand at the same moment, a little further in: the two lines keep their distance and never touch.
    inner: ruled && outline ? outline(gap, 0, { ...stroke_, twice: false }) : null,
    outline: outline ? outline(0, 0, stroke_) : null,
    back: filled && !solid && element.closest('g.cluster') === null ? (generator) => { try { return shape(generator, backing) } catch { return null } } : null,
    opacity: style.opacity && style.opacity !== '1' ? style.opacity : '',
    transform: element.getAttribute('transform'),
    draw: (generator) => { try { return shape(generator, options) } catch { return null } },
  }
}

function replace(item: Plan, generator: RoughGenerator, paper: string, grain: { id: string; wide: string } | null): void {
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
  if (item.wash && item.fill) {
    const path = item.element.ownerDocument.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', item.wash.d)
    if (item.wash.shift) path.setAttribute('transform', `translate(${item.wash.shift.toFixed(1)} ${item.wash.shift.toFixed(1)})`)
    // A stroke of the same color rounds the corners of the wash, as wet paint does.
    path.setAttribute('style', `fill:${item.fill};stroke:${item.fill};stroke-width:3px;stroke-linejoin:round`)
    group.append(path)
  }
  for (const set of drawable.sets) {
    const d = generator.opsToPath(set)
    if (!d) continue
    const path = item.element.ownerDocument.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    // Inline styles, because Mermaid's own sheet paints `.node path` and would fill these strokes in.
    if (set.type === 'path') {
      // This module's own outline replaces rough.js's, which is still asked for the fill.
      if (item.outline) continue
      path.setAttribute('style', `fill:none;stroke:${item.stroke};stroke-width:${item.width}px;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:${item.dash.length ? item.dash.join(' ') : 'none'}`)
      for (const [name, value] of item.markers) path.setAttribute(name, value)
    } else if (set.type === 'fillPath') {
      path.setAttribute('style', `fill:${item.fill};stroke:none`)
    } else {
      path.setAttribute('style', `fill:none;stroke:${item.fill};stroke-width:${drawable.options.fillWeight}px;stroke-linecap:round;stroke-dasharray:none`)
    }
    group.append(path)
  }
  const pen = (d: string, width: number) => {
    const path = item.element.ownerDocument.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('style', `fill:none;stroke:${item.stroke};stroke-width:${width.toFixed(2)}px;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:${item.dash.length ? item.dash.join(' ') : 'none'}`)
    group.append(path)
    return path
  }
  if (item.outline) { const path = pen(item.outline, item.width); for (const [name, value] of item.markers) path.setAttribute(name, value) }
  if (item.inner) pen(item.inner, Math.max(0.8, item.width * 0.42))
  if (grain) group.setAttribute('style', `filter:url(#${item.flat || item.thin ? grain.wide : grain.id})`)
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
function sketchMarker(marker: Element, stroke: string | null, width: number, solid = false): void {
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
  const d = solid
    // Inked in: a barbed head with a notch at the back, as a nib draws it.
    ? `M${wing(wings[0], 1.5)} L${tip[0]} ${tip[1]} L${wing(wings[1], 1.5)} Q${(tip[0] + (back - tip[0]) * 0.75).toFixed(2)} ${middle} ${wing(wings[0], 1.5)}Z`
    : `M${wing(wings[0], 1.55)} Q${bend(wings[0])} ${tip[0]} ${tip[1]} M${wing(wings[1], 1.4)} Q${bend(wings[1])} ${tip[0]} ${tip[1]} M${back.toFixed(2)} ${middle} L${tip[0]} ${tip[1]}`
  const room = MARKER_ROOM / scale
  marker.setAttribute('viewBox', `${vx - room} ${vy - room} ${vw + room * 2} ${vh + room * 2}`)
  marker.setAttribute('markerWidth', String(mw + MARKER_ROOM * 2))
  marker.setAttribute('markerHeight', String(mh + MARKER_ROOM * 2))
  const drawn = marker.ownerDocument.createElementNS(SVG_NS, 'path')
  drawn.setAttribute('d', d)
  const units = marker.getAttribute('markerUnits') === 'strokeWidth' ? 1 : width / scale
  drawn.setAttribute('style', `fill:${solid ? color : 'none'}!important;stroke:${color}!important;stroke-width:${units.toFixed(2)}px!important;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none!important`)
  path.replaceWith(drawn)
}

/**
 * The texture of the tool: the edge of each stroke is pushed about by noise and the stroke is worn thin in
 * places, a little for pencil lead and a lot for chalk. Two filters, because the usual one sizes itself by
 * the shape it is on and a straight line has no height: thin shapes take the one sized by the diagram.
 */
function addGrain(svg: Element, kind: 'pencil' | 'chalk'): { id: string; wide: string } | null {
  const base = (svg.getAttribute('id') ?? 'mino').replace(/[^\w-]/g, '')
  const id = `${base}-grain`, wide = `${base}-grain-wide`
  const [frequency, push, wear, keep] = kind === 'chalk' ? [0.85, 2.2, -2.3, 1.8] : [1.2, 1.1, -1.1, 1.42]
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const region = box.length === 4 && box.every(Number.isFinite) ? `x="${box[0] - 20}" y="${box[1] - 20}" width="${box[2] + 40}" height="${box[3] + 40}"` : 'x="-2000" y="-2000" width="8000" height="8000"'
  const steps = `<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="2" seed="4" result="noise"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="noise" scale="${push}" xChannelSelector="R" yChannelSelector="G" result="pushed"/>`
    + `<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${wear} 0 0 0 ${keep}" result="worn"/>`
    + '<feComposite in="pushed" in2="worn" operator="in"/>'
  const defs = svg.ownerDocument.createElementNS(SVG_NS, 'defs')
  defs.innerHTML = `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%">${steps}</filter><filter id="${wide}" filterUnits="userSpaceOnUse" ${region}>${steps}</filter>`
  if (!defs.querySelector('filter')) return null
  svg.prepend(defs)
  return { id, wide }
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
    const id = flowNodeName(node)
    if (!id) return
    for (const edge of edges) {
      const ends = edgeEnds(edge)
      if (!ends || !(ends.startsWith(`${id}_`) || ends.endsWith(`_${id}`)) || strokes.has(edge)) continue
      strokes.set(edge, pen)
      ownMarkers(svg, edge, `-pen${index}`)
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
  const hand = palette.hand ?? MARKER
  const fills = new Map<Element, string>(), strokes = new Map<Element, string>()
  const turn = (list: readonly string[], index: number) => list[index % list.length]
  const ownShapes = (group: Element, kind: string) => Array.from(group.querySelectorAll(SHAPES)).filter((shape) => shape.closest(kind) === group)
  if (palette.fills.length) {
    Array.from(svg.querySelectorAll('g.node')).forEach((node, index) => {
      for (const shape of ownShapes(node, 'g.node')) {
        if (colorHex(getComputedStyle(shape).fill) !== palette.plain) continue
        // Chalk draws the node in its color; the others fill it.
        if (hand.coloredOutline) { strokes.set(shape, turn(palette.fills, index)); if (hand.fill !== 'none') fills.set(shape, turn(palette.fills, index)) } else fills.set(shape, turn(palette.fills, index))
      }
    })
    // A sequence diagram draws each participant at the top and again at the bottom: both take one color.
    const actors = new Map<string, number>()
    for (const actor of Array.from(svg.querySelectorAll('rect.actor'))) {
      const name = actor.getAttribute('name') ?? String(actors.size)
      if (!actors.has(name)) actors.set(name, actors.size)
      if (colorHex(getComputedStyle(actor).fill) !== palette.plain) continue
      const pen = turn(palette.fills, actors.get(name)!)
      if (hand.coloredOutline) { strokes.set(actor, pen); if (hand.fill !== 'none') fills.set(actor, pen) } else fills.set(actor, pen)
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
  for (const marker of markers) { const line = carrier.get(marker.getAttribute('id') ?? ''); sketchMarker(marker, line?.stroke ?? null, line?.width ?? 1.5, hand.solidArrows) }
  const grain = hand.grain === 'none' ? null : addGrain(svg, hand.grain)
  // A filter over a whole diagram's worth of thin lines would be slow; past a point they go without the grain.
  let wide = 0
  for (const item of plans) replace(item, generator, palette.paper, grain && !((item.flat || item.thin) && ++wide > 80) ? grain : null)
  return plans.length
}
