// @vitest-environment jsdom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { APP_TEST_TIMEOUT, mountApp } from './helpers/appHarness'

// The query string is read once, when the app's modules load. The preview opens a sample document, which a new
// tab does not replace as it would an empty one.
const preview = '?ui-preview=editor'

describe('app shell', { timeout: APP_TEST_TIMEOUT }, () => {
  it('mounts in the browser preview with one document in the editor', async () => {
    const app = await mountApp(preview)
    expect(app.container.querySelector('.app-shell')).not.toBeNull()
    expect(app.container.querySelectorAll('.document-tab')).toHaveLength(1)
    expect(app.container.querySelectorAll('.ProseMirror')).toHaveLength(1)
    await app.unmount()
  })

  it('lets go of a background tab\'s editor as soon as the tab closes (T96)', async () => {
    const app = await mountApp(preview)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true })) })
    await app.until(() => app.container.querySelectorAll('.ProseMirror').length === 2, 'the new tab\'s editor')
    expect(app.container.querySelectorAll('.document-tab')).toHaveLength(2)
    // The first document's editor stays alive behind the new tab.
    expect(app.container.querySelectorAll('.ProseMirror')).toHaveLength(2)
    const background = app.container.querySelector<HTMLElement>('.document-tab[aria-selected="false"] .tab-close')!
    await act(async () => { background.click() })
    await app.until(() => app.container.querySelectorAll('.document-tab').length === 1, 'the tab to close')
    await app.settle(50)
    expect(app.container.querySelectorAll('.ProseMirror')).toHaveLength(1)
    await app.unmount()
  })
})
