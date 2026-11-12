// @vitest-environment jsdom
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createWordCounter, sameOutline } from '../src/features/document/derived'
import { EditorAdapter } from '../src/features/editor/EditorAdapter'
import { APP_TEST_TIMEOUT, mountApp } from './helpers/appHarness'

const source = '# 标题\n\n第一段正文。\n\n## 小节\n\n![图](https://example.com/a.png)\n'

describe('derived data (T93)', { timeout: APP_TEST_TIMEOUT }, () => {
  it('counts the whole text once while only the selection changes', async () => {
    const counted: string[] = []
    const counter = createWordCounter(async (text) => { counted.push(text); return text.length })
    expect(await counter('一二三四', null)).toEqual({ total: 4, selected: null })
    expect(await counter('一二三四', '二三')).toEqual({ total: 4, selected: 2 })
    expect(await counter('一二三四', '四')).toEqual({ total: 4, selected: 1 })
    expect(counted).toEqual(['一二三四', '二三', '四'])
    expect(await counter('一二三四五', null)).toEqual({ total: 5, selected: null })
    expect(counted.at(-1)).toBe('一二三四五')
  })

  it('tells an unchanged outline from a changed one', () => {
    const items = [{ level: 1, text: '标题', target: 0 }, { level: 2, text: '小节', target: 9 }]
    expect(sameOutline(items, items.map((item) => ({ ...item })))).toBe(true)
    expect(sameOutline(items, items.slice(0, 1))).toBe(false)
    expect(sameOutline(items, [items[0], { ...items[1], text: '改名' }])).toBe(false)
    expect(sameOutline(items, [items[0], { ...items[1], target: 10 }])).toBe(false)
    expect(sameOutline([], [])).toBe(true)
  })

  it('keeps what the editor derives from the document until the document changes', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = new EditorAdapter(root, source)
    await editor.create()
    const crepe = (editor as unknown as { crepe: { getMarkdown(): string } }).crepe
    const serialize = vi.spyOn(crepe, 'getMarkdown')
    const outline = editor.outline()
    const images = editor.referencedImageUrls()
    const markdown = editor.getMarkdown()
    expect(outline.map((item) => item.text)).toEqual(['标题', '小节'])
    expect([...images]).toEqual(['https://example.com/a.png'])
    // Moving the caret or selecting text replaces the selection, not the document.
    editor.find('正文')
    editor.findStep(1)
    editor.findStep(-1)
    expect(editor.plainText().selected).toBe('正文')
    expect(editor.outline()).toBe(outline)
    expect(editor.referencedImageUrls()).toBe(images)
    expect(editor.getMarkdown()).toBe(markdown)
    expect(editor.getMarkdown()).toBe(markdown)
    expect(serialize).toHaveBeenCalledTimes(1)
    editor.find('')
    editor.runCommand('rule')
    expect(editor.outline()).not.toBe(outline)
    expect(editor.getMarkdown()).not.toBe(markdown)
    expect(serialize).toHaveBeenCalledTimes(2)
    expect(editor.plainText().text).toBe(editor.plainText().text)
    await editor.destroy()
    root.remove()
  })

  it('subscribes to key presses once, however often the app renders', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const app = await mountApp()
    const keydowns = () => add.mock.calls.filter(([type]) => type === 'keydown').length
    const afterMount = keydowns()
    expect(afterMount).toBeGreaterThan(0)
    // Each of these changes state and renders the app again.
    for (const label of ['设置', '关闭']) {
      const button = Array.from(app.container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
      if (button) await act(async () => { button.click() })
    }
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await app.settle(350)
    expect(keydowns()).toBe(afterMount)
    await app.unmount()
    add.mockRestore()
  })
})
