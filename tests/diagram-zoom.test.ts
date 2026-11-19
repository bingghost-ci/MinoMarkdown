// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { MAX_PINCH_ZOOM, MIN_PINCH_ZOOM, pinchedZoom } from '../src/app/pinchZoom'
import { readFileSync } from 'node:fs'

describe('reading diagrams without squinting (T119)', () => {
  it('fits a diagram to its column and to the page, with nothing to scroll sideways', () => {
    const page = readFileSync('src/features/reading/css.ts', 'utf8')
    expect(page).toContain('.mermaid-diagram svg{max-width:100%;height:auto}')
    expect(page).not.toMatch(/\.mermaid-diagram\{[^}]*overflow/)
    const app = readFileSync('src/styles.css', 'utf8')
    expect(app).toContain('.mermaid-preview svg { min-width: 0; max-width: 100%; height: auto; }')
    expect(app).not.toMatch(/\.mermaid-preview \{[^}]*overflow/)
    expect(app).not.toContain('.mermaid-preview::-webkit-scrollbar')
    // The drawing itself carries no least width either.
    expect(readFileSync('src/features/diagrams/mermaid.ts', 'utf8')).not.toContain('min-width')
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
