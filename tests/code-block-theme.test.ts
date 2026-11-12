// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorAdapter } from '../src/features/editor/EditorAdapter'

// jsdom has no layout; ProseMirror's cursor and Crepe's widgets only need empty rectangles.
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect
document.elementFromPoint = () => null
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
