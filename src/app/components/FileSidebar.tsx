import type { DocumentWorkspace } from '../useDocumentWorkspace'
import { ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderPlus, MoreHorizontal, Pencil, RefreshCw, Trash2, X, PanelLeftClose } from 'lucide-react'
import { PaneResizer } from './PaneResizer'
import { PANE_MAX, SIDEBAR_MIN } from '../readingSettings'
import type { WorkspaceEntry } from '../useDocumentWorkspace'
import { translateStatus } from '../i18n'

export function FileSidebar({ workspace: w }: { workspace: DocumentWorkspace }) {
  const { openSearchHit, runWorkspaceSearch, searchQuery, searchState, setSearchQuery, chooseWorkspace, closeWorkspace, createEntry, desktop, document, loadChildren, newEntryName, newEntryType, openWorkspaceEntry, renameEntry, renameName, renaming, selectedEntry, setNewEntryName, setNewEntryType, setRenameName, setRenaming, setSelectedDirectory, setSelectedEntry, settings, sidebarOpen, sidebarRoot, t, toggleDirectory, trashEntry, tree, workspace } = w
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
      {state.entries.map((entry) => <div key={entry.token}>
        <button type="button" role="treeitem" data-tree-item aria-level={depth + 1} aria-expanded={entry.directory ? (tree[entry.token]?.expanded ?? false) : undefined} aria-selected={document.entryToken === entry.token || selectedEntry?.token === entry.token} className="tree-entry" style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => { setSelectedEntry({ ...entry, parentToken: token }); setSelectedDirectory(entry.directory ? entry.token : token); if (entry.directory) toggleDirectory(entry.token); else void openWorkspaceEntry(entry.token) }} onKeyDown={(event) => treeKeyDown(event, entry)}>
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
        {sidebarOpen && <aside id="document-sidebar" ref={sidebarRoot} className="document-sidebar" aria-label={t('文件浏览器')} style={{ width: settings.sidebarWidth }}>
          <PaneResizer edge="right" width={settings.sidebarWidth} min={SIDEBAR_MIN} max={PANE_MAX} fallback={230} label={t('调整文件栏宽度')} onCommit={(sidebarWidth) => w.setSettings((current) => ({ ...current, sidebarWidth }))} />
          <div className="sidebar-heading"><h2>{t('文件')}</h2><button type="button" className="icon-button" title={t('隐藏文件栏')} aria-label={t('隐藏文件栏')} onClick={() => w.setSettings((current) => ({ ...current, showSidebar: false }))}><PanelLeftClose aria-hidden="true" /></button></div>
          {!workspace && <div className="sidebar-open"><button type="button" onClick={() => void chooseWorkspace()} disabled={!desktop}>{t('打开文件夹')}</button></div>}
          {workspace && <>
            <div className="tree-header"><ChevronDown aria-hidden="true" /><strong title={workspace.name}>{workspace.name}</strong><button type="button" className="icon-button" onClick={() => void loadChildren(workspace.token)} title={t('刷新目录')} aria-label={t('刷新目录')}><RefreshCw aria-hidden="true" /></button></div>
            <div className="workspace-search" role="search"><input type="search" aria-label={t('搜索文件夹')} placeholder={t('搜索文件夹')} value={searchQuery}
              onChange={(event) => { setSearchQuery(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) runWorkspaceSearch(event.target.value) }}
              onCompositionEnd={(event) => runWorkspaceSearch(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { setSearchQuery(''); runWorkspaceSearch('') } }} /></div>
            {searchQuery.trim()
              ? <div className="search-results" aria-label={t('搜索结果')}>
                {searchState.searching && <p className="tree-note" role="status">{t('正在搜索…')}</p>}
                {searchState.error && <p className="tree-note" role="alert">{translateStatus(searchState.error, settings.language)}</p>}
                {searchState.results && !searchState.searching && searchState.results.hits.length === 0 && <p className="tree-note">{t('没有找到匹配内容')}</p>}
                {searchState.results?.hits.map((hit) => <button key={`${hit.token}-${hit.occurrence}`} type="button" className="search-hit" title={hit.path} onClick={() => void openSearchHit(hit)}><strong>{hit.name}<small>:{hit.line}</small></strong><span>{hit.snippet}</span></button>)}
                {searchState.results?.truncated && <p className="tree-note">{t('结果过多，只显示前 500 条')}</p>}
                {Boolean(searchState.results?.skipped) && <p className="tree-note">{t('部分文件因过大、编码或权限被跳过')}</p>}
              </div>
              : <div role="tree" aria-label={t('文件夹目录')} className="file-tree">{renderChildren(workspace.token)}</div>}
            <div className="tree-actions"><button type="button" onClick={() => { setNewEntryType('file'); setNewEntryName('新文档.md') }}><FilePlus2 aria-hidden="true" />{t('新建文档')}</button><details className="tree-action-menu"><summary aria-label={t('目录操作')} title={t('目录操作')}><MoreHorizontal aria-hidden="true" /></summary><div className="tree-action-popup">
              <button type="button" onClick={() => { setNewEntryType('directory'); setNewEntryName('新目录') }}><FolderPlus aria-hidden="true" />{t('新建目录')}</button>
              <button type="button" disabled={!selectedEntry} onClick={() => { setRenameName(selectedEntry?.name ?? ''); setRenaming(true) }}><Pencil aria-hidden="true" />{t('重命名')}</button>
              <button type="button" disabled={!selectedEntry} onClick={() => void trashEntry()}><Trash2 aria-hidden="true" />{t('移到废纸篓')}</button>
              <div className="menu-separator" />
              <button type="button" onClick={() => void closeWorkspace()}><X aria-hidden="true" />{t('关闭文件夹')}</button>
            </div></details></div>
            {newEntryType && <div className="tree-form"><label>{t(newEntryType === 'file' ? '文件名' : '目录名')}<input value={newEntryName} onChange={(event) => setNewEntryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createEntry(); if (event.key === 'Escape') setNewEntryType(null) }} /></label><button type="button" onClick={() => void createEntry()}>{t('创建')}</button><button type="button" onClick={() => setNewEntryType(null)}>{t('取消')}</button></div>}
            {renaming && <div className="tree-form"><label>{t('新名称')}<input value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameEntry(); if (event.key === 'Escape') setRenaming(false) }} /></label><button type="button" onClick={() => void renameEntry()}>{t('确定')}</button><button type="button" onClick={() => setRenaming(false)}>{t('取消')}</button></div>}
          </>}
        </aside>}
  </>
}
