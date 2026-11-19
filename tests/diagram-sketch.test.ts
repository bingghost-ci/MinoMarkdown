// @vitest-environment jsdom
import rough from 'roughjs'
import { describe, expect, it } from 'vitest'
import { colorHex, sketchDiagram, type SketchPalette } from '../src/features/diagrams/sketch'

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

  it('redraws a node as hatching under an outline drawn twice, and leaves its label', () => {
    const svg = draw(node(0))
    expect(svg.querySelector('rect')).toBeNull()
    const paths = Array.from(svg.querySelectorAll('g.node > g.mino-sketch > path'))
    expect(paths).toHaveLength(3)
    // A paper backing, so lines behind the node do not show through the hatching.
    expect(styleOf(paths[0])).toBe('fill:#ffffff;stroke:none')
    expect(styleOf(paths[1])).toContain('stroke:#ff8fb0')
    expect(styleOf(paths[2])).toContain('fill:none;stroke:#333333;stroke-width:1.6px')
    // Two strokes: the outline starts twice.
    expect(paths[2].getAttribute('d')!.match(/M/g)!.length).toBeGreaterThanOrEqual(2)
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
    expect(line.getAttribute('d')).toMatch(/^M10 10 /)
    expect(line.getAttribute('d')).toMatch(/200 80$/)
    expect(line.getAttribute('d')!.match(/M/g)).toHaveLength(2)
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

  it('writes only paths made of numbers', () => {
    const svg = draw(node(0) + '<polygon points="0,0 50,25 0,50" transform="translate(3,4)" style="fill:#dbe8ff;stroke:#333"/><ellipse cx="50" cy="50" rx="40" ry="20" style="fill:none;stroke:#333"/><line x1="0" y1="0" x2="90" y2="0" style="stroke:#333"/>')
    for (const path of Array.from(svg.querySelectorAll('g.mino-sketch path'))) {
      expect(path.getAttribute('d')).toMatch(/^[MLCQZ\d\s.,e-]+$/i)
      expect(styleOf(path)).not.toMatch(/url|expression|@import/)
    }
    expect(svg.querySelector('g.mino-sketch[transform="translate(3,4)"]')).not.toBeNull()
  })
})
