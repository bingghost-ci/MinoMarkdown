import { memo, useRef, useState } from 'react'
import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { pick } from '../stable'
import { ChevronDown, ChevronRight, FilePlus2, FolderOpen, FileText, Folder, FolderPlus, MoreHorizontal, Pencil, RefreshCw, Trash2, X, PanelLeftClose } from 'lucide-react'
import { PaneResizer } from './PaneResizer'
import { PANE_MAX, SIDEBAR_MIN } from '../readingSettings'
import type { WorkspaceEntry } from '../useDocumentWorkspace'
import { translateStatus } from '../i18n'

const fileSidebarKeys = ['openEntryMenu', 'openRootMenu', 'openSearchHit', 'runWorkspaceSearch', 'searchQuery', 'searchState', 'setSearchQuery', 'chooseWorkspace', 'closeWorkspace', 'createEntry', 'desktop', 'activeEntryToken', 'loadChildren', 'moveEntry', 'newEntryName', 'newEntryType', 'openWorkspaceEntry', 'renameEntry', 'renameName', 'renaming', 'selectedEntry', 'setNewEntryName', 'setNewEntryType', 'setRenameName', 'setRenaming', 'setSelectedDirectory', 'selectedDirectory', 'setSelectedEntry', 'updateSettings', 'settings', 'sidebarOpen', 't', 'toggleDirectory', 'trashEntry', 'tree', 'workspaces'] as const satisfies readonly (keyof DocumentWorkspace)[]

/** Renders again only when something it reads changes, not on every render of the app (T95). */
export function FileSidebar({ workspace }: { workspace: DocumentWorkspace }) {
  return <FileSidebarView {...pick(workspace, fileSidebarKeys)} />
}

