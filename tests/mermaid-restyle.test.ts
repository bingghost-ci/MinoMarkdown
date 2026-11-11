// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

// Mermaid needs real layout; this stand-in draws the text color it was configured with.
let configured: { themeVariables?: Record<string, unknown> } = {}
const render = vi.fn(async (_id: string, source: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg"><text fill="${String(configured.themeVariables?.primaryTextColor)}">${source}</text></svg>` }))
vi.mock('mermaid', () => ({ default: { initialize: (options: typeof configured) => { configured = options }, render } }))

const { renderMermaidPreview, restyleDiagrams } = await import('../src/features/diagrams/mermaid')
const { readingStyle } = await import('../src/features/reading/styles')

function draw(content: string): Promise<HTMLElement> {
  return new Promise((resolve) => {
    const immediate = renderMermaidPreview('mermaid', content, resolve)
    if (immediate) resolve(immediate)
  })
}

describe('restyling drawn diagrams', () => {
  it('redraws diagrams in the new style in place and leaves other elements alone', async () => {
    document.documentElement.dataset.theme = 'paper'
    const root = document.createElement('div')
    const diagram = await draw('graph TD\n A-->B')
    const placeholder = document.createElement('div')
    placeholder.className = 'mermaid-preview'
    root.append(diagram, placeholder)
    expect(diagram.innerHTML).toContain(readingStyle('paper').text)

    document.documentElement.dataset.theme = 'graphite'
    expect(await restyleDiagrams(root)).toBe(1)
    expect(root.firstElementChild).toBe(diagram)
    expect(diagram.innerHTML).toContain(readingStyle('graphite').text)
    expect(placeholder.innerHTML).toBe('')

    // Already in this style: nothing to do. Back to a style seen before: drawn from the cache.
    expect(await restyleDiagrams(root)).toBe(0)
    const calls = render.mock.calls.length
    expect(await restyleDiagrams(root, 'paper')).toBe(1)
    expect(render.mock.calls.length).toBe(calls)
    expect(diagram.innerHTML).toContain(readingStyle('paper').text)
  })
})
