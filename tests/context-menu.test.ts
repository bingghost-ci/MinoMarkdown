import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bodyMenu, entryMenu, menuIds, tabMenu, tidy, type BodyContext, type MenuEntry } from '../src/app/contextMenu'
import { beginSave, createSession, discardChanges, editSession, isDirty } from '../src/features/document/session'

const contextRust = readFileSync('src-tauri/src/context_menu.rs', 'utf8')
const labels = readFileSync('src-tauri/src/native_menu.rs', 'utf8')
const contextItems = [...contextRust.slice(contextRust.indexOf('pub const CONTEXT_ITEMS'), contextRust.indexOf('];', contextRust.indexOf('pub const CONTEXT_ITEMS'))).matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1])
const mainItems = [...labels.slice(labels.indexOf('pub const MENU_ITEMS'), labels.indexOf('];', labels.indexOf('pub const MENU_ITEMS'))).matchAll(/\("([a-z0-9-]+)"/g)].map((match) => match[1])
const allowed = new Set([...contextItems, ...mainItems, 'format', 'transform'])

const base: BodyContext = { view: 'visual', kind: 'markdown', editable: true, selection: false, link: null, saved: true, ai: false, folders: false }
const enabled = (entries: MenuEntry[], id: string) => {
  for (const entry of entries) {
    if (entry.type === 'item' && entry.id === id) return entry.enabled
    if (entry.type === 'submenu') { const found = enabled(entry.items, id); if (found !== undefined) return found }
  }
  return undefined
}

describe('right-click menus (T105)', () => {
  const kinds = ['markdown', 'text', 'code', 'pdf'] as const
  const views = ['visual', 'preview', 'source', 'pdf'] as const
  const every: MenuEntry[][] = []
  for (const kind of kinds) for (const view of views) for (const editable of [true, false]) for (const selection of [true, false]) for (const link of [null, 'https://example.com']) for (const flag of [true, false]) {
    every.push(bodyMenu({ view, kind, editable, selection, link, saved: flag, ai: flag, folders: flag }))
  }
  for (const [index, count] of [[0, 1], [0, 3], [2, 3]]) for (const saved of [true, false]) every.push(tabMenu({ index, count, saved, active: index === 0, kind: 'markdown' }))
  for (const directory of [true, false]) for (const root of [true, false]) every.push(entryMenu({ directory, root, roots: 2 }))

  it('uses only ids Rust knows and labels in both languages', () => {
    const ids = new Set(every.flatMap(menuIds))
    for (const id of ids) {
      expect(allowed.has(id), id).toBe(true)
      expect(labels, id).toContain(`("${id}", true)`)
      expect(labels, id).toContain(`("${id}", false)`)
    }
    // Every context-only id is used by some menu.
    for (const id of contextItems) expect(ids.has(id), id).toBe(true)
  })

  it('never starts or ends with a separator, doubles one, or leaves a submenu empty', () => {
    const check = (entries: MenuEntry[]) => {
      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0].type).not.toBe('separator')
      expect(entries[entries.length - 1].type).not.toBe('separator')
      entries.forEach((entry, i) => {
        if (entry.type === 'separator') expect(entries[i - 1].type).not.toBe('separator')
        if (entry.type === 'submenu') check(entry.items)
      })
    }
    every.forEach(check)
    expect(tidy([{ type: 'separator' }, { type: 'submenu', id: 'ai', items: [] }, { type: 'separator' }])).toEqual([])
  })

  it('is about the selected text when there is one', () => {
    const ids = menuIds(bodyMenu({ ...base, selection: true, ai: true, folders: true }))
    expect(ids.slice(0, 3)).toEqual(['cut', 'copy', 'paste'])
    for (const id of ['copy-markdown', 'copy-plain', 'format', 'format-bold', 'format-clear', 'paragraph', 'transform', 'find-selection', 'search-folder', 'ai', 'ai-rewrite']) expect(ids).toContain(id)
    // No file actions get between the user and the text.
    for (const id of ['trash', 'rename', 'close-tab', 'save']) expect(ids).not.toContain(id)
  })

  it('offers nothing that changes the document while reading', () => {
    const ids = menuIds(bodyMenu({ ...base, editable: false, selection: true, ai: true }))
    expect(ids[0]).toBe('copy')
    for (const id of ['cut', 'paste', 'format', 'paragraph', 'ai-rewrite', 'ai-continue']) expect(ids).not.toContain(id)
    expect(ids).toContain('ai-explain')
    const plain = menuIds(bodyMenu({ ...base, editable: false }))
    for (const id of ['paste', 'paste-plain', 'insert', 'select-all']) expect(plain).not.toContain(id)
  })

  it('offers pasting, inserting, the view and the file without a selection', () => {
    const ids = menuIds(bodyMenu(base))
    for (const id of ['paste', 'paste-plain', 'select-all', 'insert-table', 'insert-rule', 'toggle-reading', 'toggle-source', 'save', 'export-md', 'export-pdf', 'print', 'reveal', 'copy-path', 'rename', 'trash', 'close-tab']) expect(ids).toContain(id)
    expect(ids).not.toContain('ai-ask')
    expect(menuIds(bodyMenu({ ...base, ai: true }))).toContain('ai-ask')
  })

  it('fits each kind of document', () => {
    const text = menuIds(bodyMenu({ ...base, view: 'source', kind: 'code' }))
    for (const id of ['toggle-source', 'export-md', 'paste-plain', 'format']) expect(text).not.toContain(id)
    expect(text).toContain('export-html')
    const pdf = menuIds(bodyMenu({ ...base, view: 'pdf', kind: 'pdf', editable: false }))
    for (const id of ['save', 'save-as', 'export', 'toggle-reading', 'toggle-source', 'paste']) expect(pdf).not.toContain(id)
    for (const id of ['reveal', 'trash', 'close-tab']) expect(pdf).toContain(id)
  })

  it('handles links and unsaved documents', () => {
    const linked = menuIds(bodyMenu({ ...base, link: 'https://example.com' }))
    expect(linked.slice(0, 3)).toEqual(['open-link', 'copy-link', 'edit-link'])
    const unsaved = bodyMenu({ ...base, saved: false })
    for (const id of ['reveal', 'copy-path', 'rename', 'trash']) expect(enabled(unsaved, id)).toBe(false)
  })

  it('closes tabs only where there are tabs to close', () => {
    const only = tabMenu({ index: 0, count: 1, saved: true, active: true, kind: 'markdown' })
    expect(enabled(only, 'close-others')).toBe(false)
    expect(enabled(only, 'close-right')).toBe(false)
    expect(enabled(tabMenu({ index: 0, count: 3, saved: true, active: true, kind: 'markdown' }), 'close-right')).toBe(true)
    expect(enabled(tabMenu({ index: 2, count: 3, saved: true, active: false, kind: 'markdown' }), 'close-right')).toBe(false)
    expect(menuIds(tabMenu({ index: 2, count: 3, saved: true, active: false, kind: 'markdown' }))).not.toContain('save')
  })

  it('offers files, folders and open folders their own actions', () => {
    expect(menuIds(entryMenu({ directory: false, root: false, roots: 1 }))).toEqual(['open-entry', 'reveal', 'copy-path', 'rename', 'trash'])
    expect(menuIds(entryMenu({ directory: true, root: false, roots: 1 }))).toEqual(['new-file', 'new-folder', 'refresh', 'reveal', 'copy-path', 'rename', 'trash'])
    expect(menuIds(entryMenu({ directory: true, root: true, roots: 1 }))).toEqual(['new-file', 'new-folder', 'refresh', 'reveal', 'copy-path', 'close-folder'])
    expect(menuIds(entryMenu({ directory: true, root: true, roots: 2 }))).toContain('close-all-folders')
  })

  it('registers its commands and routes its items apart from the main menu', () => {
    const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
    for (const command of ['show_context_menu', 'reveal_in_finder', 'copy_file_path', 'write_clipboard_text', 'rename_document', 'trash_document']) expect(lib).toContain(`context_menu::${command}`)
    expect(lib).toContain('strip_prefix(context_menu::PREFIX)')
  })
})

describe('discarding changes (T105)', () => {
  it('leaves nothing dirty, except while a save is running', () => {
    const edited = editSession(editSession(createSession(1, 'disk')))
    expect(isDirty(discardChanges(edited))).toBe(false)
    const { session: saving } = beginSave(edited)
    expect(discardChanges(saving)).toBe(saving)
  })
})