const FileSidebarView = memo(function FileSidebarView(w: Pick<DocumentWorkspace, (typeof fileSidebarKeys)[number]>) {
  const { openEntryMenu, openRootMenu, openSearchHit, runWorkspaceSearch, searchQuery, searchState, setSearchQuery, chooseWorkspace, closeWorkspace, createEntry, desktop, activeEntryToken, loadChildren, moveEntry, newEntryName, newEntryType, openWorkspaceEntry, renameEntry, renameName, renaming, selectedEntry, setNewEntryName, setNewEntryType, setRenameName, setRenaming, setSelectedDirectory, selectedDirectory, setSelectedEntry, settings, sidebarOpen, t, toggleDirectory, trashEntry, tree, workspaces } = w
  // Dragging an entry onto a folder or an open folder's header moves it there (T109). Pointer events, not HTML
  // drag and drop, which the window hands to Finder-style file drops. A drop on a file means its folder.
  type Drag = { entry: WorkspaceEntry & { parentToken: string }; x: number; y: number; active: boolean }
  const dragRef = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const hover = useRef<{ token: string; timer: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  function dropTokenAt(x: number, y: number, drag: Drag): string | null {
    const element = window.document.elementFromPoint(x, y)
    // Not into itself or anything inside it, and not where it already is.
    if (!element || element.closest(`[data-tree-branch="${CSS.escape(drag.entry.token)}"]`)) return null
    const token = element.closest<HTMLElement>('[data-drop-token]')?.dataset.dropToken ?? null
    return token && token !== drag.entry.parentToken ? token : null
  }
  function endDrag() {
    dragRef.current = null
    if (hover.current) window.clearTimeout(hover.current.timer)
    hover.current = null
    setDragging(null)
    setDropTarget(null)
  }
  function startDrag(event: React.PointerEvent<HTMLButtonElement>, entry: WorkspaceEntry, parentToken: string) {
    suppressClick.current = false
    if (event.button === 0 && !renaming) dragRef.current = { entry: { ...entry, parentToken }, x: event.clientX, y: event.clientY, active: false }
  }
  // Moves and the release are followed on the whole tree, since a quick drag leaves the row it started on.
  const treeDragHandlers = {
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return
        if (!(event.buttons & 1)) { dragRef.current = null; return }
        drag.active = true
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Still tracked while over the tree. */ }
        setDragging(drag.entry.token)
      }
      const target = dropTokenAt(event.clientX, event.clientY, drag)
      setDropTarget(target)
      // Resting on a closed folder opens it, so an entry can go several levels down in one drag.
      const folder = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-folder-token]')?.dataset.folderToken ?? null
      if (hover.current?.token === folder) return
      if (hover.current) window.clearTimeout(hover.current.timer)
      hover.current = folder && folder === target && !tree[folder]?.expanded ? { token: folder, timer: window.setTimeout(() => { if (dragRef.current?.active) toggleDirectory(folder) }, 700) } : null
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag?.active) { dragRef.current = null; return }
      const target = dropTokenAt(event.clientX, event.clientY, drag)
      suppressClick.current = true
      endDrag()
      if (target) void moveEntry(drag.entry, target)
    },
    onPointerCancel: endDrag,
    onKeyDownCapture: (event: React.KeyboardEvent) => { if (event.key === 'Escape' && dragRef.current?.active) { event.preventDefault(); endDrag() } },
  }

  function treeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, entry: WorkspaceEntry) {
    if (event.key === 'ArrowRight' && entry.directory) { event.preventDefault(); if (!tree[entry.token]?.expanded) toggleDirectory(entry.token) }
    if (event.key === 'ArrowLeft' && entry.directory) { event.preventDefault(); if (tree[entry.token]?.expanded) toggleDirectory(entry.token) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = Array.from(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('[data-tree-item]') ?? [])
      const index = items.indexOf(event.currentTarget)
      items[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
    }
  }

  function renderChildren(token: string, depth = 0): React.ReactNode {
    const state = tree[token]
    if (!state?.expanded) return null
    return <div role="group">
      {state.entries.map((entry) => <div key={entry.token} data-tree-branch={entry.token}>
        <button type="button" role="treeitem" data-tree-item onPointerDown={(event) => startDrag(event, entry, token)} data-drop-token={entry.directory ? entry.token : token} data-folder-token={entry.directory ? entry.token : undefined} data-dragging={dragging === entry.token || undefined} data-drop-target={entry.directory && dropTarget === entry.token || undefined} aria-level={depth + 1} aria-expanded={entry.directory ? (tree[entry.token]?.expanded ?? false) : undefined} aria-selected={activeEntryToken === entry.token || selectedEntry?.token === entry.token} className="tree-entry" onContextMenu={(event) => openEntryMenu(entry, token, event)} style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } setSelectedEntry({ ...entry, parentToken: token }); setSelectedDirectory(entry.directory ? entry.token : token); if (entry.directory) toggleDirectory(entry.token); else void openWorkspaceEntry(entry.token) }} onKeyDown={(event) => treeKeyDown(event, entry)}>
          <span className="tree-chevron" aria-hidden="true">{entry.directory ? tree[entry.token]?.expanded ? <ChevronDown /> : <ChevronRight /> : null}</span>
          {entry.directory ? <Folder className="tree-icon" aria-hidden="true" /> : <FileText className="tree-icon" aria-hidden="true" />}
          <span className="tree-name">{entry.name}</span>
        </button>
        {entry.directory && renderChildren(entry.token, depth + 1)}
      </div>)}
      {state.loading && state.entries.length === 0 && <p className="tree-note">{t('正在读取…')}</p>}
      {state.error && <p className="tree-note" role="alert">{translateStatus(state.error, settings.language)}<button type="button" onClick={() => void loadChildren(token, state.entries.length)}>{t('重试')}</button></p>}
      {state.nextOffset !== null && !state.loading && <button type="button" className="tree-more" onClick={() => void loadChildren(token, state.nextOffset ?? 0)}>{t('加载更多')}</button>}
    </div>
  }

  return <>
        {sidebarOpen && <aside id="document-sidebar" className="document-sidebar" aria-label={t('文件浏览器')} style={{ width: settings.sidebarWidth }}>
          <PaneResizer edge="right" width={settings.sidebarWidth} min={SIDEBAR_MIN} max={PANE_MAX} fallback={230} label={t('调整文件栏宽度')} onCommit={(sidebarWidth) => w.updateSettings({ sidebarWidth })} />
          <div className="sidebar-heading" data-tauri-drag-region><h2 data-tauri-drag-region>{t('文件')}</h2>{workspaces.length > 0 && <button type="button" className="icon-button" title={t('再打开一个文件夹')} aria-label={t('再打开一个文件夹')} onClick={() => void chooseWorkspace()} disabled={!desktop}><FolderOpen aria-hidden="true" /></button>}<button type="button" className="icon-button" title={t('隐藏文件栏')} aria-label={t('隐藏文件栏')} onClick={() => w.updateSettings({ showSidebar: false })}><PanelLeftClose aria-hidden="true" /></button></div>
          {workspaces.length === 0 && <div className="sidebar-open"><button type="button" onClick={() => void chooseWorkspace()} disabled={!desktop}>{t('打开文件夹')}</button></div>}
          {workspaces.length > 0 && <>
            <div className="workspace-search" role="search"><input type="search" aria-label={t('搜索文件夹')} placeholder={t('搜索文件夹')} value={searchQuery}
              onChange={(event) => { setSearchQuery(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) runWorkspaceSearch(event.target.value) }}
              onCompositionEnd={(event) => runWorkspaceSearch(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { setSearchQuery(''); runWorkspaceSearch('') } }} /></div>
            {searchQuery.trim()
              ? <div className="search-results" aria-label={t('搜索结果')}>
                {searchState.searching && <p className="tree-note" role="status">{t('正在搜索…')}</p>}
                {searchState.error && <p className="tree-note" role="alert">{translateStatus(searchState.error, settings.language)}</p>}
                {searchState.results && !searchState.searching && searchState.results.hits.length === 0 && <p className="tree-note">{t('没有找到匹配内容')}</p>}
                {searchState.results?.hits.map((hit) => <button key={`${hit.token}-${hit.occurrence}`} type="button" className="search-hit" title={hit.path} onClick={() => void openSearchHit(hit)}><strong>{hit.name}<small>:{hit.line}{workspaces.length > 1 && hit.root ? ` · ${hit.root}` : ''}</small></strong><span>{hit.snippet}</span></button>)}
                {searchState.results?.truncated && <p className="tree-note">{t('结果过多，只显示前 500 条')}</p>}
                {Boolean(searchState.results?.skipped) && <p className="tree-note">{t('部分文件因过大、编码或权限被跳过')}</p>}
              </div>
              : <div role="tree" aria-label={t('文件夹目录')} className="file-tree" data-dragging={dragging !== null || undefined} {...treeDragHandlers}>{workspaces.map((root) => {
                const open = tree[root.token]?.expanded ?? false
                return <div key={root.token} className="tree-root">
                  <div className="tree-header" data-drop-token={root.token} data-drop-target={dropTarget === root.token || undefined} data-selected={selectedDirectory === root.token && !selectedEntry || undefined} onContextMenu={(event) => openRootMenu(root.token, event)}>
                    <button type="button" className="tree-root-name" aria-expanded={open} title={root.name} onClick={() => { setSelectedEntry(null); setSelectedDirectory(root.token); toggleDirectory(root.token) }}>{open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<strong>{root.name}</strong></button>
                    <button type="button" className="icon-button" onClick={() => void loadChildren(root.token)} title={t('刷新目录')} aria-label={t('刷新目录')}><RefreshCw aria-hidden="true" /></button>
                    <button type="button" className="icon-button" onClick={() => void closeWorkspace(root.token)} title={t('关闭这个文件夹')} aria-label={`${t('关闭这个文件夹')} ${root.name}`}><X aria-hidden="true" /></button>
                  </div>
                  {renderChildren(root.token)}
                </div>
              })}</div>}
            <div className="tree-actions"><button type="button" onClick={() => { setNewEntryType('file'); setNewEntryName('新文档.md') }}><FilePlus2 aria-hidden="true" />{t('新建文档')}</button><details className="tree-action-menu"><summary aria-label={t('目录操作')} title={t('目录操作')}><MoreHorizontal aria-hidden="true" /></summary><div className="tree-action-popup">
              <button type="button" onClick={() => { setNewEntryType('directory'); setNewEntryName('新目录') }}><FolderPlus aria-hidden="true" />{t('新建目录')}</button>
              <button type="button" disabled={!selectedEntry} onClick={() => { setRenameName(selectedEntry?.name ?? ''); setRenaming(true) }}><Pencil aria-hidden="true" />{t('重命名')}</button>
              <button type="button" disabled={!selectedEntry} onClick={() => void trashEntry()}><Trash2 aria-hidden="true" />{t('移到废纸篓')}</button>
              <div className="menu-separator" />
              <button type="button" onClick={() => void closeWorkspace()}><X aria-hidden="true" />{t(workspaces.length > 1 ? '关闭全部文件夹' : '关闭文件夹')}</button>
            </div></details></div>
            {newEntryType && <div className="tree-form"><label>{t(newEntryType === 'file' ? '文件名' : '目录名')}<input value={newEntryName} onChange={(event) => setNewEntryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createEntry(); if (event.key === 'Escape') setNewEntryType(null) }} /></label><button type="button" onClick={() => void createEntry()}>{t('创建')}</button><button type="button" onClick={() => setNewEntryType(null)}>{t('取消')}</button></div>}
            {renaming && <div className="tree-form"><label>{t('新名称')}<input value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameEntry(); if (event.key === 'Escape') setRenaming(false) }} /></label><button type="button" onClick={() => void renameEntry()}>{t('确定')}</button><button type="button" onClick={() => setRenaming(false)}>{t('取消')}</button></div>}
          </>}
    </aside>}
  </>
})
