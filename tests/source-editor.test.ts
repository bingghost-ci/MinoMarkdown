// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { SourceEditor } from '../src/features/source/SourceEditor'

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: function* () { /* no rects */ } }
  Range.prototype.getClientRects = (() => empty) as never
  Range.prototype.getBoundingClientRect = (() => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })) as never
})

function create(text: string) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const onChange = vi.fn()
  const onSelect = vi.fn()
  const editor = new SourceEditor(parent, text, 'label', false, { onChange, onSelect })
  const view = EditorView.findFromDOM(parent) as EditorView
  return { editor, view, onChange, onSelect, parent }
}

describe('SourceEditor', () => {
  it('returns untouched text exactly and labels the editing surface', () => {
    const { editor, parent } = create('﻿a\r\nb')
    expect(editor.value).toBe('﻿a\r\nb')
    expect(parent.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('label')
    expect(parent.querySelector('.cm-lineNumbers')).not.toBeNull()
  })

  it('reports user edits and keeps the newline style', () => {
    const { editor, view, onChange } = create('a\r\nb')
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(editor.value).toBe('xa\r\nb')
  })

  it('does not report assignments as edits and ignores identical text', () => {
    const { editor, view, onChange } = create('a')
    const before = view.state
    editor.value = 'a'
    expect(view.state).toBe(before)
    editor.value = 'b\r\nc'
    expect(editor.value).toBe('b\r\nc')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps offsets aligned with the saved text in a CRLF file', () => {
    const text = 'one\r\ntwo\r\nthree'
    const { editor, onSelect } = create(text)
    const from = text.indexOf('three')
    editor.setSelectionRange(from, from + 5)
    expect(onSelect).toHaveBeenCalled()
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('three')
  })

  it('applies several replacements as one undo step without reporting an edit', () => {
    const text = 'a\r\nb\r\na'
    const { editor, view, onChange } = create(text)
    editor.replaceRanges([{ from: 0, to: 1, insert: 'X' }, { from: text.lastIndexOf('a'), to: text.length, insert: 'Y' }])
    expect(editor.value).toBe('X\r\nb\r\nY')
    expect(onChange).not.toHaveBeenCalled()
    undo(view)
    expect(editor.value).toBe(text)
  })

  it('toggles read-only', () => {
    const { editor, view } = create('a')
    editor.readOnly = true
    expect(view.state.readOnly).toBe(true)
    editor.readOnly = false
    expect(view.state.readOnly).toBe(false)
  })

  it('survives use after destroy', () => {
    const { editor } = create('a')
    editor.destroy()
    expect(() => { editor.readOnly = false }).not.toThrow()
  })

  it('switches highlighting without touching the text', () => {
    const { editor, onChange } = create('# a')
    editor.setDark(true)
    expect(editor.value).toBe('# a')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SourceEditor for text and source files (T84, T85)', () => {
  function plain(text: string, readOnly = false) {
    const parent = document.createElement('div')
    document.body.append(parent)
    const onChange = vi.fn()
    const editor = new SourceEditor(parent, text, 'label', false, { onChange, onSelect: vi.fn() }, 'plain', readOnly)
    return { editor, view: EditorView.findFromDOM(parent) as EditorView, onChange }
  }

  it('does not treat a text file as Markdown', async () => {
    const { language } = await import('@codemirror/language')
    const { view } = plain('# not a heading\n*not emphasis*\n')
    expect(view.state.facet(language)).toBeNull()
    expect(create('# heading\n').view.state.facet(language)?.name).toBe('markdown')
  })

  it('takes a language once it has loaded and keeps the text', async () => {
    const { language, LanguageDescription } = await import('@codemirror/language')
    const { languages } = await import('@codemirror/language-data')
    const { editor, view, onChange } = plain('{"a": 1}\n')
    editor.setLanguage(await LanguageDescription.matchFilename(languages, 'config.json')!.load())
    expect(view.state.facet(language)?.name).toBe('json')
    expect(editor.value).toBe('{"a": 1}\n')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens read-only for reading and unlocks for editing', () => {
    const { editor, view, onChange } = plain('第一行\r\n第二行\r\n', true)
    expect(view.state.readOnly).toBe(true)
    expect(view.contentDOM.getAttribute('aria-readonly')).toBe('true')
    editor.readOnly = false
    expect(view.state.readOnly).toBe(false)
    view.dispatch({ changes: { from: 0, insert: '序 ' }, userEvent: 'input.type' })
    expect(onChange).toHaveBeenCalledTimes(1)
    // The line that was not touched keeps its CRLF.
    expect(editor.value).toBe('序 第一行\r\n第二行\r\n')
  })
})
