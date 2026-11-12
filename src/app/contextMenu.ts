/**
 * Right-click menus (T105). These functions only describe a menu from item ids; `show_context_menu` in
 * `context_menu.rs` labels it in the menu language and shows it natively, and the chosen id comes back as
 * `context-action`. Every id must be in `CONTEXT_ITEMS` there or be a main-menu id.
 */
import type { DocumentKind } from '../features/document/kinds'

export type MenuEntry =
  | { type: 'item'; id: string; enabled: boolean }
  | { type: 'separator' }
  | { type: 'submenu'; id: string; items: MenuEntry[] }

const item = (id: string, enabled = true): MenuEntry => ({ type: 'item', id, enabled })
const separator: MenuEntry = { type: 'separator' }
const submenu = (id: string, items: MenuEntry[]): MenuEntry => ({ type: 'submenu', id, items: tidy(items) })

/** Drops separators at either end or next to another, and empty submenus. */
export function tidy(entries: MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'submenu' && entry.items.length === 0) continue
    if (entry.type === 'separator' && (kept.length === 0 || kept[kept.length - 1].type === 'separator')) continue
    kept.push(entry)
  }
  while (kept.length && kept[kept.length - 1].type === 'separator') kept.pop()
  return kept
}

/** Where in the document area the click was. */
export type BodyView = 'visual' | 'preview' | 'source' | 'pdf'

export type BodyContext = {
  view: BodyView
  kind: DocumentKind
  /** False in reading mode and in read-only views. */
  editable: boolean
  selection: boolean
  /** The address of a link under the pointer. */
  link: string | null
  /** The document has a file on disk (not a new, unsaved one). */
  saved: boolean
  /** The AI assistant is turned on. */
  ai: boolean
  /** At least one folder is open in the sidebar. */
  folders: boolean
}

const inlineFormats = ['format-bold', 'format-italic', 'format-strike', 'format-inline-code']
const paragraphItems = () => [
  item('format-paragraph'), item('format-heading1'), item('format-heading2'), item('format-heading3'), item('format-heading4'), separator,
  item('format-quote'), item('format-bullet'), item('format-ordered'), item('format-task'), item('format-code-block'),
]
const transformItems = () => ['transform-upper', 'transform-lower', 'transform-title', 'transform-cjk-spacing', 'transform-full-punct', 'transform-half-punct'].map((id) => item(id))

/** The file part every document menu ends with. */
function fileItems(saved: boolean): MenuEntry[] {
  return [item('reveal', saved), item('copy-path', saved), item('rename', saved), item('trash', saved)]
}

function exportItems(kind: DocumentKind): MenuEntry[] {
  if (kind === 'pdf') return []
  return kind === 'markdown' ? [item('export-md'), item('export-text'), separator, item('export-html'), item('print')] : [item('export-html'), item('print')]
}

/**
 * With text selected the menu is about that text: clipboard, formatting, finding it and asking about it.
 * Without a selection it is about the place clicked and the document: pasting, inserting, view and file.
 */
export function bodyMenu(context: BodyContext): MenuEntry[] {
  const { view, kind, editable, selection, link, saved, ai, folders } = context
  const visualEditing = view === 'visual' && editable
  const textEditing = view === 'source' && editable
  if (selection) {
    const asking = editable ? ['ai-explain', 'ai-translate', 'ai-rewrite', 'ai-continue'] : ['ai-explain', 'ai-translate']
    return tidy([
      ...(editable && view !== 'pdf' && view !== 'preview' ? [item('cut'), item('copy'), item('paste')] : [item('copy')]),
      ...(view === 'visual' ? [item('copy-markdown'), item('copy-plain')] : []),
      separator,
      ...(visualEditing ? [
        submenu('format', [...inlineFormats.map((id) => item(id)), separator, item('format-link'), separator, item('format-clear')]),
        submenu('paragraph', paragraphItems()),
        submenu('transform', transformItems()),
        separator,
      ] : []),
      ...(link ? [item('open-link'), item('copy-link'), separator] : []),
      item('find-selection'),
      ...(folders ? [item('search-folder')] : []),
      separator,
      ...(ai ? [submenu('ai', asking.map((id) => item(id)))] : []),
    ])
  }
  return tidy([
    ...(link ? [item('open-link'), item('copy-link'), ...(visualEditing ? [item('edit-link')] : []), separator] : []),
    ...(visualEditing ? [item('paste'), item('paste-plain'), item('select-all'), separator] : textEditing ? [item('paste'), item('select-all'), separator] : []),
    ...(visualEditing ? [
      submenu('paragraph', paragraphItems()),
      submenu('insert', [item('insert-table'), item('insert-rule'), item('format-code-block'), item('format-link')]),
      separator,
    ] : []),
    item('find'),
    ...(ai ? [item('ai-ask')] : []),
    separator,
    ...(kind === 'pdf' ? [] : [item('toggle-reading')]),
    ...(kind === 'markdown' ? [item('toggle-source')] : []),
    separator,
    ...(kind === 'pdf' ? [] : [item('save'), item('save-as')]),
    submenu('export', exportItems(kind)),
    separator,
    ...fileItems(saved),
    separator,
    item('close-tab'),
  ])
}

export type TabContext = { index: number; count: number; saved: boolean; active: boolean; kind: DocumentKind }

export function tabMenu({ index, count, saved, active, kind }: TabContext): MenuEntry[] {
  return tidy([
    ...(active && kind !== 'pdf' ? [item('save'), separator] : []),
    ...fileItems(saved),
    separator,
    item('move-window'),
    separator,
    item('close'),
    item('close-others', count > 1),
    item('close-right', index < count - 1),
    item('close-all'),
  ])
}

export type EntryContext = { directory: boolean; root: boolean; roots: number }

/** A file, folder or open root folder in the sidebar. */
export function entryMenu({ directory, root, roots }: EntryContext): MenuEntry[] {
  if (!directory) return tidy([item('open-entry'), separator, item('reveal'), item('copy-path'), separator, item('rename'), item('trash')])
  return tidy([
    item('new-file'), item('new-folder'), item('refresh'),
    separator,
    item('reveal'), item('copy-path'),
    separator,
    ...(root ? [item('close-folder'), ...(roots > 1 ? [item('close-all-folders')] : [])] : [item('rename'), item('trash')]),
  ])
}

/** Every item id in a menu, submenus included; used by the tests to compare with the Rust list. */
export function menuIds(entries: MenuEntry[]): string[] {
  return entries.flatMap((entry) => entry.type === 'item' ? [entry.id] : entry.type === 'submenu' ? [entry.id, ...menuIds(entry.items)] : [])
}
