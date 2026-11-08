import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { exit } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { listen } from '@tauri-apps/api/event'
import { ArrowDown, ArrowUp, Bold, ChevronDown, ChevronRight, Code2, Download, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Image as ImageIcon, Italic, Link2, List, ListOrdered, Minus, MoreHorizontal, PanelLeft, Pencil, Plus, Printer, Quote, Redo2, RefreshCw, RemoveFormatting, Save, Strikethrough, Table2, Trash2, Undo2, X, type LucideIcon } from 'lucide-react'
import { compareMarkdown } from '../core/markdown/compatibility'
import { composeVisualMarkdown, prepareMarkdown, type PreparedMarkdown } from '../core/markdown/codec'
import { EditorAdapter, type EditorCommand, type PendingAsset, type ToolbarState } from '../features/editor/EditorAdapter'
import { safeLinkHref } from '../features/editor/linkSafety'
import { beginSave, clearExternalConflict, createSession, editSession, externalConflict, isDirty, saveCanceled, saveFailed, saveSucceeded, type DocumentSession } from '../features/document/session'
import { mayLeaveDocument, type UnsavedAction } from '../features/document/lifecycle'
import { renderHtml } from '../features/export/renderHtml'
import { printHtml } from '../features/export/printHtml'
import { imageUrlsIn, localAssetPath, rewriteImageUrls } from '../features/export/snapshot'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'
import basic from '../../tests/fixtures/markdown/F01-basic.md?raw'
import lists from '../../tests/fixtures/markdown/F02-lists.md?raw'
import code from '../../tests/fixtures/markdown/F03-code.md?raw'
import links from '../../tests/fixtures/markdown/F04-links.md?raw'
import table from '../../tests/fixtures/markdown/F05-table.md?raw'

const spikeDocument = '# MinoMarkdown 编辑验证\n\n请在这里输入中文、英文和 Markdown。\n\n选中这段文字，再用顶部工具栏尝试加粗和撤销。\n'
const samples = [
  { id: 'intro', label: '输入验证', markdown: spikeDocument },
  { id: 'F01', label: 'F01 标题与文字', markdown: basic },
  { id: 'F02', label: 'F02 列表与引用', markdown: lists },
  { id: 'F03', label: 'F03 代码与转义', markdown: code },
  { id: 'F04', label: 'F04 链接与图片', markdown: links },
  { id: 'F05', label: 'F05 表格', markdown: table },
] as const
const toolbarItems: { command: EditorCommand; label: string; icon: LucideIcon; primary?: boolean }[] = [
  { command: 'bold', label: '加粗', icon: Bold, primary: true },
  { command: 'italic', label: '斜体', icon: Italic, primary: true },
  { command: 'strike', label: '删除线', icon: Strikethrough },
  { command: 'inlineCode', label: '行内代码', icon: Code2 },
  { command: 'clearFormat', label: '清除格式', icon: RemoveFormatting },
  { command: 'bullet', label: '项目列表', icon: List, primary: true },
  { command: 'ordered', label: '编号列表', icon: ListOrdered },
  { command: 'quote', label: '引用', icon: Quote, primary: true },
  { command: 'rule', label: '分割线', icon: Minus },
  { command: 'codeBlock', label: '代码块', icon: Code2, primary: true },
  { command: 'undo', label: '撤销', icon: Undo2, primary: true },
  { command: 'redo', label: '重做', icon: Redo2, primary: true },
]

