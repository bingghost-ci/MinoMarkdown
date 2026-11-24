// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ZoomViewer } from '../src/app/components/ZoomViewer'
import { MAX_PINCH_ZOOM, MIN_PINCH_ZOOM, pinchedZoom } from '../src/app/pinchZoom'
import { readFileSync } from 'node:fs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

  it('keeps the opened diagram at its real width while it is zoomed', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const svg = '<svg width="100%" style="max-width: 640px;" viewBox="0 0 640 1000"><rect width="10" height="10"/></svg>'
    await act(async () => { root.render(createElement(ZoomViewer, { lightbox: { svg, alt: '', paper: '#fff' }, onClose: () => undefined, t: (text: string) => text })) })
    const drawing = () => container.querySelector<SVGSVGElement>('.zoom-viewer-diagram svg')!
    const opened = drawing()
    expect(opened.style.width).toBe('640px')
    // A zoom re-renders the viewer; the drawing must not be replaced by a fresh, unsized copy of its markup.
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!.click() })
    expect(drawing()).toBe(opened)
    expect(drawing().style.width).toBe('640px')
    await act(async () => { root.unmount() })
    container.remove()
  })
})
