// @vitest-environment jsdom
import rough from 'roughjs'
import { describe, expect, it } from 'vitest'
import { colorHex, handEllipse, handLine, handOutline, sketchDiagram, type SketchPalette } from '../src/features/diagrams/sketch'

const palette: SketchPalette = { fills: ['#ff8fb0', '#7fd6c0'], frames: ['#2f8f5f'], plain: '#dbe8ff', paper: '#ffffff' }

function draw(inner: string): SVGSVGElement {
  document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
  const svg = document.body.querySelector('svg')!
  sketchDiagram(svg, rough.generator(), palette)
  return svg
}
const node = (at: number, style = 'fill:#dbe8ff;stroke:#333333;stroke-width:1.6px') => `<g class="node"><rect x="${at}" y="0" width="120" height="50" style="${style}"/><text>开始</text></g>`
const styleOf = (path: Element) => path.getAttribute('style') ?? ''

describe('the sketch pass of hand-drawn diagrams (T115)', () => {
  it('reads written and computed colors alike', () => {
    expect(colorHex('rgb(255, 0, 16)')).toBe('#ff0010')
    expect(colorHex('rgba(1, 2, 3, 0.5)')).toBe('#010203')
    expect(colorHex('#ABC')).toBe('#aabbcc')
    for (const none of ['none', 'transparent', 'rgba(0, 0, 0, 0)', '', 'url(#x)', null]) expect(colorHex(none)).toBeNull()
  })

  it('redraws a node as hatching under an outline drawn by hand, and leaves its label', () => {
    const svg = draw(node(0))
    expect(svg.querySelector('rect')).toBeNull()
    const paths = Array.from(svg.querySelectorAll('g.node > g.mino-sketch > path'))
    expect(paths).toHaveLength(3)
    // A paper backing, so lines behind the node do not show through the hatching.
    expect(styleOf(paths[0])).toBe('fill:#ffffff;stroke:none')
    expect(styleOf(paths[1])).toContain('stroke:#ff8fb0')
    expect(styleOf(paths[2])).toContain('fill:none;stroke:#333333;stroke-width:1.60px')
    // One stroke round the box, in curves: no side is ruled.
    expect(paths[2].getAttribute('d')).toMatch(/^M[\d.-]+ [\d.-]+C/)
    expect(paths[2].getAttribute('d')!.match(/M/g)).toHaveLength(1)
    expect(svg.querySelector('text')?.textContent).toBe('开始')
  })

  it('gives neighbouring nodes different pens and keeps a color the document chose', () => {
    const svg = draw(node(0) + node(200) + node(400, 'fill:#ffee00;stroke:#333333'))
    const hatching = Array.from(svg.querySelectorAll('g.node')).map((group) => /stroke:(#[0-9a-f]{6})/.exec(styleOf(group.querySelectorAll('path')[1]))![1])
    expect(hatching).toEqual(['#ff8fb0', '#7fd6c0', '#ffee00'])
  })

  it('draws the same strokes every time', () => {
    const first = draw(node(0)).innerHTML
    expect(draw(node(0)).innerHTML).toBe(first)
  })

  it('keeps an edge on its ends and its arrowhead, and draws a dashed edge once', () => {
    const svg = draw('<path id="e1" d="M10 10 L200 80" marker-end="url(#m_flowchart-v2-pointEnd)" style="fill:none;stroke:#333333;stroke-width:1.6px"/><path d="M10 100 L200 100" style="fill:none;stroke:#333333;stroke-dasharray:7 4"/>')
    const [solid, dashed] = Array.from(svg.querySelectorAll('g.mino-sketch'))
    expect(solid.getAttribute('id')).toBe('e1')
    const line = solid.querySelector('path')!
    expect(solid.querySelectorAll('path')).toHaveLength(1)
    expect(line.getAttribute('marker-end')).toBe('url(#m_flowchart-v2-pointEnd)')
    expect(line.getAttribute('d')).toMatch(/^M10\.0 10\.0C/)
    expect(line.getAttribute('d')).toMatch(/ 200\.0 80\.0$/)
    expect(line.getAttribute('d')!.match(/M/g)).toHaveLength(1)
    expect(dashed.querySelector('path')!.getAttribute('d')!.match(/M/g)).toHaveLength(1)
    expect(styleOf(dashed.querySelector('path')!)).toContain('stroke-dasharray:7 4')
  })

  it('opens the wedge arrowhead into two strokes and keeps the ones that mean something', () => {
    const wedge = (id: string) => `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:#333333"/></marker>`
    const svg = draw(`<defs>${wedge('m_flowchart-v2-pointEnd')}${wedge('m_class-extensionEnd')}</defs>`)
    const [point, extension] = Array.from(svg.querySelectorAll('marker'))
    expect(point.querySelector('path')!.getAttribute('d')).not.toMatch(/z/i)
    expect(styleOf(point.querySelector('path')!)).toContain('fill:none!important;stroke:#333333!important')
    // The tip stays at the reference point; the box grows by the same margin on every side.
    expect([point.getAttribute('refX'), point.getAttribute('viewBox'), point.getAttribute('markerWidth')]).toEqual(['5', '-7.5 -7.5 25 25', '20'])
    expect(point.querySelector('path')!.getAttribute('d')).toContain('10 5')
    expect(extension.querySelector('path')!.getAttribute('d')).toBe('M 0 0 L 10 5 L 0 10 z')
  })

  it('leaves backgrounds without an outline alone, fills small shapes solid and frames subgraphs in color', () => {
    const svg = draw('<rect class="background" x="0" y="0" width="40" height="20" style="fill:#ffffff"/>'
      + '<circle cx="5" cy="5" r="6" style="fill:#333333;stroke:#333333"/>'
      + '<g class="cluster"><rect x="0" y="0" width="300" height="200" style="fill:#ffffff;stroke:#999999;stroke-dasharray:9 7"/></g>')
    expect(svg.querySelector('rect.background')).not.toBeNull()
    const [dot, frame] = Array.from(svg.querySelectorAll('g.mino-sketch'))
    expect(styleOf(dot.querySelector('path')!)).toBe('fill:#333333;stroke:none')
    expect(frame.querySelectorAll('path')).toHaveLength(1)
    expect(styleOf(frame.querySelector('path')!)).toContain('stroke:#2f8f5f')
  })

  it('draws by the hand it is given: a wash, a second line inside the box, inked arrowheads, the grain of the tool (T117)', () => {
    const base = { roughness: 1, twice: false, coloredOutline: false, grain: 'none', hatchGap: 5, hatchWeight: 0.8, inner: false, solidArrows: false, wobble: 1.5, overshoot: 0 } as const
    const sketch = (hand: object, inner = node(0)) => { document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" id="d1" viewBox="0 0 300 100">${inner}</svg>`; const svg = document.body.querySelector('svg')!; sketchDiagram(svg, rough.generator(), { ...palette, hand: hand as never }); return svg }
    // Marker over a wash: backing, the wash in the node's pen, one stroke of outline.
    const washed = Array.from(sketch({ ...base, fill: 'wash' }).querySelectorAll('g.node g.mino-sketch path'))
    expect(washed).toHaveLength(3)
    expect(styleOf(washed[1])).toBe('fill:#ff8fb0;stroke:#ff8fb0;stroke-width:3px;stroke-linejoin:round')
    expect(washed[2].getAttribute('d')!.match(/M/g)!.length).toBeLessThan(6)
    // A pen rules a thinner line inside the box and leaves it unfilled.
    const ruled = Array.from(sketch({ ...base, fill: 'none', inner: true }).querySelectorAll('g.node g.mino-sketch path'))
    expect(ruled.map((path) => /stroke-width:([\d.]+)px/.exec(styleOf(path))?.[1])).toEqual([undefined, '1.60', '0.80'])
    // Chalk draws the node in its color and adds its grain; thin shapes take the filter sized by the diagram.
    const chalk = sketch({ ...base, fill: 'none', coloredOutline: true, grain: 'chalk' }, node(0) + '<line x1="0" y1="90" x2="200" y2="90" style="stroke:#333333"/>')
    expect(styleOf(chalk.querySelectorAll('g.node g.mino-sketch path')[1])).toContain('stroke:#ff8fb0')
    expect(Array.from(chalk.querySelectorAll('filter')).map((filter) => filter.getAttribute('id'))).toEqual(['d1-grain', 'd1-grain-wide'])
    expect(chalk.querySelector('filter')!.innerHTML).toMatch(/^<feTurbulence[^>]*><\/feTurbulence><feDisplacementMap[^>]*><\/feDisplacementMap><feColorMatrix[^>]*><\/feColorMatrix><feComposite[^>]*><\/feComposite>$/)
    expect(Array.from(chalk.querySelectorAll('g.mino-sketch')).map((group) => group.getAttribute('style'))).toEqual(['filter:url(#d1-grain)', 'filter:url(#d1-grain-wide)'])
    // Inked arrowheads are closed and filled.
    const inked = sketch({ ...base, fill: 'none', solidArrows: true }, '<defs><marker id="m_flowchart-v2-pointEnd" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:#333333"/></marker></defs><path d="M0 0L80 40" marker-end="url(#m_flowchart-v2-pointEnd)" style="fill:none;stroke:#333333"/>')
    expect(inked.querySelector('marker path')!.getAttribute('d')).toMatch(/Z$/)
    expect(styleOf(inked.querySelector('marker path')!)).toContain('fill:#333333!important')
  })

  it('draws lines and boxes as a hand does: never ruled, never the same twice over, always the same for the same shape (T118)', () => {
    const box = [[0, 0], [120, 0], [120, 50], [0, 50]] as const
    const pen = { wobble: 1.5, overshoot: 0, twice: false }
    const outline = handOutline(box, 18, pen)
    expect(handOutline(box, 18, pen)).toBe(outline)
    expect(handOutline(box, 35, pen)).not.toBe(outline)
    // One stroke of curves: no straight side, and no corner exactly on the ruler's corner.
    expect(outline.match(/M/g)).toHaveLength(1)
    expect(outline).toMatch(/^M[\d.-]+ [\d.-]+(?:C[\d. -]+)+L[\d.-]+ [\d.-]+$/)
    expect(outline.startsWith('M0.0 0.0')).toBe(false)
    const strays = outline.match(/-?[\d.]+/g)!.map(Number)
    expect(Math.min(...strays)).toBeGreaterThan(-5)
    expect(Math.max(...strays)).toBeLessThan(125)
    // A pencil draws each side on its own, past the corners, and goes over the box twice.
    const pencil = handOutline(box, 18, { wobble: 1.5, overshoot: 4.5, twice: true })
    expect(pencil.match(/M/g)).toHaveLength(8)
    expect(Math.min(...pencil.match(/-?[\d.]+/g)!.map(Number))).toBeLessThan(-1)
    // Rounded corners make one unbroken curve.
    expect(handOutline(box, 18, pen, 8).match(/[ML]/g)).toEqual(['M'])
    // A circle closes by running over its own beginning.
    const circle = handEllipse(50, 50, 20, 20, 5, pen)
    expect(circle).toMatch(/^M[\d.-]+ [\d.-]+(?:C[\d. -]+)+$/)
    expect(handEllipse(50, 50, 20, 20, 5, pen)).toBe(circle)
    // A line keeps both its ends, whether given by its corners or by points along a curve.
    for (const sampled of [false, true]) {
      const line = handLine([[10, 10], [60, 12], [110, 40], [200, 80]], 9, pen, sampled)
      expect(line.startsWith('M10.0 10.0C'), String(sampled)).toBe(true)
      expect(line.endsWith(' 200.0 80.0'), String(sampled)).toBe(true)
      expect(line).not.toContain('L')
    }
  })

  it('writes only paths made of numbers', () => {
    const svg = draw(node(0) + '<polygon points="0,0 50,25 0,50" transform="translate(3,4)" style="fill:#dbe8ff;stroke:#333"/><ellipse cx="50" cy="50" rx="40" ry="20" style="fill:none;stroke:#333"/><line x1="0" y1="0" x2="90" y2="0" style="stroke:#333"/>')
    for (const path of Array.from(svg.querySelectorAll('g.mino-sketch path'))) {
      expect(path.getAttribute('d')).toMatch(/^[MLCQZ\d\s.,e-]+$/i)
      expect(styleOf(path)).not.toMatch(/url|expression|@import/)
    }
    expect(svg.querySelector('g.mino-sketch[transform="translate(3,4)"]')).not.toBeNull()
  })
})
