// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no CSS object; the view only asks it whether the highlight API exists.
;(globalThis as { CSS?: unknown }).CSS ??= {}

// A stand-in for PDF.js: three pages whose drawing finishes when the test says so.
const engine = vi.hoisted(() => ({
  draws: [] as { page: number; scale: number; finish: () => void; cancelled: boolean }[],
  cleanups: [] as number[],
}))
vi.mock('../src/features/pdf/pdfEngine', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/features/pdf/pdfEngine')>()
  class TextLayer {
    textDivs: HTMLElement[] = []
    textContentItemsStr: string[] = []
    render() { return Promise.resolve() }
    cancel() {}
  }
  const page = (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale, convertToViewportPoint: (x: number, y: number) => [x, y] }),
    render: ({ viewport }: { viewport: { scale: number } }) => {
      let finish = () => undefined as void
      const draw = { page: number, scale: viewport.scale, finish: () => finish(), cancelled: false }
      engine.draws.push(draw)
      return { promise: new Promise<void>((resolve) => { finish = resolve }), cancel: () => { draw.cancelled = true } }
    },
    getTextContent: async () => ({ items: [] }),
    getAnnotations: async () => [],
    cleanup: () => { engine.cleanups.push(number) },
  })
  return {
    ...original,
    loadPdfLibrary: async () => ({ library: { TextLayer }, createWorker: () => null }),
    openPdf: async () => ({ numPages: 3, getPage: async (number: number) => page(number) }),
    closePdf: async () => undefined,
    pdfOutline: async () => [],
  }
})

// The observers and the pane width are the test's to drive.
const observers = { resize: [] as (() => void)[], intersect: [] as ((entries: { target: Element; isIntersecting: boolean }[]) => void)[] }
let paneWidth = 648
beforeEach(() => {
  engine.draws.length = 0
  engine.cleanups.length = 0
  observers.resize.length = 0
  observers.intersect.length = 0
  paneWidth = 648
  globalThis.ResizeObserver = class { constructor(callback: () => void) { observers.resize.push(callback) } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  globalThis.IntersectionObserver = class { constructor(callback: (entries: never[]) => void) { observers.intersect.push(callback as never) } observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } } as unknown as typeof IntersectionObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return paneWidth } })
})
afterEach(() => { vi.useRealTimers() })

const { default: PdfView, FIT_SETTLE_MS } = await import('../src/features/pdf/PdfView')

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const bridge = { source: { size: 1, read: async () => new Uint8Array(), readAsset: async () => new Uint8Array() }, loadPosition: async () => null, savePosition: () => undefined, register: () => undefined, onOutline: () => undefined, onPages: () => undefined, openLink: () => undefined, onStatus: () => undefined }
  await act(async () => { root.render(createElement(PdfView, { bridge, name: 'sample.pdf', dark: false, t: (text: string) => text })) })
  const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await settle(20)
  const pages = () => Array.from(container.querySelectorAll<HTMLElement>('.pdf-page'))
  /** Reports which pages are on screen through the newest observer, as the browser would after a layout. */
  const see = (onScreen: number[]) => act(async () => { observers.intersect.at(-1)!(pages().map((target, index) => ({ target, isIntersecting: onScreen.includes(index + 1) }))) })
  return { container, pages, see, settle, unmount: () => act(async () => { root.unmount(); container.remove() }) }
}

const finishAll = () => act(async () => { for (const draw of engine.draws) draw.finish(); await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('PDF view (T97)', () => {
  it('draws the pages near the screen and frees what a page decoded when it leaves', async () => {
    const view = await mount()
    expect(view.pages()).toHaveLength(3)
    await view.see([1])
    await view.settle(5)
    expect(engine.draws.map((draw) => draw.page).sort()).toEqual([1, 2])
    await finishAll()
    expect(view.pages()[0].querySelector('canvas')).not.toBeNull()
    expect(engine.cleanups).toEqual([])
    // Page 3 comes on screen and page 1 goes: page 1 is no longer near, so it is released and cleaned up.
    await view.see([3])
    await view.settle(5)
    expect(engine.cleanups).toEqual([1])
    expect(view.pages()[0].querySelector('canvas')).toBeNull()
    expect(view.pages()[1].querySelector('canvas')).not.toBeNull()
    await view.unmount()
    expect(engine.cleanups.sort()).toEqual([1, 2, 3])
  })

  it('keeps the page that is on screen until the same page is ready at the new size', async () => {
    const view = await mount()
    await view.see([1])
    await view.settle(5)
    await finishAll()
    const before = view.pages()[0].querySelector('canvas')!
    const width = before.width
    expect(width).toBeGreaterThan(0)
    engine.draws.length = 0
    // The pane narrows; once the width has settled the pages are laid out and drawn again.
    paneWidth = 448
    await act(async () => { observers.resize.at(-1)!() })
    await view.settle(FIT_SETTLE_MS + 40)
    await view.see([1])
    await view.settle(5)
    expect(engine.draws.length).toBeGreaterThan(0)
    // Still the old picture, stretched by CSS, and not cleared.
    expect(view.pages()[0].querySelector('canvas')).toBe(before)
    expect(before.width).toBe(width)
    await finishAll()
    const after = view.pages()[0].querySelector('canvas')!
    expect(after).not.toBe(before)
    expect(after.width).toBeLessThan(width)
    // The picture that was replaced gives its memory back.
    expect(before.width).toBe(0)
    expect(view.pages()[0].querySelectorAll('canvas')).toHaveLength(1)
    await view.unmount()
  })

  it('draws once for a burst of width changes', async () => {
    const view = await mount()
    await view.see([1])
    await view.settle(5)
    await finishAll()
    engine.draws.length = 0
    const scale = () => view.container.querySelector<HTMLElement>('.pdf-pages')!.style.getPropertyValue('--scale-factor')
    const initial = scale()
    for (let step = 1; step <= 10; step++) {
      paneWidth = 648 - step * 20
      await act(async () => { observers.resize.at(-1)!() })
      await view.settle(10)
    }
    // Nothing is laid out again while the width keeps changing.
    expect(scale()).toBe(initial)
    expect(engine.draws).toHaveLength(0)
    await view.settle(FIT_SETTLE_MS + 40)
    expect(scale()).not.toBe(initial)
    await view.see([1])
    await view.settle(5)
    // One drawing of each nearby page, at the final width.
    expect(engine.draws.map((draw) => draw.page).sort()).toEqual([1, 2])
    expect(new Set(engine.draws.map((draw) => draw.scale)).size).toBe(1)
    await view.unmount()
  })

  it('does not attach the page frames again when only the current page changes', async () => {
    const view = await mount()
    await view.see([1])
    await view.settle(5)
    const frames = view.pages()
    const set = vi.spyOn(Map.prototype, 'set')
    const registered = () => set.mock.calls.filter(([, value]) => value instanceof HTMLElement && value.classList.contains('pdf-page')).length
    // Typing a page number renders the view on every key press.
    const input = view.container.querySelector<HTMLInputElement>('.pdf-bar input')!
    for (const value of ['2', '3']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(input.value).toBe('3')
    expect(registered()).toBe(0)
    expect(view.pages()).toEqual(frames)
    set.mockRestore()
    await view.unmount()
  })
})
