import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import './jsdomLayout'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no media queries or observers either (layout is in jsdomLayout.ts); the app only needs them to exist.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= Observer as unknown as typeof IntersectionObserver
Element.prototype.scrollIntoView ??= () => undefined
Element.prototype.scrollTo ??= (() => undefined) as typeof Element.prototype.scrollTo

export type MountedApp = { root: Root; container: HTMLElement; settle: (ms?: number) => Promise<void>; /** Waits until `check` holds. Loading the editor takes as long as the machine is busy, so nothing here waits a fixed time for it. */ until: (check: () => unknown, what: string) => Promise<void>; unmount: () => Promise<void> }

/** A whole-app test loads the editor chunk and may share the machine with every other test file. */
export const APP_TEST_TIMEOUT = 60_000

/**
 * Renders the whole app as the browser preview does (no Tauri), for tests that count renders or listeners.
 * `search` is the page's query string, read once when the app's modules load: `?ui-preview=editor` gives the
 * development preview with its sample folder and assistant.
 */
export async function mountApp(search = ''): Promise<MountedApp> {
  window.history.replaceState(null, '', `/${search}`)
  const { App } = await import('../../src/app/App')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const settle = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  const until = async (check: () => unknown, what: string) => {
    const started = Date.now()
    while (!check()) {
      if (Date.now() - started > APP_TEST_TIMEOUT - 10_000) throw new Error(`timed out waiting for ${what}`)
      await settle(25)
    }
  }
  await act(async () => { root.render(createElement(App)) })
  await until(() => container.querySelector('.ProseMirror'), 'the editor')
  // Views derived from the document (outline, word count) follow 300 ms after the editor reports it is ready.
  await settle(400)
  return { root, container, settle, until, unmount: async () => { await act(async () => { root.unmount() }); container.remove() } }
}
