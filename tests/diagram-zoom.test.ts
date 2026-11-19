// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { keepLegible, LEGIBLE_PX } from '../src/features/diagrams/mermaid'
import { MAX_PINCH_ZOOM, MIN_PINCH_ZOOM, pinchedZoom } from '../src/app/pinchZoom'
import { readFileSync } from 'node:fs'

describe('reading diagrams without squinting (T119)', () => {
  it('gives a diagram a least width at which its labels can be read', () => {
    const svg = '<svg id="d" width="100%" style="max-width: 1500px;" viewBox="0 0 1500 200"><g/></svg>'
    // 16 px labels may shrink to 13.5 px, and no further.
    expect(keepLegible(svg)).toBe('<svg id="d" width="100%" style="max-width: 1500px;min-width:1266px" viewBox="0 0 1500 200"><g/></svg>')
    // Labels set larger may shrink further before they are too small.
    expect(keepLegible(svg, 20)).toContain(`min-width:${Math.round(1500 * LEGIBLE_PX / 20)}px`)
    expect(keepLegible(svg, 10)).toContain('min-width:1500px')
    // Done once, and only to a drawing that states its width.
    expect(keepLegible(keepLegible(svg))).toBe(keepLegible(svg))
    expect(keepLegible('<svg viewBox="0 0 10 10"></svg>')).toBe('<svg viewBox="0 0 10 10"></svg>')
    expect(keepLegible('<p style="max-width: 9px">x</p>')).toBe('<p style="max-width: 9px">x</p>')
  })

  it('lets a printed page shrink the diagram to fit, since paper cannot scroll', () => {
    const css = readFileSync('src/features/reading/css.ts', 'utf8')
    expect(css).toContain('@media print{.mermaid-diagram{overflow:visible}.mermaid-diagram svg{min-width:0!important}}')
    expect(readFileSync('src/styles.css', 'utf8')).toContain('.mermaid-preview { display: flex; justify-content: safe center; overflow-x: auto;')
  })

  it('keeps a pinch within bounds and finds actual size again', () => {
    expect(pinchedZoom(1, 1.5)).toBe(1.5)
    expect(pinchedZoom(1, 100)).toBe(MAX_PINCH_ZOOM)
    expect(pinchedZoom(1, 0.001)).toBe(MIN_PINCH_ZOOM)
    // Close to 100% is 100%.
    expect(pinchedZoom(1.2, 1 / 1.17)).toBe(1)
    expect(pinchedZoom(0.9, 1.08)).toBe(1)
    expect(pinchedZoom(2, 0.75)).toBe(1.5)
  })
})
