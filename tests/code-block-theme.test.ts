// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorAdapter } from '../src/features/editor/EditorAdapter'
import './helpers/jsdomLayout'

// Crepe starts a code block's CodeMirror once the block comes on screen; here every block is on screen.
globalThis.IntersectionObserver = class {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
} as unknown as typeof IntersectionObserver

describe('code block theme', () => {
  // Crepe's default one-dark theme used to be merged into ours, which made code blocks dark editors: their
  // selection was CodeMirror's dark #233 on every light reading style.
  it('keeps code blocks out of CodeMirror dark mode, so the style selection color applies', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = new EditorAdapter(root, '```js\nconst a = 1\n```\n', () => {})
    await editor.create()
    const dom = root.querySelector('.cm-editor')
    expect(dom).not.toBeNull()
    const view = EditorView.findFromDOM(dom as HTMLElement)!
    expect(view.state.facet(EditorView.darkTheme)).toBe(false)
    await editor.destroy()
    root.remove()
  })
})
