// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorAdapter } from '../src/features/editor/EditorAdapter'
import { opensInReadingMode } from '../src/app/readingSettings'

// jsdom has no layout; ProseMirror's cursor and Crepe's widgets only need empty rectangles.
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect
document.elementFromPoint = () => null

const source = '# 标题\n\n第一段正文。\n\n- 列表项\n'

describe('reading mode', () => {
  it('opens saved files for reading, and new, recovered or unsaved documents for editing', () => {
    expect(opensInReadingMode(true, true, false)).toBe(true)
    expect(opensInReadingMode(true, false, false)).toBe(false)
    expect(opensInReadingMode(true, true, true)).toBe(false)
    expect(opensInReadingMode(false, true, false)).toBe(false)
  })

  it('blocks every adapter edit path and keeps the document, then edits again with history intact', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    let changes = 0
    const editor = new EditorAdapter(root, source, () => { changes++ })
    await editor.create()
    const before = editor.getMarkdown()
    editor.runCommand('rule')
    const afterEdit = editor.getMarkdown()
    expect(afterEdit).not.toBe(before)
    editor.setReadonly(true)
    const changesBefore = changes
    for (const command of ['bold', 'italic', 'quote', 'codeBlock', 'rule', 'bullet', 'heading2', 'undo'] as const) editor.runCommand(command)
    editor.runTextTransform('upper')
    editor.runTableCommand('insert')
    editor.setLink('https://example.com')
    editor.setImageAlt('x')
    editor.find('正文')
    editor.replaceAll('替换')
    editor.replaceCurrent('替换')
    expect(() => editor.insertFile(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }))).toThrow('READING_MODE')
    expect(root.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
    expect(editor.getMarkdown()).toBe(afterEdit)
    expect(changes).toBe(changesBefore)
    expect(editor.isReadonly()).toBe(true)
    editor.setReadonly(false)
    expect(root.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true')
    // Undo still reaches the edit made before reading mode, so the editor was not rebuilt.
    editor.runCommand('undo')
    expect(editor.getMarkdown()).toBe(before)
    await editor.destroy()
  })

  it('does not report the changes the editor makes while loading, in reading or editing mode, and reports the first real edit', async () => {
    // A closing list (or code block, or table) makes the editor append an empty paragraph, and every heading gets an ID: neither is an edit.
    const closing = source
    const settle = () => new Promise((resolve) => setTimeout(resolve, 450))
    for (const reading of [true, false]) {
      const root = document.createElement('div')
      document.body.append(root)
      let changes = 0
      const editor = new EditorAdapter(root, closing, () => { changes++ })
      editor.setReadonly(reading)
      await editor.create()
      if (reading) editor.setReadonly(true)
      await settle()
      expect(changes, `after load, reading=${reading}`).toBe(0)
      editor.setReadonly(false)
      await settle()
      expect(changes, `after leaving reading mode, reading=${reading}`).toBe(0)
      editor.runCommand('rule')
      await settle()
      expect(changes, `after an edit, reading=${reading}`).toBeGreaterThan(0)
      await editor.destroy()
      root.remove()
    }
  })
})
