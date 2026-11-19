// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { layBoard, recolorEdge, roundCorners } from '../src/features/diagrams/dress'
import { diagramTone } from '../src/features/diagrams/looks'
import { washPath } from '../src/features/diagrams/sketch'

const mount = (inner: string, attributes = 'viewBox="0 0 200 100" style="max-width: 200px;"') => { document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${inner}</svg>`; return document.body.querySelector('svg')! }

describe('finishing the looks Mermaid cannot draw (T117)', () => {
  it('lays a board under the diagram and widens the diagram to hold it', () => {
    const svg = mount('<g class="root"/>')
    layBoard(svg, diagramTone('white', { look: 'ink' }), 22)
    expect(svg.getAttribute('viewBox')).toBe('-20 -20 240 140')
    expect(svg.getAttribute('style')).toContain('max-width: 240px')
    const board = svg.firstElementChild!
    expect(board.getAttribute('class')).toBe('mino-board')
    expect(board.querySelector('rect')!.getAttribute('style')).toContain(`fill:${diagramTone('white', { look: 'ink' }).panel}`)
    // Squared paper: a ruling of straight lines only, kept inside the board.
    const ruling = board.querySelector('path')!.getAttribute('d')!
    expect(ruling).toMatch(/^(?:M-?[\d.]+ -?[\d.]+[VH]-?[\d.]+)+$/)
    expect(ruling).toContain('M2 -13V113')
  })

  it('lays no board for a look drawn on the page, and no ruling on a plain board', () => {
    const page = mount('<g/>')
    layBoard(page, diagramTone('white', { look: 'page' }), 22)
    expect(page.getAttribute('viewBox')).toBe('0 0 200 100')
    expect(page.querySelector('.mino-board')).toBeNull()
    const cards = mount('<g/>')
    layBoard(cards, diagramTone('white', { look: 'program' }))
    expect(cards.querySelector('.mino-board rect')).not.toBeNull()
    expect(cards.querySelector('.mino-board path')).toBeNull()
  })

  it('rounds the corners of an edge of straight pieces and keeps its ends', () => {
    expect(roundCorners('M0,0L0,40L60,40', 8)).toBe('M0 0L0 32Q0 40 8 40L60 40')
    expect(roundCorners('M0 0 V40 H60', 8)).toBe('M0 0L0 32Q0 40 8 40L60 40')
    // A short piece gets a corner no larger than half of it.
    expect(roundCorners('M0 0 V6 H60', 8)).toBe('M0 0L0 3Q0 6 3 6L60 6')
    for (const kept of ['M0 0 C10 0 20 10 30 10', 'M0 0 L10 10', 'M0 0 A5 5 0 0 1 10 10', '']) expect(roundCorners(kept, 8)).toBe(kept)
  })

  it('gives an edge a color and an arrowhead of its own, leaving the shared one', () => {
    const svg = mount('<defs><marker id="m.end"><path d="M0 0L10 5L0 10z" style="fill:#333333"/></marker></defs><path id="a" d="M0 0L9 9" marker-end="url(#m.end)"/><path id="b" d="M0 0L9 9" marker-end="url(#m.end)"/>')
    recolorEdge(svg, svg.querySelector('#a')!, '#d9532b', 1.9)
    recolorEdge(svg, svg.querySelector('#b')!, '#d9532b')
    expect(svg.querySelector('#a')!.getAttribute('style')).toBe('stroke:#d9532b!important;stroke-width:1.9px!important')
    expect(svg.querySelector('#a')!.getAttribute('marker-end')).toBe('url(#m.end-cd9532b)')
    const markers = Array.from(svg.querySelectorAll('marker'))
    // One copy serves both edges.
    expect(markers.map((marker) => marker.getAttribute('id'))).toEqual(['m.end', 'm.end-cd9532b'])
    expect(markers[1].querySelector('path')!.getAttribute('style')).toContain('fill:#d9532b!important;stroke:#d9532b!important')
    expect(markers[0].querySelector('path')!.getAttribute('style')).toBe('fill:#333333')
  })

  it('makes a wash the same every time, set off from the shape it fills', () => {
    const box = [[0, 0], [100, 0], [100, 40], [0, 40]] as const
    const wash = washPath(box, 18)
    expect(washPath(box, 18)).toBe(wash)
    expect(washPath(box, 35)).not.toBe(wash)
    expect(wash).toMatch(/^M[\d.-]+ [\d.-]+(?:Q[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+){4}Z$/)
    const numbers = wash.match(/-?[\d.]+/g)!.map(Number)
    // Down and to the right of the box, by a few pixels at most.
    expect(Math.max(...numbers)).toBeLessThan(108)
    expect(Math.min(...numbers)).toBeGreaterThan(-1)
    expect(washPath(box, 18, true)).toMatch(/^M[^Z]+Z$/)
  })
})
