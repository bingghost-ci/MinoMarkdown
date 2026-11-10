import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { detectLineEndings, offsetToPosition, positionToOffset, sourceDoc, sourceValue } from '../src/features/source/sourceText'

const roundTrip = (text: string) => { const endings = detectLineEndings(text); return sourceValue(sourceDoc(text, endings), endings) }

describe('source text fidelity', () => {
  it.each([
    ['LF', 'a\nb\n'],
    ['CRLF', 'a\r\nb\r\n'],
    ['CR', 'a\rb\r'],
    ['mixed', 'a\r\nb\nc\rd\r\n'],
    ['BOM', '﻿# 标题\r\n正文\r\n'],
    ['no trailing newline', 'a\r\nb'],
    ['only newlines', '\r\n\r\n'],
    ['empty', ''],
    ['emoji', '😀\r\n中文'],
  ])('keeps %s byte for byte', (_, text) => {
    expect(roundTrip(text)).toBe(text)
  })

  it('classifies line endings', () => {
    expect(detectLineEndings('a\nb')).toEqual({ eol: '\n', mixed: false })
    expect(detectLineEndings('a\r\nb')).toEqual({ eol: '\r\n', mixed: false })
    expect(detectLineEndings('a\rb')).toEqual({ eol: '\r', mixed: false })
    expect(detectLineEndings('a\r\nb\nc')).toEqual({ eol: '\n', mixed: true })
  })

  it('keeps the file newline style after an edit', () => {
    const text = 'a\r\nb\r\n'
    const endings = detectLineEndings(text)
    const state = EditorState.create({ doc: sourceDoc(text, endings) })
    const edited = state.update({ changes: { from: 1, insert: 'x\ny' } }).state
    expect(sourceValue(edited.doc, endings)).toBe('ax\r\ny\r\nb\r\n')
  })

  it('leaves untouched lines of a mixed file alone after an edit', () => {
    const text = 'a\r\nb\nc'
    const endings = detectLineEndings(text)
    const state = EditorState.create({ doc: sourceDoc(text, endings), extensions: EditorState.lineSeparator.of('\n') })
    const edited = state.update({ changes: { from: 0, insert: 'x' } }).state
    expect(sourceValue(edited.doc, endings)).toBe('xa\r\nb\nc')
  })

  it('maps saved-text offsets to editor positions and back', () => {
    const text = '第一\r\n\r\nabc\r\n'
    const endings = detectLineEndings(text)
    const doc = sourceDoc(text, endings)
    for (const needle of ['第一', 'abc']) {
      const offset = text.indexOf(needle)
      const position = offsetToPosition(doc, offset, endings)
      expect(doc.sliceString(position, position + needle.length)).toBe(needle)
      expect(positionToOffset(doc, position, endings)).toBe(offset)
    }
    expect(offsetToPosition(doc, text.length + 50, endings)).toBe(doc.length)
  })

  it('uses offsets unchanged for LF files', () => {
    const endings = detectLineEndings('a\nb')
    const doc = sourceDoc('a\nb', endings)
    expect(offsetToPosition(doc, 2, endings)).toBe(2)
    expect(positionToOffset(doc, 2, endings)).toBe(2)
    expect(offsetToPosition(doc, 99, endings)).toBe(3)
  })
})