type OpenResult = { token: string; name: string; markdown: string; revision: string }
type SaveResult = OpenResult & { assetPaths: Record<string, string>; assetRelocations: Record<string, string> }
type DiskStatus = { kind: 'same' | 'changed' | 'deleted'; revision: string | null }
type DocumentState = OpenResult & { id: number; draftId: string; imageUrls: Map<string, string>; recoveredAssets: Map<string, { bytes: number[]; mime: string }>; pendingFiles: Map<string, File>; entryToken?: string; sampleId?: string; originalMarkdown: string; prepared: PreparedMarkdown; sourceText: string; mode: 'visual' | 'source-protected' }
type DraftSummary = { draftId: string; name: string; targetPath: string | null; targetStatus: 'same' | 'changed' | 'deleted' | 'unknown' | 'untitled'; snapshots: number }
type DraftContent = DraftSummary & { markdown: string; assets: { url: string; mime: string; bytes: number[] }[] }
type WorkspaceRoot = { token: string; name: string }
type WorkspaceEntry = { token: string; name: string; directory: boolean }
type ChildrenPage = { entries: WorkspaceEntry[]; nextOffset: number | null }
type SnapshotOut = { markdown: string; title: string; assets: PendingAsset[]; generation: number; revision: number }
type OpenIntent = { token: string; name: string; kind: 'markdown' | 'image' | 'folder' }
type NativeImageIntent = { name: string; mime: string; bytes: number[] }
type RecentItem = { id: string; name: string; kind: 'file' | 'folder'; available: boolean; lastOpened: number }
type Settings = { schemaVersion: number; theme: 'system' | 'light' | 'dark'; sidebarWidth: number; windowWidth: number; windowHeight: number; showFileToolbar: boolean }
const defaultSettings: Settings = { schemaVersion: 1, theme: 'system', sidebarWidth: 230, windowWidth: 1100, windowHeight: 760, showFileToolbar: false }
type TabItem = { key: string; document: DocumentState; session: DocumentSession }
type TreeState = { entries: WorkspaceEntry[]; nextOffset: number | null; expanded: boolean; loading: boolean; error: string | null }
let nextDocumentId = 1
const uiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('ui-preview') === 'editor'
const previewTree: Record<string, TreeState> = {
  'preview-root': { entries: [{ token: 'preview-docs', name: 'doc', directory: true }, { token: 'preview-readme', name: 'README.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-docs': { entries: [{ token: 'preview-plan', name: '设计方案', directory: true }, { token: 'preview-file', name: '产品笔记.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-plan': { entries: [{ token: 'preview-spec', name: '编辑器需求.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
}

function makeDocument(markdown: string, name = '未命名文档', sampleId?: string): DocumentState {
  const prepared = prepareMarkdown(markdown)
  return { id: nextDocumentId++, draftId: crypto.randomUUID(), name, token: '', revision: '', markdown: prepared.editorMarkdown, originalMarkdown: markdown, imageUrls: new Map(), recoveredAssets: new Map(), pendingFiles: new Map(), sampleId, prepared, sourceText: markdown, mode: prepared.analysis.mode }
}

function errorText(error: unknown): string {
  const code = String(error)
  const messages: Record<string, string> = {
    CONFLICT: '磁盘文件已被其他程序修改，请先保留当前内容并重新打开检查。',
    COMMIT_UNCERTAIN: '文件可能已写入，但原目录在操作期间发生变化。请先到磁盘确认文件位置，再决定是否重试。',
    TARGET_EXISTS: '目标文件已存在，请选择其他文件名。',
    INVALID_ENCODING: '文件不是有效的 UTF-8，暂不能在可视化模式打开。',
    DOCUMENT_TOO_LARGE: '文档超过 20 MiB 上限，未截断或修改原文件。请在 Finder 中选择其他应用打开。',
    IMAGE_TOO_LARGE: '图片超过当前 20 MB 限制。',
    ASSET_WRITE_FAILED: '图片附件写入失败，正文没有保存。',
    ASSET_NOT_FOUND: '被引用的本地图片不存在，正文没有写入。',
    INVALID_IMAGE: '图片内容无法解码或格式与类型不匹配。',
    INVALID_ASSET: '图片引用与附件不一致，正文没有写入。',
    INVALID_NAME: '名称为空、包含路径字符，或扩展名不受支持。',
    DIR_NOT_EMPTY: '首版只允许移动空目录到废纸篓或重命名空目录。',
    TRASH_FAILED: '系统废纸篓操作失败，原文件仍保留。',
    SNAPSHOT_TOO_LARGE: '当前导出快照超过大小限制。',
    OUT_OF_SCOPE: '文件或图片路径超出本次打开的范围。',
    EXPORT_TOO_LARGE: '导出文件超过当前 100 MB 限制。',
    EXPORT_RESOURCE_MISSING: '图片附件缺失或包含远程图片，无法生成完整资源包。可选择“仅正文 MD”。',
    SNAPSHOT_BUDGET: '同时进行的导出作业过多，请稍后重试。',
    NOT_FOUND: '原文件或文件夹已经不在原位置，请从最近使用中移除该记录，或重新打开。',
  }
  return messages[code] ?? `操作失败：${code}`
}

function imageMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
}

async function hydrateImages(opened: OpenResult): Promise<DocumentState> {
  const prepared = prepareMarkdown(opened.markdown)
  let markdown = prepared.editorMarkdown
  const imageUrls = new Map<string, string>()
  const replacements = new Map<string, string>()
  let hydrationFailed = false
  const relatives = prepared.analysis.mode === 'visual' ? imageUrlsIn(markdown).filter((url) => localAssetPath(url) !== null) : []
  for (const relative of relatives) {
    try {
      const bytes = await invoke<number[]>('read_asset', { token: opened.token, relative: localAssetPath(relative) })
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMime(relative) }))
      imageUrls.set(url, relative)
      replacements.set(relative, url)
    } catch {
      // Keep the original reference visible as a missing image.
    }
  }
  try { markdown = rewriteImageUrls(markdown, replacements) }
  catch {
    hydrationFailed = true
    for (const url of imageUrls.keys()) URL.revokeObjectURL(url)
    imageUrls.clear()
    markdown = prepared.editorMarkdown
  }
  return { ...opened, id: nextDocumentId++, draftId: crypto.randomUUID(), markdown, originalMarkdown: opened.markdown, imageUrls, recoveredAssets: new Map(), pendingFiles: new Map(), prepared, sourceText: opened.markdown, mode: hydrationFailed ? 'source-protected' : prepared.analysis.mode }
}

export function App() {
  const editorRoot = useRef<HTMLDivElement>(null)
  const sidebarRoot = useRef<HTMLElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const imageInputAction = useRef<'insert' | 'replace'>('insert')
  const lastFileAction = useRef<{ action: string; at: number }>({ action: '', at: 0 })
  const adapter = useRef<EditorAdapter | null>(null)
  const [document, setDocument] = useState<DocumentState>(() => uiPreview ? { ...makeDocument('# 产品笔记\n\n把 Markdown 文档放在熟悉的文件夹里，打开、阅读、继续写作。\n\n## 当前计划\n\n- 浏览多级目录\n- 编辑并保存本地文件\n- 导出可分享的副本\n', '产品笔记.md'), entryToken: 'preview-file' } : makeDocument(''))
  const documentRef = useRef(document)
  documentRef.current = document
  const initialDocumentId = useRef(document.id)
  const [session, setSession] = useState<DocumentSession>(() => createSession(document.id))
  const sessionRef = useRef(session)
  const initialTabKey = useRef(crypto.randomUUID())
  const [tabs, setTabs] = useState<TabItem[]>(() => [{ key: initialTabKey.current, document, session }])
  const tabsRef = useRef(tabs)
  const [activeTabKey, setActiveTabKey] = useState<string>(initialTabKey.current)
  const activeTabKeyRef = useRef<string>(activeTabKey)
  const [tabMenu, setTabMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const closingTabsRef = useRef(false)
  const closingWindowRef = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const queuedSave = useRef(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(busy)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [status, setStatus] = useState('选择新建文档或打开本地文件')
  const [diskChange, setDiskChange] = useState<DiskStatus | null>(null)
  const [diskPreview, setDiskPreview] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [draftPreview, setDraftPreview] = useState<DraftContent | null>(null)
  const [toolbar, setToolbar] = useState<ToolbarState>({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, linkHref: null, imageAlt: null })
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')
  const [imageAltOpen, setImageAltOpen] = useState(false)
  const [imageAltText, setImageAltText] = useState('')
  const [imageError, setImageError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceRoot | null>(uiPreview ? { token: 'preview-root', name: 'MinoMarkdown' } : null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [settings, setSettings] = useState<Settings>(() => uiPreview ? { ...defaultSettings, theme: new URLSearchParams(window.location.search).get('ui-theme') === 'light' ? 'light' : 'dark' } : defaultSettings)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [tree, setTree] = useState<Record<string, TreeState>>(uiPreview ? previewTree : {})
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<(WorkspaceEntry & { parentToken: string }) | null>(null)
  const [newEntryType, setNewEntryType] = useState<'file' | 'directory' | null>(null)
  const [newEntryName, setNewEntryName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const draftWriteChain = useRef<Promise<void>>(Promise.resolve())
  const pendingDiscardDraftId = useRef<string | null>(null)
  const desktop = isTauri()
  busyRef.current = busy
  const dirty = isDirty(session)
  const welcomeVisible = tabs.length === 1 && document.id === initialDocumentId.current && !document.token && !workspace && document.markdown === '' && !dirty
  const canProceedRef = useRef<(finalizeDiscard?: boolean) => Promise<boolean>>(async () => true)

  function updateSession(next: DocumentSession) {
    sessionRef.current = next
    setSession(next)
  }

  function updateTabs(next: TabItem[]) {
    tabsRef.current = next
    setTabs(next)
  }

  function captureCurrentTab(): TabItem {
    const current = tabsRef.current.find((tab) => tab.key === activeTabKeyRef.current)!
    const activeDocument = documentRef.current
    let markdown = activeDocument.markdown
    if (activeDocument.mode === 'visual' && adapter.current?.isReady()) {
      try { markdown = adapter.current.getMarkdown() } catch { /* Keep the last complete snapshot. */ }
    }
    const captured = { ...current, document: { ...activeDocument, markdown, pendingFiles: adapter.current?.pendingFiles() ?? activeDocument.pendingFiles }, session: sessionRef.current }
    updateTabs(tabsRef.current.map((tab) => tab.key === captured.key ? captured : tab))
    if (desktop && isDirty(captured.session)) void persistTabDraft(captured, adapter.current)
    return captured
  }

  function activateTab(tab: TabItem) {
    activeTabKeyRef.current = tab.key
    setActiveTabKey(tab.key)
    updateSession(tab.session)
    documentRef.current = tab.document
    setDocument(tab.document)
    setTabMenu(null)
  }

  function switchTab(key: string) {
    if (busyRef.current || key === activeTabKeyRef.current) return
    captureCurrentTab()
    const target = tabsRef.current.find((tab) => tab.key === key)
    if (target) activateTab(target)
  }

  function openTab(nextDocument: DocumentState, nextSession = createSession(nextDocument.id)) {
    const activeDocument = documentRef.current
    const onlyWelcome = tabsRef.current.length === 1 && activeDocument.id === initialDocumentId.current && !activeDocument.token && activeDocument.markdown === '' && !isDirty(sessionRef.current)
    if (!onlyWelcome) captureCurrentTab()
    const tab = { key: crypto.randomUUID(), document: nextDocument, session: nextSession }
    updateTabs(onlyWelcome ? [tab] : [...tabsRef.current, tab])
    activateTab(tab)
  }

  async function closeTabs(keys: string[]): Promise<boolean> {
    if (closingTabsRef.current) return false
    closingTabsRef.current = true
    try {
    for (const key of keys) {
      const index = tabsRef.current.findIndex((tab) => tab.key === key)
      if (index < 0) continue
      if (key !== activeTabKeyRef.current) {
        switchTab(key)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      if (!await canProceedRef.current(true)) return false
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const closing = tabsRef.current.find((tab) => tab.key === key)
      if (!closing) continue
      const activePendingUrls = Array.from(adapter.current?.pendingFiles().keys() ?? [])
      const token = documentRef.current.token || closing.document.token
      const remaining = tabsRef.current.filter((tab) => tab.key !== key)
      if (remaining.length === 0) {
        const empty = makeDocument('')
        initialDocumentId.current = empty.id
        const replacement = { key: crypto.randomUUID(), document: empty, session: createSession(empty.id) }
        updateTabs([replacement])
        activateTab(replacement)
      } else {
        updateTabs(remaining)
        activateTab(remaining[Math.min(index, remaining.length - 1)])
      }
      await draftWriteChain.current.catch(() => undefined)
      if (token) await releaseCandidate(token)
      for (const url of closing.document.imageUrls.keys()) URL.revokeObjectURL(url)
      for (const url of closing.document.recoveredAssets.keys()) URL.revokeObjectURL(url)
      for (const url of closing.document.pendingFiles.keys()) URL.revokeObjectURL(url)
      for (const url of activePendingUrls) URL.revokeObjectURL(url)
      setStatus(`已关闭 ${closing.document.name}`)
    }
    setTabMenu(null)
    return true
    } finally { closingTabsRef.current = false }
  }

  function reorderTabs(from: string, to: string) {
    const next = [...tabsRef.current]
    const fromIndex = next.findIndex((tab) => tab.key === from)
    const toIndex = next.findIndex((tab) => tab.key === to)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    next.splice(toIndex, 0, next.splice(fromIndex, 1)[0])
    updateTabs(next)
  }

  useEffect(() => {
    if (sessionRef.current.generation !== document.id) updateSession(createSession(document.id, document.revision || null))
    setToolbar({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, linkHref: null, imageAlt: null })
    setLinkOpen(false)
    setImageAltOpen(false)
    setImageError(null)
    if (welcomeVisible) return
    if (document.mode === 'source-protected') {
      setStatus(`源码模式：${document.prepared.analysis.issues.map((issue) => issue.code === 'VISUAL_SIZE_LIMIT' ? '超过 5 MiB 可视化上限' : issue.code).join('、') || '手动切换'}；可保存原文，HTML/PDF 暂不可导出`)
      return
    }
    if (!editorRoot.current) return
    const instance = new EditorAdapter(editorRoot.current, document.markdown, () => {
      if (sessionRef.current.generation === document.id) updateSession(editSession(sessionRef.current))
    }, document.imageUrls, document.recoveredAssets, document.pendingFiles, setToolbar, setImageError)
    adapter.current = instance
    let disposed = false
    const creation = instance.create()
    void creation.then(() => {
      if (!disposed) setStatus(document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存')
    }).catch((error: unknown) => {
      if (!disposed) setStatus(`编辑器启动失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      disposed = true
      if (adapter.current === instance) adapter.current = null
      void creation.finally(() => instance.destroy(false)).catch(() => undefined)
    }
  }, [document.id, welcomeVisible])

  useEffect(() => {
    setDiskChange(null)
    setDiskPreview(null)
  }, [document.id])

  useEffect(() => {
    if (!desktop) return
    void invoke<DraftSummary[]>('list_drafts').then(setDrafts).catch((error: unknown) => setStatus(errorText(error)))
    void invoke<RecentItem[]>('list_recent').then(setRecent).catch(() => undefined)
  }, [desktop])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    window.document.documentElement.dataset.theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme
  }, [settings.theme, systemDark])

  useEffect(() => {
    if (!desktop) return
    void invoke<Settings>('get_settings').then((loaded) => {
      setSettings(loaded)
      setSettingsLoaded(true)
      void getCurrentWindow().setSize(new LogicalSize(loaded.windowWidth, loaded.windowHeight)).catch(() => undefined)
    }).catch((error: unknown) => { setSettingsLoaded(true); setStatus(errorText(error)) })
  }, [desktop])

  useEffect(() => {
    if (!desktop || !settingsLoaded) return
    const timer = window.setTimeout(() => void invoke('update_settings', { settings }).catch((error: unknown) => setStatus(errorText(error))), 500)
    return () => window.clearTimeout(timer)
  }, [desktop, settingsLoaded, settings])

  useEffect(() => {
    if (!desktop || !settingsLoaded) return
    const onResize = () => setSettings((current) => ({ ...current, windowWidth: Math.max(720, Math.min(3000, window.innerWidth)), windowHeight: Math.max(520, Math.min(2000, window.innerHeight)) }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [desktop, settingsLoaded])

  useEffect(() => {
    const element = sidebarRoot.current
    if (!element || !settingsLoaded) return
    const observer = new ResizeObserver(() => {
      const width = Math.round(element.getBoundingClientRect().width)
      if (width >= 170 && width <= 420) setSettings((current) => current.sidebarWidth === width ? current : { ...current, sidebarWidth: width })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [sidebarOpen, settingsLoaded])

  async function rememberDocument(token: string): Promise<void> {
    await invoke('remember_recent_document', { token })
    setRecent(await invoke<RecentItem[]>('list_recent'))
  }

  async function rememberWorkspace(token: string): Promise<void> {
    await invoke('remember_recent_workspace', { token })
    setRecent(await invoke<RecentItem[]>('list_recent'))
  }

  function persistTabDraft(tab: TabItem, instance: EditorAdapter | null): Promise<void> {
    const { document: savedDocument, session: savedSession } = tab
    const visual = savedDocument.mode === 'visual'
    const markdown = visual ? composeVisualMarkdown(savedDocument.prepared.analysis, savedDocument.markdown) : savedDocument.sourceText
    const referenced = new Set(imageUrlsIn(markdown))
    const pendingAssets = visual && instance?.isReady()
      ? instance.pendingAssets(markdown, false)
      : Promise.resolve(Array.from(savedDocument.recoveredAssets, ([url, asset]) => ({ url, ...asset })).filter((asset) => referenced.has(asset.url)))
    draftWriteChain.current = draftWriteChain.current.catch(() => undefined).then(async () => {
      const assets = await pendingAssets
      if (visual && savedDocument.token) {
        for (const [url, relative] of savedDocument.imageUrls) {
          if (!referenced.has(url)) continue
          const bytes = await invoke<number[]>('read_asset', { token: savedDocument.token, relative: localAssetPath(relative) })
          assets.push({ url, bytes, mime: imageMime(relative) })
        }
      }
      await invoke('write_draft', { draftId: savedDocument.draftId, name: savedDocument.name, token: savedDocument.token || null, baseDiskRevision: savedSession.diskRevision, markdown, assets })
      setDrafts(await invoke<DraftSummary[]>('list_drafts'))
    }).catch((error: unknown) => setStatus(`草稿保存失败：${errorText(error)}`))
    return draftWriteChain.current
  }

  useEffect(() => {
    if (!desktop || !isDirty(session) || session.generation !== document.id || toolbar.composing) return
    const timer = window.setTimeout(() => {
      const current = sessionRef.current
      if (current.generation !== document.id || !isDirty(current)) return
      const instance = adapter.current
      if (document.mode === 'visual' && !instance) return
      draftWriteChain.current = draftWriteChain.current.catch(() => undefined).then(async () => {
        if (sessionRef.current.generation !== document.id || !isDirty(sessionRef.current)) return
        const visual = document.mode === 'visual'
        const raw = visual ? instance!.getMarkdown() : document.sourceText
        const markdown = visual ? composeVisualMarkdown(document.prepared.analysis, raw) : raw
        const imageUrls = new Set(imageUrlsIn(markdown))
        const assets = visual ? await instance!.pendingAssets(markdown, false) : Array.from(document.recoveredAssets, ([url, asset]) => ({ url, ...asset })).filter((asset) => imageUrls.has(asset.url))
        if (visual && document.token) {
          for (const [url, relative] of document.imageUrls) {
            if (!imageUrls.has(url)) continue
            const bytes = await invoke<number[]>('read_asset', { token: document.token, relative: localAssetPath(relative) })
            assets.push({ url, bytes, mime: imageMime(relative) })
          }
        }
        await invoke('write_draft', { draftId: document.draftId, name: document.name, token: document.token || null, baseDiskRevision: current.diskRevision, markdown, assets })
        setDrafts(await invoke<DraftSummary[]>('list_drafts'))
      }).catch((error: unknown) => setStatus(`草稿保存失败：${errorText(error)}`))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [desktop, document.id, document.mode, document.sourceText, session.revision, session.savedRevision, toolbar.composing])

  async function discardDraft(draftId: string): Promise<void> {
    await draftWriteChain.current
    await invoke('discard_draft', { draftId })
    setDrafts(await invoke<DraftSummary[]>('list_drafts'))
  }

  async function recoverDraft(draftId: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const recovered = await invoke<DraftContent>('read_draft', { draftId })
      const next = makeDocument(recovered.markdown, recovered.name)
      next.draftId = draftId
      const sourceAssets = new Map<string, { bytes: number[]; mime: string }>()
      const replacements = new Map<string, string>()
      for (const asset of recovered.assets) {
        const url = next.mode === 'visual' ? URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime })) : asset.url
        if (next.mode === 'visual') replacements.set(asset.url, url)
        sourceAssets.set(url, { bytes: asset.bytes, mime: asset.mime })
      }
      if (next.mode === 'visual') {
        try {
          next.markdown = rewriteImageUrls(next.markdown, replacements)
          next.sourceText = rewriteImageUrls(next.sourceText, replacements)
        } catch (error) {
          for (const url of sourceAssets.keys()) URL.revokeObjectURL(url)
          throw error
        }
      }
      next.recoveredAssets = sourceAssets
      openTab(next, editSession(createSession(next.id)))
      setStatus(recovered.targetStatus === 'changed' ? '已恢复草稿；原文件已有新版本，保存时请选择新文件名' : '已恢复草稿；请检查内容后保存')
    } catch (error) { setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  async function previewDraft(draftId: string): Promise<void> {
    try { setDraftPreview(await invoke<DraftContent>('read_draft', { draftId })) }
    catch (error) { setStatus(errorText(error)) }
  }

  useEffect(() => {
    if (!desktop || !document.token) return
    let active = true
    let inFlight = false
    let lastChange = ''
    const poll = async () => {
      if (inFlight || sessionRef.current.generation !== document.id || sessionRef.current.persistence === 'saving') return
      inFlight = true
      const expectedAtStart = sessionRef.current.diskRevision
      try {
        const result = await invoke<DiskStatus>('check_document_revision', { token: document.token })
        if (!active || sessionRef.current.generation !== document.id || sessionRef.current.diskRevision !== expectedAtStart) return
        if (result.kind === 'same' || result.revision === sessionRef.current.diskRevision) {
          if (lastChange) {
            lastChange = ''
            setDiskChange(null)
            updateSession(clearExternalConflict(sessionRef.current))
          }
        } else {
          const signature = `${result.kind}:${result.revision ?? ''}`
          if (signature !== lastChange) {
            lastChange = signature
            setDiskChange(result)
            updateSession(externalConflict(sessionRef.current))
            setStatus(result.kind === 'deleted' ? '磁盘文件已被删除；本地内容仍保留，可另存副本' : '磁盘文件已被外部修改；本地内容仍保留')
          }
        }
      } catch (error) {
        if (active) setStatus(errorText(error))
      } finally {
        inFlight = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    window.addEventListener('focus', poll)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', poll) }
  }, [desktop, document.id, document.token])

  async function canProceed(finalizeDiscard = false): Promise<boolean> {
    if (busy) { setStatus('当前操作尚未完成，请稍后再试'); return false }
    if (!isDirty(sessionRef.current)) { pendingDiscardDraftId.current = null; return true }
    pendingDiscardDraftId.current = null
    if (!desktop) return window.confirm('当前修改尚未保存。确定放弃修改吗？')
    try {
      const action = await invoke<UnsavedAction>('choose_unsaved_action')
      const allowed = await mayLeaveDocument(action, saveDocument)
      if (allowed && action === 'discard') {
        pendingDiscardDraftId.current = document.draftId
        if (finalizeDiscard) await finishLeave()
      }
      return allowed
    } catch (error) {
      setStatus(errorText(error))
      return false
    }
  }
  canProceedRef.current = canProceed

  async function finishLeave(nextDraftId?: string): Promise<void> {
    const draftId = pendingDiscardDraftId.current
    if (!draftId) return
    if (draftId !== nextDraftId) await discardDraft(draftId)
    pendingDiscardDraftId.current = null
  }

  async function releaseCandidate(token: string | null): Promise<void> {
    if (!desktop || !token) return
    try { await invoke('release_document', { token }) }
    catch (error) { setStatus(`未使用文件访问清理失败：${errorText(error)}`) }
  }

  const handleIntentRef = useRef<(intent: OpenIntent) => Promise<void>>(async () => undefined)
  handleIntentRef.current = async (intent) => {
    let candidateToken: string | null = null
    try {
      while (busyRef.current) await new Promise((resolve) => window.setTimeout(resolve, 100))
      if (intent.kind === 'markdown') {
        const opened = await invoke<OpenResult>('open_intent_document', { token: intent.token })
        candidateToken = opened.token
        const hydrated = await hydrateImages(opened)
        openTab(hydrated, createSession(hydrated.id, hydrated.revision))
        candidateToken = null
        void rememberDocument(hydrated.token).catch(() => undefined)
      } else if (intent.kind === 'folder') {
        const chosen = await invoke<WorkspaceRoot>('open_intent_workspace', { token: intent.token })
        await activateWorkspace(chosen)
      } else {
        if (document.mode !== 'visual') { await invoke('discard_open_intent', { token: intent.token }); setStatus('源码保护模式不能直接插入图片'); return }
        const image = await invoke<NativeImageIntent>('read_intent_image', { token: intent.token })
        let attempts = 0
        while (!adapter.current?.isReady() && attempts++ < 50) await new Promise((resolve) => window.setTimeout(resolve, 100))
        if (!adapter.current?.isReady()) throw new Error('EDITOR_NOT_READY')
        adapter.current.insertFile(new File([new Uint8Array(image.bytes)], image.name, { type: image.mime }))
      }
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
  }

  useEffect(() => {
    if (!desktop) return
    let canceled = false
    let unlisten: (() => void) | undefined
    let unlistenEmpty: (() => void) | undefined
    let draining = false
    let rerun = false
    async function drain() {
      if (canceled) return
      if (draining) { rerun = true; return }
      draining = true
      try {
        do {
          rerun = false
          while (!canceled) {
            const intents = await invoke<OpenIntent[]>('take_open_intents')
            if (intents.length === 0) break
            for (const intent of intents) await handleIntentRef.current(intent)
          }
        } while (rerun && !canceled)
      } catch (error) { setStatus(errorText(error)) }
      finally { draining = false }
    }
    void listen('open-intents-available', () => void drain()).then((stop) => { if (canceled) stop(); else unlisten = stop }).catch((error: unknown) => setStatus(errorText(error)))
    void listen('open-intents-empty-drop', () => setStatus('macOS 未提供拖入文件路径，请从 Finder 拖入本地 Markdown 文件')).then((stop) => { if (canceled) stop(); else unlistenEmpty = stop }).catch((error: unknown) => setStatus(errorText(error)))
    void drain()
    return () => { canceled = true; unlisten?.(); unlistenEmpty?.() }
  }, [desktop])

  async function newDocument() {
    if (busy) return
    openTab(makeDocument(''))
  }

  async function openDocument() {
    if (busy) return
    let candidateToken: string | null = null
    try {
      const opened = await invoke<OpenResult | null>('open_document')
      if (opened) {
        candidateToken = opened.token
        setBusy(true)
        const hydrated = await hydrateImages(opened)
        openTab(hydrated, createSession(hydrated.id, hydrated.revision))
        candidateToken = null
        void rememberDocument(opened.token).catch(() => undefined)
      }
    } catch (error) {
      await releaseCandidate(candidateToken)
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function loadChildren(token: string, offset = 0): Promise<void> {
    setTree((current) => ({ ...current, [token]: { entries: offset ? current[token]?.entries ?? [] : [], nextOffset: null, expanded: true, loading: true, error: null } }))
    try {
      const page = await invoke<ChildrenPage>('list_children', { directoryToken: token, offset })
      setTree((current) => ({ ...current, [token]: { entries: [...(offset ? current[token]?.entries ?? [] : []), ...page.entries], nextOffset: page.nextOffset, expanded: true, loading: false, error: null } }))
    } catch (error) {
      setTree((current) => ({ ...current, [token]: { entries: current[token]?.entries ?? [], nextOffset: current[token]?.nextOffset ?? null, expanded: true, loading: false, error: errorText(error) } }))
    }
  }

  async function chooseWorkspace() {
    if (busy) return
    try {
      const chosen = await invoke<WorkspaceRoot | null>('choose_workspace')
      if (!chosen) return
      await activateWorkspace(chosen)
    } catch (error) { setStatus(errorText(error)) }
  }

  async function activateWorkspace(chosen: WorkspaceRoot) {
    if (workspace) await invoke('release_workspace', { token: workspace.token })
    setWorkspace(chosen)
    setTree({})
    setSelectedDirectory(chosen.token)
    setSelectedEntry(null)
    setSidebarOpen(true)
    await loadChildren(chosen.token)
    setStatus(`已打开文件夹 ${chosen.name}`)
    void rememberWorkspace(chosen.token).catch(() => undefined)
  }

  async function openWorkspaceEntry(token: string) {
    if (busy) return
    setBusy(true)
    let candidateToken: string | null = null
    try {
      const opened = await invoke<OpenResult>('open_workspace_document', { entryToken: token })
      candidateToken = opened.token
      const hydrated = await hydrateImages(opened)
      openTab({ ...hydrated, entryToken: token }, createSession(hydrated.id, hydrated.revision))
      candidateToken = null
      void rememberDocument(opened.token).catch(() => undefined)
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  async function closeWorkspace() {
    if (!workspace) return
    try { await invoke('release_workspace', { token: workspace.token }); setWorkspace(null); setTree({}); setSelectedDirectory(null); setSelectedEntry(null) }
    catch (error) { setStatus(errorText(error)) }
  }

  async function openRecent(item: RecentItem) {
    if (busy) return
    let candidateToken: string | null = null
    try {
      if (item.kind === 'file') {
        const opened = await invoke<OpenResult | null>('choose_recent_file', { id: item.id })
        if (!opened) return
        candidateToken = opened.token
        const hydrated = await hydrateImages(opened)
        openTab(hydrated, createSession(hydrated.id, hydrated.revision))
        candidateToken = null
        void rememberDocument(opened.token).catch(() => undefined)
      } else {
        const chosen = await invoke<WorkspaceRoot | null>('choose_recent_workspace', { id: item.id })
        if (!chosen) return
        await activateWorkspace(chosen)
      }
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
  }

  async function removeRecent(id: string) {
    try { await invoke('remove_recent', { id }); setRecent(await invoke<RecentItem[]>('list_recent')) }
    catch (error) { setStatus(errorText(error)) }
  }

  async function moveRecent(id: string, delta: number) {
    const from = recent.findIndex((item) => item.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= recent.length) return
    const ordered = [...recent]
    ordered.splice(to, 0, ordered.splice(from, 1)[0])
    setRecent(ordered)
    try { await invoke('reorder_recent', { ids: ordered.map((item) => item.id) }) }
    catch (error) { setRecent(await invoke<RecentItem[]>('list_recent')); setStatus(errorText(error)) }
  }

  function toggleDirectory(token: string) {
    const current = tree[token]
    if (!current) { void loadChildren(token); return }
    if (!current.expanded && current.entries.length === 0) { void loadChildren(token); return }
    setTree((old) => ({ ...old, [token]: { ...old[token], expanded: !old[token].expanded } }))
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
      {state.entries.map((entry) => <div key={entry.token}>
        <button type="button" role="treeitem" data-tree-item aria-level={depth + 1} aria-expanded={entry.directory ? (tree[entry.token]?.expanded ?? false) : undefined} aria-selected={document.entryToken === entry.token || selectedEntry?.token === entry.token} className="tree-entry" style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => { setSelectedEntry({ ...entry, parentToken: token }); setSelectedDirectory(entry.directory ? entry.token : token); if (entry.directory) toggleDirectory(entry.token); else void openWorkspaceEntry(entry.token) }} onKeyDown={(event) => treeKeyDown(event, entry)}>
          <span className="tree-chevron" aria-hidden="true">{entry.directory ? tree[entry.token]?.expanded ? <ChevronDown /> : <ChevronRight /> : null}</span>
          {entry.directory ? <Folder className="tree-icon" aria-hidden="true" /> : <FileText className="tree-icon" aria-hidden="true" />}
          <span className="tree-name">{entry.name}</span>
        </button>
        {entry.directory && renderChildren(entry.token, depth + 1)}
      </div>)}
      {state.loading && <p className="tree-note">正在读取…</p>}
      {state.error && <p className="tree-note" role="alert">{state.error}<button type="button" onClick={() => void loadChildren(token, state.entries.length)}>重试</button></p>}
      {state.nextOffset !== null && !state.loading && <button type="button" className="tree-more" onClick={() => void loadChildren(token, state.nextOffset ?? 0)}>加载更多</button>}
    </div>
  }

  async function createEntry() {
    if (!selectedDirectory || !newEntryType || !newEntryName.trim()) return
    try {
      await invoke<WorkspaceEntry>('create_workspace_entry', { parentToken: selectedDirectory, name: newEntryName.trim(), directory: newEntryType === 'directory' })
      await loadChildren(selectedDirectory)
      setNewEntryType(null)
      setNewEntryName('')
      setStatus(`已新建 ${newEntryName.trim()}`)
    } catch (error) { setStatus(errorText(error)) }
  }

  async function renameEntry() {
    if (!selectedEntry || !renameName.trim()) return
    try {
      const renamed = await invoke<WorkspaceEntry>('rename_workspace_entry', { entryToken: selectedEntry.token, newName: renameName.trim() })
      updateTabs(tabsRef.current.map((tab) => tab.document.entryToken === renamed.token ? { ...tab, document: { ...tab.document, name: renamed.name } } : tab))
      if (document.entryToken === renamed.token) setDocument((current) => ({ ...current, name: renamed.name }))
      setSelectedEntry({ ...selectedEntry, name: renamed.name })
      await loadChildren(selectedEntry.parentToken)
      setRenaming(false)
      setStatus(`已重命名为 ${renamed.name}`)
    } catch (error) { setStatus(errorText(error)) }
  }

  async function trashEntry() {
    if (!selectedEntry || !window.confirm(`将“${selectedEntry.name}”移到废纸篓？`)) return
    const affected = tabsRef.current.filter((tab) => tab.document.entryToken === selectedEntry.token).map((tab) => tab.key)
    if (affected.length && !await closeTabs(affected)) return
    try {
      await invoke('trash_workspace_entry', { entryToken: selectedEntry.token })
      await loadChildren(selectedEntry.parentToken)
      setStatus(`已移到废纸篓：${selectedEntry.name}`)
      setSelectedEntry(null)
    } catch (error) { setStatus(errorText(error)) }
  }

  async function saveDocument(asNew = false): Promise<boolean> {
    const instance = adapter.current
    if (busy) {
      if (sessionRef.current.persistence === 'saving') queuedSave.current = true
      return false
    }
    if (document.mode === 'visual' && !instance) return false
    if (toolbar.composing) { setStatus('请先完成当前中文输入，再保存'); return false }
    if (document.token && !asNew && !isDirty(sessionRef.current)) {
      setStatus('内容未修改，磁盘文件无需重写')
      return true
    }
    setBusy(true)
    const { session: saving, ticket } = beginSave(sessionRef.current)
    updateSession(saving)
    try {
      const visual = document.mode === 'visual'
      const editorMarkdown = visual ? instance!.getPersistableMarkdown() : document.sourceText
      const markdown = visual ? composeVisualMarkdown(document.prepared.analysis, editorMarkdown) : editorMarkdown
      const referenced = new Set(imageUrlsIn(markdown))
      const assets: PendingAsset[] = visual ? await instance!.pendingAssets(markdown) : Array.from(document.recoveredAssets, ([url, asset]) => ({ url, ...asset })).filter((asset) => referenced.has(asset.url))
      const saved = await invoke<SaveResult | null>(asNew && document.token ? 'save_as_document' : 'save_document', {
        token: document.token || null,
        expectedRevision: ticket.diskRevision,
        markdown,
        assets,
      })
      if (!saved) {
        queuedSave.current = false
        updateSession(saveCanceled(sessionRef.current, ticket))
        setStatus('已取消保存，当前内容仍在编辑器中')
        return false
      }
      if (sessionRef.current.generation !== ticket.generation) {
        if (saved.token !== document.token) await releaseCandidate(saved.token)
        return false
      }
      instance?.markSaved(saved.assetPaths)
      for (const [url, relative] of document.imageUrls) {
        const moved = saved.assetRelocations[relative]
        if (moved) document.imageUrls.set(url, moved)
      }
      const unchangedDuringSave = sessionRef.current.revision === ticket.revision
      setDocument((current) => current.id === document.id ? {
        ...current, token: saved.token, name: saved.name, revision: saved.revision, originalMarkdown: saved.markdown, sourceText: current.mode === 'source-protected' && unchangedDuringSave ? saved.markdown : current.sourceText, sampleId: undefined,
      } : current)
      const completed = saveSucceeded(sessionRef.current, ticket, saved.revision)
      updateSession(completed)
      let draftCleanupError = ''
      if (!isDirty(completed)) {
        try { await discardDraft(document.draftId) }
        catch (draftError) { draftCleanupError = `；草稿清理失败：${errorText(draftError)}` }
      }
      setStatus(`已保存 ${saved.name}${isDirty(completed) ? '；保存期间的新修改仍未保存' : ''}${draftCleanupError}`)
      if (document.token && saved.token !== document.token) {
        const previousToken = document.token
        void draftWriteChain.current.catch(() => undefined).then(() => releaseCandidate(previousToken))
      }
      void rememberDocument(saved.token).catch(() => undefined)
      return !isDirty(completed)
    } catch (error) {
      queuedSave.current = false
      updateSession(saveFailed(sessionRef.current, ticket, String(error)))
      setStatus(errorText(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function exportPage(mode: 'html' | 'print') {
    const instance = adapter.current
    if (!instance || busy || document.mode === 'source-protected' || toolbar.composing) return
    setBusy(true)
    let snapshotId: string | null = null
    try {
      snapshotId = await captureSnapshot(false)
      const frozen = await invoke<SnapshotOut>('read_snapshot', { snapshotId })
      const assets = new Map(frozen.assets.map((asset) => [asset.url, asset]))
      const html = await renderHtml(frozen.markdown, frozen.title.replace(/\.(md|markdown)$/i, ''), async (url) => {
        const asset = assets.get(url)
        return asset ? { bytes: new Uint8Array(asset.bytes), mime: asset.mime } : null
      })
      if (mode === 'html') {
        const name = await invoke<string | null>('export_html', { html })
        setStatus(name ? `已导出 ${name}` : '已取消 HTML 导出，当前文档未改变')
      } else {
        const printState = await printHtml(html)
        setStatus(printState === 'dialogOpened' ? '打印页已交给系统；请在系统对话框中选择“存储为 PDF”。应用无法确认最终 PDF 路径。' : '打印未完成')
      }
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      if (snapshotId) await invoke('release_snapshot', { snapshotId }).catch(() => undefined)
      setBusy(false)
    }
  }

  async function captureSnapshot(textOnly: boolean): Promise<string> {
    const instance = adapter.current
    if (document.mode === 'visual' && (!instance || toolbar.composing)) throw new Error('EDITOR_NOT_READY')
    const revision = sessionRef.current.revision
    const markdown = document.mode === 'visual'
      ? composeVisualMarkdown(document.prepared.analysis, instance!.getPersistableMarkdown())
      : document.sourceText
    const assets: PendingAsset[] = []
    if (!textOnly) {
      const pending = new Map((await instance!.pendingAssets(markdown)).map((asset) => [asset.url, asset]))
      for (const url of imageUrlsIn(markdown)) {
        const staged = pending.get(url)
        if (staged) { assets.push(staged); continue }
        const relative = localAssetPath(url)
        if (!document.token || !relative) throw new Error('EXPORT_RESOURCE_MISSING')
        const bytes = await invoke<number[]>('read_asset', { token: document.token, relative })
        assets.push({ url, bytes, mime: imageMime(url) })
      }
    }
    return invoke<string>('create_snapshot', { markdown, title: document.name, assets, generation: document.id, revision })
  }

  async function exportSnapshotMD(textOnly: boolean) {
    if (busy || !desktop || (!textOnly && document.mode === 'source-protected')) return
    setBusy(true)
    let snapshotId: string | null = null
    try {
      snapshotId = await captureSnapshot(textOnly)
      const output = await invoke<{ name: string; sha256: string; assets: { path: string; sha256: string }[] } | null>('export_snapshot_md', { snapshotId, textOnly })
      setStatus(output ? `已导出 ${output.name} · ${output.assets.length} 张图片 · SHA-256 ${output.sha256.slice(0, 12)}…` : '已取消 MD 导出，当前文档未改变')
    } catch (error) { setStatus(errorText(error)) }
    finally {
      if (snapshotId) await invoke('release_snapshot', { snapshotId }).catch(() => undefined)
      setBusy(false)
    }
  }

  async function previewDiskVersion() {
    if (!document.token || busy) return
    try {
      const text = await invoke<string>('read_disk_version', { token: document.token })
      setDiskPreview(text)
    } catch (error) {
      setStatus(errorText(error))
    }
  }

  async function reloadDiskVersion() {
    if (!document.token || busy || diskChange?.kind === 'deleted') return
    if (isDirty(sessionRef.current) && !window.confirm('重新加载将放弃当前未保存内容。确定继续吗？')) return
    setBusy(true)
    try {
      const opened = await invoke<OpenResult>('reload_document', { token: document.token })
      setDocument(await hydrateImages(opened))
      setDiskChange(null)
      setDiskPreview(null)
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveConflictCopy() {
    if (!document.token || busy) return
    const instance = adapter.current
    if (document.mode === 'visual' && !instance) return
    setBusy(true)
    try {
      const visual = document.mode === 'visual'
      const markdown = visual
        ? composeVisualMarkdown(document.prepared.analysis, instance!.getPersistableMarkdown())
        : document.sourceText
      const assets = visual ? await instance!.pendingAssets(markdown) : []
      const name = await invoke<string | null>('save_conflict_copy', { token: document.token, markdown, assets })
      setStatus(name ? `已保存本地副本 ${name}；原文件冲突仍待处理` : '已取消副本保存，本地内容仍保留')
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  function runFileAction(action: string) {
    const now = performance.now()
    if (lastFileAction.current.action === action && now - lastFileAction.current.at < 400) return
    lastFileAction.current = { action, at: now }
    if (action === 'new') void newDocument()
    if (action === 'open') void openDocument()
    if (action === 'open-folder') void chooseWorkspace()
    if (action === 'save') void saveDocument()
    if (action === 'save-as') void saveDocument(true)
    if (action === 'export-md') void exportSnapshotMD(false)
    if (action === 'export-html') void exportPage('html')
    if (action === 'print') void exportPage('print')
    if (action === 'view-toolbar') setSettings((current) => ({ ...current, showFileToolbar: !current.showFileToolbar }))
    if (action === 'view-sidebar') setSidebarOpen((current) => !current)
    if (action === 'preferences') setSettingsOpen(true)
    if (action === 'close-tab') void closeTabs([activeTabKeyRef.current])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (desktop) runFileAction(event.shiftKey ? 'save-as' : 'save')
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        runFileAction('new')
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        runFileAction(event.shiftKey ? 'open-folder' : 'open')
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        runFileAction('close-tab')
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        runFileAction('preferences')
      }
      if (event.key === 'Escape') {
        setTabMenu(null)
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const menuActionRef = useRef<(action: string) => void>(() => undefined)
  menuActionRef.current = runFileAction
  useEffect(() => {
    if (!desktop) return
    let stop: (() => void) | undefined
    let canceled = false
    void listen<string>('menu-action', (event) => menuActionRef.current(event.payload)).then((unlisten) => { if (canceled) unlisten(); else stop = unlisten })
    return () => { canceled = true; stop?.() }
  }, [desktop])

  useEffect(() => {
    if (!busy && queuedSave.current && isDirty(sessionRef.current)) {
      queuedSave.current = false
      void saveDocument()
    }
  }, [busy, session.revision])

  useEffect(() => {
    if (!desktop) return
    let unlisten: (() => void) | undefined
    let canceled = false
    getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault()
      if (closingWindowRef.current) return
      closingWindowRef.current = true
      void (async () => {
        try {
          for (const key of tabsRef.current.map((tab) => tab.key)) {
            if (key !== activeTabKeyRef.current) {
              switchTab(key)
              await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
            }
            if (!await canProceedRef.current(true)) return
          }
          await draftWriteChain.current.catch(() => undefined)
          await exit(0)
        } finally { closingWindowRef.current = false }
      })().catch((error: unknown) => setStatus(errorText(error)))
    }).then((stop) => {
      if (canceled) stop()
      else unlisten = stop
    }).catch((error: unknown) => setStatus(errorText(error)))
    return () => { canceled = true; unlisten?.() }
  }, [desktop])

  async function selectSample(sampleId: string) {
    if (busy || !await canProceed()) {
      setStatus('已取消切换，当前文档未改变')
      return
    }
    const sample = samples.find((item) => item.id === sampleId) ?? samples[0]
    try { await finishLeave() }
    catch (error) { setStatus(errorText(error)); return }
    setDocument(makeDocument(sample.markdown, sample.label, sample.id))
  }

  function checkRoundTrip() {
    if (!adapter.current || document.mode === 'source-protected') return
    const original = new TextEncoder().encode(document.originalMarkdown)
    const candidate = new TextEncoder().encode(composeVisualMarkdown(document.prepared.analysis, adapter.current.getPersistableMarkdown()))
    const issues = compareMarkdown(original, candidate)
    setStatus(issues.length === 0 ? '语义往返通过' : `发现 ${issues.map((issue) => issue.code).join('、')}`)
  }

  function switchToSource() {
    const instance = adapter.current
    if (!instance || busy || document.mode !== 'visual') return
    if (instance.hasPendingAssets()) {
      setStatus('请先保存待处理图片，再切换到源码模式')
      return
    }
    const sourceText = isDirty(sessionRef.current)
      ? composeVisualMarkdown(document.prepared.analysis, instance.getPersistableMarkdown())
      : document.originalMarkdown
    const id = nextDocumentId++
    updateSession({ ...sessionRef.current, generation: id })
    setDocument({ ...document, id, mode: 'source-protected', sourceText })
  }

  function applyLink() {
    const href = safeLinkHref(linkHref)
    if (!href) { setStatus('链接地址无效或使用了不允许的协议'); return }
    adapter.current?.setLink(href)
    setLinkOpen(false)
  }

  async function switchToVisual() {
    if (busy || document.mode !== 'source-protected') return
    const prepared = prepareMarkdown(document.sourceText)
    if (prepared.analysis.mode !== 'visual') {
      setStatus(`仍需源码保护：${prepared.analysis.issues.map((issue) => issue.code).join('、')}`)
      return
    }
    setBusy(true)
    try {
      const visual = await hydrateImages({ token: document.token, name: document.name, markdown: document.sourceText, revision: document.revision })
      const recoveredReplacements = new Map<string, string>()
      for (const [oldUrl, asset] of document.recoveredAssets) {
        const newUrl = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }))
        recoveredReplacements.set(oldUrl, newUrl)
        visual.recoveredAssets.set(newUrl, asset)
      }
      try { visual.markdown = rewriteImageUrls(visual.markdown, recoveredReplacements) }
      catch {
        for (const url of visual.recoveredAssets.keys()) URL.revokeObjectURL(url)
        for (const url of visual.imageUrls.keys()) URL.revokeObjectURL(url)
        setStatus('图片引用无法安全恢复，请继续使用源码模式')
        return
      }
      updateSession({ ...sessionRef.current, generation: visual.id })
      setDocument({ ...visual, originalMarkdown: document.originalMarkdown, sampleId: document.sampleId })
    } finally {
      setBusy(false)
    }
  }

  function renderToolbarButton(item: (typeof toolbarItems)[number], inMenu = false) {
    const active = ({ bold: 'strong', italic: 'emphasis', strike: 'strike_through', inlineCode: 'inlineCode', bullet: 'bullet_list', ordered: 'ordered_list', quote: 'blockquote', codeBlock: 'code_block' } as Record<string, string>)[item.command]
    const pressed = active ? (['bullet', 'ordered', 'quote', 'codeBlock'].includes(item.command) ? toolbar.block === active : toolbar.marks.includes(active)) : undefined
    const Icon = item.icon
    return <button key={item.command} type="button" className={inMenu ? 'menu-command' : 'icon-button'} title={item.label} aria-label={item.label} aria-pressed={pressed} disabled={!toolbar.ready || toolbar.composing || item.command === 'undo' && !toolbar.canUndo || item.command === 'redo' && !toolbar.canRedo} onClick={() => adapter.current?.runCommand(item.command)}><Icon aria-hidden="true" />{inMenu && <span>{item.label}</span>}</button>
  }
  const persistenceLabel = session.persistence === 'saving' ? '保存中' : session.persistence === 'failed' ? '保存失败' : session.persistence === 'conflict' ? '磁盘冲突' : dirty ? '未保存' : document.token ? '已保存' : '未保存到磁盘'

  return (
    <main className="app-shell" onClick={() => { if (tabMenu) setTabMenu(null) }}>
      {settings.showFileToolbar && <div className="file-controls" aria-label="文档操作">
        <button type="button" className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-expanded={sidebarOpen} aria-controls="document-sidebar" aria-label={sidebarOpen ? '隐藏文件栏' : '显示文件栏'} title={sidebarOpen ? '隐藏文件栏' : '显示文件栏'}><PanelLeft aria-hidden="true" /></button>
        <span className="control-divider" aria-hidden="true" />
        <button type="button" className="control-button" onClick={() => void chooseWorkspace()} disabled={!desktop || busy}><FolderOpen aria-hidden="true" />打开文件夹</button>
        <button type="button" className="control-button" onClick={() => void openDocument()} disabled={!desktop || busy}><FileText aria-hidden="true" />打开文件</button>
        <button type="button" className="control-button" onClick={() => void newDocument()} disabled={busy}><Plus aria-hidden="true" />新建</button>
        <span className="control-spacer" />
        {!welcomeVisible && <button type="button" className="control-button save-button" onClick={() => void saveDocument()} disabled={!desktop || busy}><Save aria-hidden="true" />保存 <kbd>⌘S</kbd></button>}
        {!welcomeVisible && <details className="more-actions"><summary aria-label="文档更多操作" title="文档更多操作"><MoreHorizontal aria-hidden="true" /></summary><div className="more-actions-menu">
          <button type="button" onClick={() => void saveDocument(true)} disabled={!desktop || busy || !document.token}><Save aria-hidden="true" />另存为</button>
          {document.mode === 'visual'
            ? <button type="button" onClick={switchToSource} disabled={busy}><Code2 aria-hidden="true" />源码模式</button>
            : <button type="button" onClick={() => void switchToVisual()} disabled={busy}><FileText aria-hidden="true" />可视化模式</button>}
          <div className="menu-separator" />
          <button type="button" onClick={() => void exportPage('html')} disabled={!desktop || busy || document.mode === 'source-protected'}><Download aria-hidden="true" />导出 HTML</button>
          <button type="button" onClick={() => void exportPage('print')} disabled={!desktop || busy || document.mode === 'source-protected'}><Printer aria-hidden="true" />打印 / PDF</button>
          {document.mode === 'visual' && <button type="button" onClick={() => void exportSnapshotMD(false)} disabled={!desktop || busy}><Download aria-hidden="true" />导出 MD + 图片</button>}
          <button type="button" onClick={() => void exportSnapshotMD(true)} disabled={!desktop || busy}><Download aria-hidden="true" />仅正文 MD</button>
        </div></details>}
      </div>}
      {imageError && <div className="conflict-panel" role="alert"><strong>图片处理失败</strong><span>{imageError}</span><button type="button" onClick={() => void adapter.current?.retryFailedImages()}>重试</button><span>也可删除该图片后重新插入。</span></div>}
      {drafts.length > 0 && <section className="recovery-panel" aria-label="恢复草稿">
        <strong>可恢复草稿</strong>
        {drafts.map((item) => <div key={item.draftId} className="recovery-item">
          <span>{item.name}{item.targetStatus === 'changed' ? ' · 原文件已变化' : item.targetStatus === 'deleted' ? ' · 原文件已删除' : ''}</span>
          <button type="button" disabled={busy} onClick={() => void previewDraft(item.draftId)}>预览</button>
          <button type="button" disabled={busy} onClick={() => void recoverDraft(item.draftId)}>恢复到新文档</button>
          <button type="button" disabled={busy} onClick={() => void discardDraft(item.draftId).catch((error: unknown) => setStatus(errorText(error)))}>丢弃</button>
        </div>)}
      </section>}
      {draftPreview && <section className="disk-preview" aria-label="草稿预览">
        <div><strong>草稿预览：{draftPreview.name} · {draftPreview.assets.length} 张图片</strong><button type="button" onClick={() => setDraftPreview(null)}>关闭预览</button></div>
        {draftPreview.targetPath && <p>原文件：{draftPreview.targetPath} · {draftPreview.targetStatus === 'same' ? '与草稿基线相同' : '已变化或不可确认'}</p>}
        <pre>{draftPreview.markdown.slice(0, 100_000)}{draftPreview.markdown.length > 100_000 ? '\n…预览仅显示前 100000 字符' : ''}</pre>
      </section>}
      {diskChange && <div className="conflict-panel" role="alert">
        <strong>{diskChange.kind === 'deleted' ? '磁盘文件已删除' : '磁盘文件已改变'}</strong>
        <span>当前编辑内容仍在本窗口中。请选择下一步。</span>
        {diskChange.kind !== 'deleted' && <button type="button" onClick={() => void previewDiskVersion()}>查看磁盘版本</button>}
        <button type="button" onClick={() => void saveConflictCopy()}>保留本地副本</button>
        {diskChange.kind !== 'deleted' && <button type="button" onClick={() => void reloadDiskVersion()}>重新加载磁盘版本</button>}
      </div>}
      {diskPreview !== null && <section className="disk-preview" aria-label="磁盘版本预览">
        <div><strong>磁盘版本预览</strong><button type="button" onClick={() => setDiskPreview(null)}>关闭预览</button></div>
        <pre>{diskPreview.slice(0, 100_000)}{diskPreview.length > 100_000 ? '\n…预览仅显示前 100000 字符' : ''}</pre>
      </section>}
      <div className="workspace-layout">
        {sidebarOpen && <aside id="document-sidebar" ref={sidebarRoot} className="document-sidebar" aria-label="文件浏览器" style={{ width: settings.sidebarWidth }}>
          <div className="sidebar-heading"><h2>文件</h2><button type="button" className="icon-button" title="打开文件夹" aria-label="打开文件夹" onClick={() => void chooseWorkspace()} disabled={!desktop}><FolderOpen aria-hidden="true" /></button></div>
          {document.token && !document.entryToken && <div className="standalone-file"><h3>单独打开</h3><div className="tree-entry" aria-current="page" title={document.name}><FileText className="tree-icon" aria-hidden="true" /><span className="tree-name">{document.name}</span></div></div>}
          {!workspace && !document.token && <div className="sidebar-empty"><FileText className="sidebar-empty-icon" aria-hidden="true" /><p>还没有打开文档</p><span>拖入 Markdown 文件或文件夹，也可以使用上方按钮</span></div>}
          {workspace && <>
            <div className="tree-header"><ChevronDown aria-hidden="true" /><strong title={workspace.name}>{workspace.name}</strong><button type="button" className="icon-button" onClick={() => void loadChildren(workspace.token)} title="刷新目录" aria-label="刷新目录"><RefreshCw aria-hidden="true" /></button></div>
            <div role="tree" aria-label="文件夹目录" className="file-tree">{renderChildren(workspace.token)}</div>
            <div className="tree-actions"><button type="button" onClick={() => { setNewEntryType('file'); setNewEntryName('新文档.md') }}><FilePlus2 aria-hidden="true" />新建文档</button><details className="tree-action-menu"><summary aria-label="目录操作" title="目录操作"><MoreHorizontal aria-hidden="true" /></summary><div className="tree-action-popup">
              <button type="button" onClick={() => { setNewEntryType('directory'); setNewEntryName('新目录') }}><FolderPlus aria-hidden="true" />新建目录</button>
              <button type="button" disabled={!selectedEntry} onClick={() => { setRenameName(selectedEntry?.name ?? ''); setRenaming(true) }}><Pencil aria-hidden="true" />重命名</button>
              <button type="button" disabled={!selectedEntry} onClick={() => void trashEntry()}><Trash2 aria-hidden="true" />移到废纸篓</button>
              <div className="menu-separator" />
              <button type="button" onClick={() => void closeWorkspace()}><X aria-hidden="true" />关闭文件夹</button>
            </div></details></div>
            {newEntryType && <div className="tree-form"><label>{newEntryType === 'file' ? '文件名' : '目录名'}<input value={newEntryName} onChange={(event) => setNewEntryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createEntry(); if (event.key === 'Escape') setNewEntryType(null) }} /></label><button type="button" onClick={() => void createEntry()}>创建</button><button type="button" onClick={() => setNewEntryType(null)}>取消</button></div>}
            {renaming && <div className="tree-form"><label>新名称<input value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameEntry(); if (event.key === 'Escape') setRenaming(false) }} /></label><button type="button" onClick={() => void renameEntry()}>确定</button><button type="button" onClick={() => setRenaming(false)}>取消</button></div>}
          </>}
          {recent.length > 0 && <div className="recent-list"><h2>最近使用</h2>{recent.map((item, index) => <div className="recent-item" key={item.id}><button type="button" onClick={() => void openRecent(item)} title={item.name}>{item.kind === 'folder' ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />}<span>{item.name}{!item.available ? ' · 失效' : ''}</span></button><button type="button" className="recent-move" aria-label={`上移 ${item.name}`} title="上移" disabled={index === 0} onClick={() => void moveRecent(item.id, -1)}><ArrowUp aria-hidden="true" /></button><button type="button" className="recent-move" aria-label={`下移 ${item.name}`} title="下移" disabled={index === recent.length - 1} onClick={() => void moveRecent(item.id, 1)}><ArrowDown aria-hidden="true" /></button><button type="button" className="recent-remove" aria-label={`移除 ${item.name}`} title="移除记录" onClick={() => void removeRecent(item.id)}><X aria-hidden="true" /></button></div>)}</div>}
        </aside>}
      {welcomeVisible ? <section className="welcome-panel" aria-label="开始使用 MinoMarkdown">
        <div className="welcome-content">
        <FileText className="welcome-icon" aria-hidden="true" />
        <h2>打开 Markdown 文档</h2>
        <p>直接打开一篇文档，或打开文件夹浏览多级目录。都可以从 Finder 拖入窗口。</p>
        <div className="welcome-actions">
          <button type="button" className="welcome-primary" onClick={() => void openDocument()} disabled={!desktop}><FileText aria-hidden="true" />打开 Markdown 文件</button>
          <button type="button" onClick={() => void chooseWorkspace()} disabled={!desktop}><FolderOpen aria-hidden="true" />打开文件夹</button>
        </div>
        <div className="drop-hint">从 Finder 拖入 <strong>.md / .markdown 文件</strong>或文件夹到窗口任意位置</div>
        </div>
      </section> : <>
        <section className="editor-panel" aria-label="Markdown 编辑区域">
          <div className="document-tabbar" role="tablist" aria-label="打开的文档"><div className="document-tabs">{tabs.map((tab) => <div key={tab.key} className="document-tab" role="tab" aria-selected={tab.key === activeTabKey} draggable onDragStart={(event) => event.dataTransfer.setData('text/x-mino-tab', tab.key)} onDragOver={(event) => { if (event.dataTransfer.types.includes('text/x-mino-tab')) event.preventDefault() }} onDrop={(event) => { const from = event.dataTransfer.getData('text/x-mino-tab'); if (from) { event.preventDefault(); reorderTabs(from, tab.key) } }} onContextMenu={(event) => { event.preventDefault(); setTabMenu({ key: tab.key, x: event.clientX, y: event.clientY }) }}><button type="button" className="tab-select" onClick={() => switchTab(tab.key)} title={tab.document.name}><FileText aria-hidden="true" /><span>{tab.key === activeTabKey ? document.name : tab.document.name}</span>{isDirty(tab.key === activeTabKey ? session : tab.session) && <i className="unsaved-dot" aria-label="未保存" />}</button><button type="button" className="tab-close" onClick={() => void closeTabs([tab.key])} title={`关闭 ${tab.document.name}`} aria-label={`关闭 ${tab.document.name}`}><X aria-hidden="true" /></button></div>)}</div><div className="document-context">{document.mode === 'source-protected' ? '源码保护' : '可视化编辑'} <span className="document-save-state">{persistenceLabel}</span></div></div>
          {document.mode === 'visual' && <div className="editor-toolbar" role="toolbar" aria-label="编辑工具栏" onMouseDown={(event) => { if ((event.target as HTMLElement).closest('button')) event.preventDefault() }}>
            <select aria-label="段落样式" value={toolbar.block.startsWith('heading') ? toolbar.block : 'paragraph'} disabled={!toolbar.ready || toolbar.composing} onChange={(event) => adapter.current?.runCommand(event.target.value as EditorCommand)}>
              <option value="paragraph">正文</option>
              {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={`heading${level}`}>标题 {level}</option>)}
            </select>
            <span className="toolbar-divider" aria-hidden="true" />
            <div className="toolbar-group">{toolbarItems.filter((item) => item.primary && item.command !== 'undo' && item.command !== 'redo').map((item) => renderToolbarButton(item))}</div>
            <span className="toolbar-divider" aria-hidden="true" />
            <button type="button" className="icon-button" title="插入链接" aria-label="插入链接" disabled={!toolbar.ready || toolbar.composing} onClick={() => { setLinkHref(adapter.current?.captureSelection() ?? ''); setLinkOpen(true) }}><Link2 aria-hidden="true" /></button>
            <button type="button" className="icon-button" title="插入图片" aria-label="插入图片" disabled={!toolbar.ready || toolbar.composing} onClick={() => { imageInputAction.current = 'insert'; imageInput.current?.click() }}><ImageIcon aria-hidden="true" /></button>
            <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) { try { if (imageInputAction.current === 'replace') adapter.current?.replaceSelectedImage(file); else adapter.current?.insertFile(file) } catch (error) { setStatus(errorText(error)) } } event.target.value = '' }} />
            <details className="toolbar-more"><summary title="更多编辑工具" aria-label="更多编辑工具"><MoreHorizontal aria-hidden="true" /></summary><div className="toolbar-more-menu">
              {toolbarItems.filter((item) => !item.primary).map((item) => renderToolbarButton(item, true))}
              <div className="menu-separator" />
              <button type="button" className="menu-command" disabled={!toolbar.ready || toolbar.composing} onClick={() => adapter.current?.runTableCommand('insert')}><Table2 aria-hidden="true" />插入表格</button>
              {toolbar.inTable && <><div className="menu-separator" />{([['row', '加行'], ['column', '加列'], ['deleteRow', '删行'], ['deleteColumn', '删列'], ['alignLeft', '左对齐'], ['alignCenter', '居中'], ['alignRight', '右对齐']] as const).map(([command, label]) => <button key={command} type="button" className="menu-command" onClick={() => adapter.current?.runTableCommand(command)}><Table2 aria-hidden="true" />{label}</button>)}</>}
              {toolbar.imageAlt !== null && <><div className="menu-separator" /><button type="button" className="menu-command" onClick={() => { adapter.current?.captureSelection(); setImageAltText(toolbar.imageAlt ?? ''); setImageAltOpen(true) }}><Pencil aria-hidden="true" />图片说明</button><button type="button" className="menu-command" onClick={() => { adapter.current?.captureSelection(); imageInputAction.current = 'replace'; imageInput.current?.click() }}><ImageIcon aria-hidden="true" />替换图片</button></>}
            </div></details>
            <span className="toolbar-spacer" />
            <div className="toolbar-group">{toolbarItems.filter((item) => item.command === 'undo' || item.command === 'redo').map((item) => renderToolbarButton(item))}</div>
          </div>}
          {linkOpen && <div className="editor-popover" role="dialog" aria-label="编辑链接">
            <label>链接地址 <input autoFocus value={linkHref} onChange={(event) => setLinkHref(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyLink(); if (event.key === 'Escape') { setLinkOpen(false); adapter.current?.focus() } }} /></label>
            <button type="button" onClick={applyLink}>确定</button><button type="button" onClick={() => { setLinkOpen(false); adapter.current?.focus() }}>取消</button>
          </div>}
          {imageAltOpen && <div className="editor-popover" role="dialog" aria-label="编辑图片说明">
            <label>替代文本 <input autoFocus value={imageAltText} onChange={(event) => setImageAltText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setImageAltOpen(false); adapter.current?.focus() } }} /></label>
            <button type="button" onClick={() => { adapter.current?.setImageAlt(imageAltText); setImageAltOpen(false) }}>确定</button><button type="button" onClick={() => { setImageAltOpen(false); adapter.current?.focus() }}>取消</button>
          </div>}
          {document.mode === 'visual'
            ? <div key={document.id} ref={editorRoot} className="editor-root" />
            : <textarea key={document.id} className="source-editor" aria-label="源码保护编辑区域" value={document.sourceText} onChange={(event) => {
              const value = event.target.value
              setDocument((current) => ({ ...current, sourceText: value }))
              if (sessionRef.current.generation === document.id) updateSession(editSession(sessionRef.current))
            }} />}
        </section>
      </>}
      </div>
      <footer className="app-status"><span className="status-message" role="status" title={status}>{status}</span><span className="status-mode">{welcomeVisible ? '准备就绪' : document.mode === 'source-protected' ? '源码保护' : 'Markdown'}</span><label className="theme-control">外观 <select aria-label="外观主题" value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as Settings['theme'] }))}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></footer>
      {tabMenu && <div className="tab-context-menu" role="menu" style={{ left: Math.min(tabMenu.x, window.innerWidth - 180), top: Math.min(tabMenu.y, window.innerHeight - 120) }} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => void closeTabs([tabMenu.key])}>关闭当前</button><button type="button" role="menuitem" onClick={() => void closeTabs(tabs.slice(tabs.findIndex((tab) => tab.key === tabMenu.key) + 1).map((tab) => tab.key))} disabled={tabs.findIndex((tab) => tab.key === tabMenu.key) === tabs.length - 1}>关闭右边</button><button type="button" role="menuitem" onClick={() => void closeTabs(tabs.map((tab) => tab.key))}>关闭所有文档</button></div>}
      {settingsOpen && <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置"><div className="settings-title"><h2>设置</h2><button type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X aria-hidden="true" /></button></div><label className="settings-row"><span>外观主题</span><select value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as Settings['theme'] }))}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label className="settings-row"><span>显示文件操作栏<small>打开、新建、保存等按钮；也可从菜单栏使用这些功能</small></span><input type="checkbox" checked={settings.showFileToolbar} onChange={(event) => setSettings((current) => ({ ...current, showFileToolbar: event.target.checked }))} /></label></section></div>}
      {import.meta.env.DEV && !uiPreview && !welcomeVisible && <details className="verification-panel">
        <summary>编辑器验证样本</summary>
        <div className="spike-controls">
          <label htmlFor="sample-select">样本</label>
          <select id="sample-select" value={document.sampleId ?? ''} disabled={busy} onChange={(event) => void selectSample(event.target.value)}>
            <option value="">当前文档</option>
            {samples.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" onClick={checkRoundTrip}>检查语义往返</button>
        </div>
      </details>}
    </main>
  )
}
