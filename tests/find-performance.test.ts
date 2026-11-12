// @vitest-environment jsdom
import { act } from 'react'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { describe, expect, it, vi } from 'vitest'
import { EditorAdapter } from '../src/features/editor/EditorAdapter'
import { FIND_DECORATION_LIMIT, findKey, findPlugin, setFind } from '../src/features/editor/find'
import { findInText } from '../src/features/editor/findText'
import { APP_TEST_TIMEOUT, mountApp } from './helpers/appHarness'

const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' } } })
const documentWith = (matches: number) => schema.nodes.doc.create(null, Array.from({ length: matches / 10 }, () => schema.nodes.paragraph.create(null, schema.text('甲乙'.repeat(10)))))
const highlighted = (state: EditorState) => findKey.getState(state)!.decorations.find()

describe('find (T94)', { timeout: APP_TEST_TIMEOUT }, () => {
  it('keeps the search and its highlights through transactions that do not concern it', () => {
    let state = EditorState.create({ doc: documentWith(50), plugins: [findPlugin] })
    state = state.apply(setFind(state.tr, { query: '甲' }))
    const found = findKey.getState(state)!
    expect(found.matches).toHaveLength(50)
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)))
    expect(findKey.getState(moved)).toBe(found)
    // Asking for the match that is already current changes nothing either.
    expect(findKey.getState(moved.apply(setFind(moved.tr, { index: 0 })))).toBe(found)
    const stepped = findKey.getState(moved.apply(setFind(moved.tr, { index: 1 })))!
    expect(stepped.matches).toBe(found.matches)
    expect(stepped.decorations).not.toBe(found.decorations)
  })

  it('counts every match but highlights only those around the current one', () => {
    let state = EditorState.create({ doc: documentWith(6000), plugins: [findPlugin] })
    state = state.apply(setFind(state.tr, { query: '甲' }))
    expect(findKey.getState(state)!.matches).toHaveLength(6000)
    expect(highlighted(state)).toHaveLength(FIND_DECORATION_LIMIT)
    expect(findKey.getState(state)!.first).toBe(0)
    // Stepping inside the window keeps it; leaving it moves it around the new current match.
    state = state.apply(setFind(state.tr, { index: 1500 }))
    expect(findKey.getState(state)!.first).toBe(0)
    state = state.apply(setFind(state.tr, { index: 4000 }))
    const far = findKey.getState(state)!
    expect(far.first).toBe(3000)
    expect(highlighted(state)).toHaveLength(FIND_DECORATION_LIMIT)
    const active = highlighted(state).filter((decoration) => (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class.includes('find-match-active'))
    expect(active).toHaveLength(1)
    expect(active[0].from).toBe(far.matches[4000].from)
    // The last matches fill a whole window rather than a short one.
    state = state.apply(setFind(state.tr, { index: 5999 }))
    expect(findKey.getState(state)!.first).toBe(4000)
    // A document with few matches shows them all, and clearing the query clears the highlights.
    state = state.apply(setFind(state.tr, { query: '' }))
    expect(highlighted(state)).toHaveLength(0)
  })

  it('stops listing text matches at the limit it is given', () => {
    const text = 'ab'.repeat(100)
    expect(findInText(text, 'a')).toHaveLength(100)
    expect(findInText(text, 'a', undefined, 30)).toHaveLength(30)
    expect(findInText(text, 'a', undefined, 30).at(-1)).toEqual({ from: 58, to: 59 })
  })

  it('replaces every match and goes straight to a distant one in the real editor', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const paragraphs = 130
    const editor = new EditorAdapter(root, Array.from({ length: paragraphs }, () => '甲乙'.repeat(20)).join('\n\n'))
    await editor.create()
    expect(editor.find('甲')).toEqual({ current: 0, total: paragraphs * 20 })
    expect(root.querySelectorAll('.find-match').length).toBeLessThanOrEqual(FIND_DECORATION_LIMIT)
    expect(editor.findAt(2500)).toEqual({ current: 2500, total: 2600 })
    expect(root.querySelectorAll('.find-match-active')).toHaveLength(1)
    expect(editor.plainText().selected).toBe('甲')
    // Past the end wraps around, as repeated stepping does.
    expect(editor.findAt(2601).current).toBe(1)
    expect(editor.replaceAll('丙').total).toBe(0)
    const markdown = editor.getMarkdown()
    expect(markdown).not.toContain('甲')
    expect(markdown.match(/丙/g)).toHaveLength(paragraphs * 20)
    await editor.destroy()
    root.remove()
  })

  it('searches once after a burst of typing, and at once on Enter', async () => {
    const find = vi.spyOn(EditorAdapter.prototype, 'find')
    const app = await mountApp()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true })) })
    const input = app.container.querySelector<HTMLInputElement>('.find-bar input')!
    expect(input).not.toBeNull()
    const type = (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    find.mockClear()
    for (const value of ['编', '编辑', '编辑器', '编辑器已', '编辑器已就']) await type(value)
    expect(find).not.toHaveBeenCalled()
    await app.settle(200)
    expect(find.mock.calls.map(([query]) => query)).toEqual(['编辑器已就'])
    // Enter acts on what is typed now, not on what was last searched.
    find.mockClear()
    await type('标题')
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(find.mock.calls.map(([query]) => query)).toEqual(['标题'])
    await app.settle(200)
    expect(find).toHaveBeenCalledTimes(1)
    await app.unmount()
    find.mockRestore()
  })
})
