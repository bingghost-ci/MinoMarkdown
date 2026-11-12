// @vitest-environment jsdom
import { act } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Counts how often each part of the app renders, by the element only that part creates.
const renders = vi.hoisted(() => ({ counts: new Map<string, number>() }))
const marks = ['document-sidebar', 'outline-panel', 'document-tabbar', 'app-status', 'ai-drawer', 'ai-turn ai-answer']
function counting<T extends (type: unknown, props: { className?: string } | null, ...rest: never[]) => unknown>(create: T): T {
  return ((type: unknown, props: { className?: string } | null, ...rest: never[]) => {
    const name = props?.className
    if (name && marks.includes(name)) renders.counts.set(name, (renders.counts.get(name) ?? 0) + 1)
    return create(type, props, ...rest)
  }) as T
}
vi.mock('react/jsx-dev-runtime', async (importOriginal) => { const original = await importOriginal<{ jsxDEV: never }>(); return { ...original, jsxDEV: counting(original.jsxDEV) } })
vi.mock('react/jsx-runtime', async (importOriginal) => { const original = await importOriginal<{ jsx: never; jsxs: never }>(); return { ...original, jsx: counting(original.jsx), jsxs: counting(original.jsxs) } })

// The assistant's backend, driven by the test: one streamed piece per call, as the events from Rust arrive.
const backend = vi.hoisted(() => ({ handlers: new Set<(payload: unknown) => void>(), requestId: '', finish: () => undefined as void }))
vi.mock('../src/app/previewSample', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/app/previewSample')>(),
  previewAiTransport: () => ({
    invoke: async (command: string, args?: { request?: { requestId: string } }) => {
      if (command === 'ai_chat') { backend.requestId = args!.request!.requestId; await new Promise<void>((resolve) => { backend.finish = resolve }) ; return undefined }
      return { enabled: true, consented: true, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: true, keys: { deepseek: true, openai: false, custom: false } }
    },
    listen: async (event: string, handler: (payload: unknown) => void) => { if (event === 'ai-stream') backend.handlers.add(handler); return () => { backend.handlers.delete(handler) } },
  }),
}))

import { APP_TEST_TIMEOUT, mountApp, type MountedApp } from './helpers/appHarness'

const count = (name: string) => renders.counts.get(name) ?? 0
const button = (app: MountedApp, label: string) => Array.from(app.container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)!
let app: MountedApp

describe('render scope (T95)', { timeout: APP_TEST_TIMEOUT }, () => {
  beforeAll(async () => {
    app = await mountApp('?ui-preview=editor&ui-settings=' + encodeURIComponent(JSON.stringify({ showSidebar: true, showOutline: true })))
    await app.until(() => app.container.querySelector('.outline-list button') && app.container.querySelector('.tree-entry'), 'the outline and the file tree')
  }, APP_TEST_TIMEOUT)

  it('shows every part it counts', () => {
    for (const name of ['document-sidebar', 'outline-panel', 'document-tabbar', 'app-status']) expect(count(name), name).toBeGreaterThan(0)
    expect(app.container.querySelectorAll('.outline-list button').length).toBeGreaterThan(0)
    expect(app.container.querySelectorAll('.tree-entry').length).toBeGreaterThan(0)
  })

  it('renders only the answer being written while an answer streams in', async () => {
    await act(async () => { button(app, 'AI 问书').click() })
    expect(app.container.querySelector('.ai-drawer')).not.toBeNull()
    await act(async () => { button(app, '要点').click() })
    await app.until(() => backend.requestId !== '', 'the question to be sent')
    const before = Object.fromEntries(marks.map((name) => [name, count(name)]))
    let text = ''
    for (let piece = 0; piece < 20; piece++) {
      text += `第 ${piece} 段。`
      await act(async () => { for (const handler of backend.handlers) handler({ requestId: backend.requestId, kind: 'delta', text: `第 ${piece} 段。` }) })
    }
    expect(app.container.querySelector('.ai-answer .ai-text')?.textContent).toBe(text)
    // The first piece clears the progress line through state, once; none of the others reaches the rest of the app.
    for (const name of ['document-sidebar', 'outline-panel', 'document-tabbar', 'app-status']) expect(count(name) - before[name], name).toBe(0)
    expect(count('ai-drawer') - before['ai-drawer']).toBeLessThanOrEqual(1)
    expect(count('ai-turn ai-answer') - before['ai-turn ai-answer']).toBeGreaterThanOrEqual(20)
    await act(async () => { backend.finish() })
    await app.until(() => app.container.querySelector('.ai-answer')?.getAttribute('data-status') === 'done', 'the answer to finish')
    // The finished answer is the streamed text, now held by the turn.
    expect(app.container.querySelector('.ai-answer')?.getAttribute('data-status')).toBe('done')
    expect(app.container.querySelector('.ai-answer .ai-text')?.textContent).toContain('第 19 段。')
  })

  it('keeps the file tree, the outline and the tabs still when the word count or the input method state changes', async () => {
    const editor = app.container.querySelector<HTMLElement>('.ProseMirror')!
    const before = Object.fromEntries(marks.map((name) => [name, count(name)]))
    // An input method starting and ending a word flips the toolbar's composing state twice.
    await act(async () => { editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
    await act(async () => { editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '字' })) })
    await app.settle(400)
    for (const name of ['document-sidebar', 'outline-panel', 'document-tabbar']) expect(count(name) - before[name], name).toBe(0)
  })

  it('still acts on current state through handlers whose identity no longer changes', async () => {
    // Hiding the outline and showing it again goes through `setSettings` held by a memo component.
    await act(async () => { button(app, '隐藏大纲').click() })
    expect(app.container.querySelector('.outline-panel')).toBeNull()
    const sidebarBefore = count('document-sidebar')
    await act(async () => { button(app, '隐藏文件栏').click() })
    expect(app.container.querySelector('.document-sidebar')).toBeNull()
    await act(async () => { button(app, '显示文件栏').click() })
    expect(app.container.querySelector('.document-sidebar')).not.toBeNull()
    expect(count('document-sidebar')).toBeGreaterThan(sidebarBefore)
    // A folder in the tree still opens and closes: the handler reads the tree as it is now, not as it was at mount.
    const folder = app.container.querySelector<HTMLButtonElement>('.tree-entry[aria-expanded]')
    if (folder) {
      const expanded = folder.getAttribute('aria-expanded')
      await act(async () => { folder.click() })
      await app.settle(50)
      expect(app.container.querySelector<HTMLButtonElement>('.tree-entry[aria-expanded]')?.getAttribute('aria-expanded')).not.toBe(expanded)
      await act(async () => { app.container.querySelector<HTMLButtonElement>('.tree-entry[aria-expanded]')!.click() })
      await app.settle(50)
      expect(app.container.querySelector<HTMLButtonElement>('.tree-entry[aria-expanded]')?.getAttribute('aria-expanded')).toBe(expanded)
    }
    await app.unmount()
  })
})
