import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { compareMarkdown, describeIssues, exceedsVisualLimit, protectedFragments } from '../core/markdown/compatibility'
import { prepareMarkdownAsync, renderPreviewAsync } from '../core/markdown/analysisClient'
import { composeVisualMarkdown, prepareMarkdown, type PreparedMarkdown } from '../core/markdown/codec'
import type { EditorAdapter as EditorInstance, PendingAsset, ToolbarState } from '../features/editor/EditorAdapter'
import { EditorPool } from '../features/editor/editorPool'
import { safeLinkHref } from '../features/editor/linkSafety'
import { assetUrl, isAssetUrl, relativeFromAssetUrl } from '../features/editor/assetUrl'
import { beginSave, clearExternalConflict, createSession, editSession, externalConflict, isDirty, saveCanceled, saveFailed, saveSucceeded, type DocumentSession } from '../features/document/session'
import { mayLeaveDocument, type UnsavedAction } from '../features/document/lifecycle'
import { createDraftScheduler, type DraftScheduler } from '../features/document/draftScheduler'
import { lineDiff, type DiffLine } from '../features/document/lineDiff'
import { findInText, type FindMatch } from '../features/editor/find'
import { imageUrlsIn, localAssetPath, rewriteImageUrls } from '../features/export/snapshot'
import { translate, translateStatus, type Language } from './i18n'
import { fontFamilies, type EditorFontId, type ThemeId } from './appearance'
import { applyRemoteSettings, settingsPatch } from './settingsSync'
import { blobUrl, readStaged, stageAssets, type StagedAsset } from './binary'
// Listed individually so the disabled LaTeX feature does not bundle its fonts.
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/block-edit.css'
import '@milkdown/crepe/theme/common/code-mirror.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/image-block.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import '@milkdown/crepe/theme/common/table.css'
import '@milkdown/crepe/theme/classic.css'

const spikeDocument = '# MinoMarkdown 编辑验证\n\n请在这里输入中文、英文和 Markdown。\n\n选中这段文字，再用顶部工具栏尝试加粗和撤销。\n'
const MAX_LIVE_EDITORS = 5
const loadEditorAdapter = () => import('../features/editor/EditorAdapter')
// Development-only verification samples; the production bundle does not include them.
const sampleFiles = import.meta.env.DEV ? import.meta.glob<string>('../../tests/fixtures/markdown/F0[1-5]-*.md', { query: '?raw', import: 'default' }) : {}
const loadSample = async (id: string) => { const path = Object.keys(sampleFiles).find((item) => item.includes(`/${id}-`)); return path ? sampleFiles[path]() : spikeDocument }
export const samples = [
  { id: 'intro', label: '输入验证' },
  { id: 'F01', label: 'F01 标题与文字' },
  { id: 'F02', label: 'F02 列表与引用' },
  { id: 'F03', label: 'F03 代码与转义' },
  { id: 'F04', label: 'F04 链接与图片' },
  { id: 'F05', label: 'F05 表格' },
] as const
type OpenResult = { token: string; name: string; markdown: string; revision: string; assetKey: string }
type SaveResult = OpenResult & { assetPaths: Record<string, string>; assetRelocations: Record<string, string> }
type DiskStatus = { kind: 'same' | 'changed' | 'deleted'; revision: string | null }
type DocumentState = OpenResult & { id: number; draftId: string; imageUrls: Map<string, string>; recoveredAssets: Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string }>; pendingFiles: Map<string, File>; retiredTokens: string[]; entryToken?: string; sampleId?: string; originalMarkdown: string; prepared: PreparedMarkdown; sourceText: string; mode: 'visual' | 'source-protected' }
type DraftSummary = { draftId: string; name: string; targetPath: string | null; targetStatus: 'same' | 'changed' | 'deleted' | 'unknown' | 'untitled'; snapshots: number }
type DraftContent = DraftSummary & { markdown: string; assets: StagedAsset[]; assetCount: number }
type WorkspaceRoot = { token: string; name: string }
export type WorkspaceEntry = { token: string; name: string; directory: boolean }
type ChildrenPage = { entries: WorkspaceEntry[]; nextOffset: number | null }
type SnapshotOut = { markdown: string; title: string; assets: StagedAsset[]; generation: number; revision: number }
type OpenIntent = { token: string; name: string; kind: 'markdown' | 'image' | 'folder' }
type NativeImageIntent = { name: string; mime: string; staged: string }
export type Settings = { schemaVersion: number; theme: ThemeId; sidebarWidth: number; windowWidth: number; windowHeight: number; showFileToolbar: boolean; showSidebar: boolean; editorWidth: 'centered' | 'wide'; editorFont: EditorFontId; editorFontSize: number; editorLineHeight: 'compact' | 'comfortable' | 'relaxed'; language: Language }
const defaultSettings: Settings = { schemaVersion: 1, theme: 'system', sidebarWidth: 230, windowWidth: 1100, windowHeight: 760, showFileToolbar: false, showSidebar: true, editorWidth: 'centered', editorFont: 'system', editorFontSize: 15, editorLineHeight: 'comfortable', language: 'zh-CN' }
type TabItem = { key: string; document: DocumentState; session: DocumentSession }
type DetachedAsset = { url: string; staged: string; mime: string }
type DetachedTransfer = { name: string; token: string; assetKey: string; retiredTokens: string[]; revision: string; markdown: string; originalMarkdown: string; sourceText: string; mode: DocumentState['mode']; draftId: string; session: DocumentSession; assets: DetachedAsset[]; imageUrls: [string, string][] }
type TreeState = { entries: WorkspaceEntry[]; nextOffset: number | null; expanded: boolean; loading: boolean; error: string | null }
let nextDocumentId = 1
export const uiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('ui-preview') === 'editor'
const previewTree: Record<string, TreeState> = {
  'preview-root': { entries: [{ token: 'preview-docs', name: 'doc', directory: true }, { token: 'preview-readme', name: 'README.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-docs': { entries: [{ token: 'preview-plan', name: '设计方案', directory: true }, { token: 'preview-file', name: '产品笔记.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-plan': { entries: [{ token: 'preview-spec', name: '编辑器需求.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
}

function makeDocument(markdown: string, name = '未命名', sampleId?: string, prepared = prepareMarkdown(markdown)): DocumentState {
  return { id: nextDocumentId++, draftId: crypto.randomUUID(), name, token: '', assetKey: '', revision: '', markdown: prepared.editorMarkdown, originalMarkdown: markdown, imageUrls: new Map(), recoveredAssets: new Map(), pendingFiles: new Map(), retiredTokens: [], sampleId, prepared, sourceText: markdown, mode: prepared.analysis.mode }
}

export function errorText(error: unknown): string {
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
    NOT_FOUND: '原文件或文件夹已经不在原位置，请重新选择文件或文件夹。',
  }
  return messages[code] ?? `操作失败：${code}`
}

/** Prepares an opened file without reading its images; the webview loads those lazily by URL. */
async function hydrateImages(opened: OpenResult): Promise<DocumentState> {
  const prepared = await prepareMarkdownAsync(opened.markdown)
  let markdown = prepared.editorMarkdown
  const imageUrls = new Map<string, string>()
  const replacements = new Map<string, string>()
  let hydrationFailed = false
  if (prepared.analysis.mode === 'visual' && opened.assetKey) {
    for (const relative of imageUrlsIn(markdown)) {
      const path = localAssetPath(relative)
      if (path === null) continue
      const url = assetUrl(opened.assetKey, path)
      imageUrls.set(url, relative)
      replacements.set(relative, url)
    }
  }
  try { markdown = rewriteImageUrls(markdown, replacements) }
  catch {
    hydrationFailed = true
    imageUrls.clear()
    markdown = prepared.editorMarkdown
  }
  return { ...opened, id: nextDocumentId++, draftId: crypto.randomUUID(), markdown, originalMarkdown: opened.markdown, imageUrls, recoveredAssets: new Map(), pendingFiles: new Map(), retiredTokens: [], prepared, sourceText: opened.markdown, mode: hydrationFailed ? 'source-protected' : prepared.analysis.mode }
}

export function useDocumentWorkspace() {
  const editorHost = useRef<HTMLDivElement>(null)
  const editorPool = useRef<EditorPool<EditorInstance> | null>(null)
  const previewRoot = useRef<HTMLDivElement>(null)
  const sourceEditor = useRef<HTMLTextAreaElement>(null)
  const forceSourceView = useRef(false)
  const sidebarRoot = useRef<HTMLElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const imageInputAction = useRef<'insert' | 'replace'>('insert')
  const adapter = useRef<EditorInstance | null>(null)
  const adapterDocumentId = useRef<number | null>(null)
  const draftUploads = useRef(new Map<string, Set<string>>())
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
  const tabDragRef = useRef<{ key: string; x: number; y: number } | null>(null)
  const closingTabsRef = useRef(false)
  const closingWindowRef = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'editor' | 'workspace'>('appearance')
  const queuedSave = useRef(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(busy)
  const [status, setStatus] = useState('编辑器正在启动')
  const [notice, setNotice] = useState<{ kind: 'error' | 'drafts'; message: string } | null>(null)
  const [diskConflict, setDiskConflict] = useState<{ documentId: number; revision: string | null } | null>(null)
  const diskConflictRef = useRef(diskConflict)
  diskConflictRef.current = diskConflict
  const [diskDiff, setDiskDiff] = useState<{ lines: DiffLine[] | undefined } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [findCount, setFindCount] = useState({ current: 0, total: 0 })
  const sourceFind = useRef<{ matches: FindMatch[]; index: number }>({ matches: [], index: 0 })
  const findRef = useRef({ open: findOpen, query: findQuery })
  findRef.current = { open: findOpen, query: findQuery }
  const runFindRef = useRef<(query: string) => void>(() => undefined)
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [draftPreview, setDraftPreview] = useState<DraftContent | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [toolbar, setToolbar] = useState<ToolbarState>({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, linkHref: null, imageAlt: null })
  const [linkOpen, setLinkOpen] = useState(false)
  const [sourceView, setSourceView] = useState(false)
  const [tablePicker, setTablePicker] = useState<{ x: number; y: number } | null>(null)
  const [linkHref, setLinkHref] = useState('')
  const [imageAltOpen, setImageAltOpen] = useState(false)
  const [imageAltText, setImageAltText] = useState('')
  const [workspace, setWorkspace] = useState<WorkspaceRoot | null>(uiPreview ? { token: 'preview-root', name: 'MinoMarkdown' } : null)
  const [settings, setSettings] = useState<Settings>(() => uiPreview ? { ...defaultSettings, theme: new URLSearchParams(window.location.search).get('ui-theme') === 'light' ? 'light' : 'dark' } : defaultSettings)
  const sidebarOpen = settings.showSidebar
  const t = (value: string) => translate(value, settings.language)
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
  const composingRef = useRef(false)
  composingRef.current = toolbar.composing
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const persistedSettings = useRef(settings)
  const dirty = isDirty(session)
  const activeConflict = diskConflict?.documentId === document.id
  const wantsPreview = document.mode === 'source-protected' && !sourceView && !exceedsVisualLimit(document.sourceText)
  const [preview, setPreview] = useState<{ source: string; html: string | null } | null>(null)
  const previewPending = wantsPreview && preview?.source !== document.sourceText
  const previewHtml = wantsPreview && !previewPending ? preview?.html ?? null : null
  useEffect(() => {
    if (!wantsPreview) return
    let current = true
    const source = document.sourceText
    renderPreviewAsync(source, document.assetKey || undefined).then((html) => html, () => null).then((html) => { if (current) setPreview({ source, html }) })
    return () => { current = false }
  }, [wantsPreview, document.sourceText, document.assetKey])
  const canProceedRef = useRef<(finalizeDiscard?: boolean) => Promise<boolean>>(async () => true)
  const saveDocumentRef = useRef<() => Promise<boolean>>(async () => false)
  const closeWindowRef = useRef<() => Promise<void>>(async () => undefined)

  /** Keystrokes only advance the ref; React re-renders when something visible about the session changes. */
  function updateSession(next: DocumentSession) {
    const previous = sessionRef.current
    sessionRef.current = next
    if (next.revision !== previous.revision && isDirty(next)) draftScheduler.current?.schedule()
    if (isDirty(next) !== isDirty(previous) || next.generation !== previous.generation || next.persistence !== previous.persistence || next.diskRevision !== previous.diskRevision || next.errorCode !== previous.errorCode) setSession(next)
  }

  function updateTabs(next: TabItem[]) {
    tabsRef.current = next
    setTabs(next)
  }

  /** Pulls text out of the uncontrolled source editor before anything reads `sourceText`. */
  function flushSourceText(): DocumentState {
    const element = sourceEditor.current
    const current = documentRef.current
    if (!element || current.mode !== 'source-protected' || element.value === current.sourceText) return current
    documentRef.current = { ...current, sourceText: element.value }
    setDocument(documentRef.current)
    return documentRef.current
  }

  function captureCurrentTab(): TabItem {
    flushSourceText()
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

  function noteBusy() { setStatus('当前操作尚未完成，请稍后再试') }

  function switchTab(key: string) {
    if (key === activeTabKeyRef.current) return
    if (busyRef.current) { noteBusy(); return }
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

  /** Makes `key` the active tab and waits until its content can really be saved. */
  async function focusTabForSave(key: string): Promise<boolean> {
    if (key !== activeTabKeyRef.current) {
      switchTab(key)
      if (activeTabKeyRef.current !== key) { setStatus('当前操作尚未完成，请稍后再试'); return false }
    }
    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const active = documentRef.current
      if (active.mode !== 'visual' || (adapterDocumentId.current === active.id && adapter.current?.isReady())) return true
    }
    setStatus('编辑器尚未就绪，操作已取消，内容没有改变')
    return false
  }

  async function closeTabs(keys: string[]): Promise<boolean> {
    if (closingTabsRef.current) return false
    closingTabsRef.current = true
    try {
    for (const key of keys) {
      const index = tabsRef.current.findIndex((tab) => tab.key === key)
      if (index < 0) continue
      const tab = tabsRef.current[index]
      if (key !== activeTabKeyRef.current && !isDirty(tab.session)) {
        // A clean background tab can close without loading its editor.
        updateTabs(tabsRef.current.filter((item) => item.key !== key))
        await draftWriteChain.current.catch(() => undefined)
        for (const retired of [tab.document.token, ...tab.document.retiredTokens]) await releaseCandidate(retired)
        for (const url of tab.document.imageUrls.keys()) URL.revokeObjectURL(url)
        for (const url of tab.document.recoveredAssets.keys()) URL.revokeObjectURL(url)
        for (const url of tab.document.pendingFiles.keys()) URL.revokeObjectURL(url)
        continue
      }
      if (!await focusTabForSave(key)) return false
      if (!await canProceedRef.current(true)) return false
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const closing = tabsRef.current.find((tab) => tab.key === key)
      if (!closing) continue
      const activePendingUrls = Array.from(adapter.current?.pendingFiles().keys() ?? [])
      const token = documentRef.current.token || closing.document.token
      const retiredTokens = [...closing.document.retiredTokens, ...documentRef.current.retiredTokens]
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
      for (const retired of new Set([token, ...retiredTokens])) await releaseCandidate(retired)
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

  async function detachTab(key: string) {
    if (!desktop) return
    if (busyRef.current || closingTabsRef.current) { noteBusy(); return }
    if (key !== activeTabKeyRef.current) {
      switchTab(key)
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }
    const tab = captureCurrentTab()
    const note = tab.document
    const markdown = note.mode === 'visual' ? note.markdown : note.sourceText
    const referenced = new Set(imageUrlsIn(markdown))
    setBusy(true)
    try {
      const assets: DetachedAsset[] = []
      if (note.mode === 'visual') {
        const pending = adapter.current?.isReady() ? await adapter.current.pendingAssets(false) : await Promise.all(Array.from(note.pendingFiles, async ([url, file]) => ({ url, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })))
        const uploads = pending.filter((asset) => referenced.has(asset.url))
        for (const [url, asset] of note.recoveredAssets) if (referenced.has(url) && !uploads.some((item) => item.url === url)) uploads.push({ url, ...asset })
        assets.push(...await stageAssets(uploads))
      }
      await draftWriteChain.current.catch(() => undefined)
      const transfer: DetachedTransfer = { name: note.name, token: note.token, assetKey: note.assetKey, retiredTokens: note.retiredTokens, imageUrls: Array.from(note.imageUrls), revision: note.revision, markdown, originalMarkdown: note.originalMarkdown, sourceText: note.sourceText, mode: note.mode, draftId: note.draftId, session: tab.session, assets }
      await invoke('create_workspace_window', { transfer })
      const index = tabsRef.current.findIndex((item) => item.key === key)
      const remaining = tabsRef.current.filter((item) => item.key !== key)
      if (remaining.length) { updateTabs(remaining); activateTab(remaining[Math.min(index, remaining.length - 1)]) }
      else {
        const empty = makeDocument('')
        initialDocumentId.current = empty.id
        const replacement = { key: crypto.randomUUID(), document: empty, session: createSession(empty.id) }
        updateTabs([replacement]); activateTab(replacement)
      }
      for (const url of note.imageUrls.keys()) URL.revokeObjectURL(url)
      for (const url of note.pendingFiles.keys()) URL.revokeObjectURL(url)
      for (const url of note.recoveredAssets.keys()) URL.revokeObjectURL(url)
      setStatus(`已将 ${note.name} 移到新窗口`)
    } catch (error) { setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!desktop) return
    void invoke<DetachedTransfer | null>('take_window_transfer').then(async (transfer) => {
      if (!transfer) return
      const next = makeDocument(transfer.originalMarkdown, transfer.name, undefined, await prepareMarkdownAsync(transfer.originalMarkdown))
      const replacements = new Map<string, string>()
      for (const asset of transfer.assets) {
        const bytes = await readStaged(asset.staged)
        const url = blobUrl(bytes, asset.mime)
        replacements.set(asset.url, url)
        next.recoveredAssets.set(url, { bytes, mime: asset.mime })
      }
      next.imageUrls = new Map(transfer.imageUrls)
      next.assetKey = transfer.assetKey
      next.retiredTokens = transfer.retiredTokens
      next.token = transfer.token
      next.revision = transfer.revision
      next.draftId = transfer.draftId
      next.markdown = rewriteImageUrls(transfer.markdown, replacements)
      next.sourceText = transfer.sourceText
      next.mode = transfer.mode
      openTab(next, { ...transfer.session, generation: next.id })
    }).catch((error: unknown) => setStatus(errorText(error)))
  }, [desktop])

  useEffect(() => {
    if (sessionRef.current.generation !== document.id) updateSession(createSession(document.id, document.revision || null))
    setToolbar({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, linkHref: null, imageAlt: null })
    setLinkOpen(false)
    setSourceView(forceSourceView.current || (findRef.current.open && document.mode === 'source-protected'))
    forceSourceView.current = false
    setTablePicker(null)
    setImageAltOpen(false)
    if (document.mode === 'source-protected') {
      setStatus(`源码模式：${describeIssues(document.prepared.analysis) || '手动切换'}；可保存原文，HTML/PDF 暂不可导出`)
      if (findRef.current.open) window.setTimeout(() => runFindRef.current(findRef.current.query), 0)
      return
    }
    let disposed = false
    void loadEditorAdapter().then(({ EditorAdapter }) => {
      const host = editorHost.current
      if (disposed || !host) return
      editorPool.current ??= new EditorPool<EditorInstance>(host, MAX_LIVE_EDITORS, (editor) => editor.dispose(), () => { const root = window.document.createElement('div'); root.className = 'editor-root'; return root })
      const { editor: instance, created } = editorPool.current.activate(document.id, (root) => new EditorAdapter(root, document.markdown, () => {
        if (sessionRef.current.generation === document.id) updateSession(editSession(sessionRef.current))
      }, document.imageUrls, document.recoveredAssets, document.pendingFiles, setToolbar, (message) => { if (message) setStatus(message) }, setTablePicker, (href) => linkOpenRef.current(href)))
      adapter.current = instance
      adapterDocumentId.current = document.id
      editorPool.current.retain(new Set([documentRef.current.id, ...tabsRef.current.map((tab) => tab.document.id)]))
      if (!created) {
        void instance.create().then(() => { if (!disposed) { instance.resume(); reapplyFind(instance); setStatus(document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存') } }).catch(() => undefined)
        return
      }
      const revisionAtStart = sessionRef.current.revision
      void instance.create().then(() => {
        reapplyFind(instance)
        if (!disposed && sessionRef.current.revision === revisionAtStart && !fragmentsSurvived(instance)) {
          // The editor would change raw HTML or footnotes, so this document stays source-only.
          const current = documentRef.current
          const issues = [...current.prepared.analysis.issues, { code: 'ROUNDTRIP_RISK' as const, detail: 'Visual editor changed protected fragments' }]
          const id = nextDocumentId++
          updateSession({ ...sessionRef.current, generation: id })
          setDocument({ ...current, id, mode: 'source-protected', prepared: { ...current.prepared, analysis: { ...current.prepared.analysis, mode: 'source-protected', issues } } })
          return
        }
        if (!disposed) {
          setStatus(document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存')
          if (!document.token) instance.focus()
        }
      }).catch((error: unknown) => {
        if (!disposed) setStatus(`编辑器启动失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }).catch((error: unknown) => {
      if (!disposed) setStatus(`编辑器启动失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      disposed = true
      adapter.current = null
      adapterDocumentId.current = null
    }
  }, [document.id])

  function fragmentsSurvived(instance: EditorInstance): boolean {
    const expected = documentRef.current.prepared.analysis.fragments ?? []
    if (expected.length === 0) return true
    try { return JSON.stringify(protectedFragments(instance.getMarkdown())) === JSON.stringify(expected) }
    catch { return false }
  }

  useEffect(() => () => { editorPool.current?.destroyAll(); editorPool.current = null }, [])

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
    const root = window.document.documentElement
    const lineHeights = { compact: '1.45', comfortable: '1.7', relaxed: '1.95' }
    root.style.setProperty('--editor-font', fontFamilies[settings.editorFont])
    root.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`)
    root.style.setProperty('--editor-line-height', lineHeights[settings.editorLineHeight])
  }, [settings.editorFont, settings.editorFontSize, settings.editorLineHeight])

  useEffect(() => {
    window.document.documentElement.lang = settings.language
  }, [settings.language])

  useEffect(() => {
    const current = documentRef.current
    if (current.token || !['未命名', 'Untitled'].includes(current.name)) return
    const name = settings.language === 'en-US' ? 'Untitled' : '未命名'
    if (current.name === name) return
    documentRef.current = { ...current, name }
    setDocument(documentRef.current)
    updateTabs(tabsRef.current.map((tab) => tab.key === activeTabKeyRef.current ? { ...tab, document: documentRef.current } : tab))
  }, [settings.language])

  useEffect(() => {
    if (!desktop) return
    let stop: (() => void) | undefined
    let canceled = false
    void listen<Settings>('settings-changed', (event) => {
      const merged = applyRemoteSettings(settingsRef.current, persistedSettings.current, event.payload)
      persistedSettings.current = merged.persisted
      if (merged.current !== settingsRef.current) setSettings(merged.current)
    }).then((unlisten) => { if (canceled) unlisten(); else stop = unlisten })
    return () => { canceled = true; stop?.() }
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    void invoke<Settings>('get_settings').then((loaded) => {
      persistedSettings.current = loaded
      setSettings(loaded)
      setSettingsLoaded(true)
      void getCurrentWindow().setSize(new LogicalSize(loaded.windowWidth, loaded.windowHeight)).catch(() => undefined)
    }).catch((error: unknown) => { setSettingsLoaded(true); setStatus(errorText(error)) })
  }, [desktop])

  useEffect(() => {
    if (!desktop || !settingsLoaded) return
    const patch = settingsPatch(persistedSettings.current, settings)
    if (!patch) return
    const timer = window.setTimeout(() => {
      invoke<Settings>('update_settings', { patch })
        .then(() => { persistedSettings.current = { ...persistedSettings.current, ...patch } })
        .catch((error: unknown) => setStatus(errorText(error)))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [desktop, settingsLoaded, settings])

  useEffect(() => {
    // Only the first window offers recovery, so a new window doesn't repeat the prompt.
    if (!desktop || !settingsLoaded || getCurrentWindow().label !== 'main') return
    void invoke<DraftSummary[]>('list_drafts').then((found) => {
      if (found.length === 0) return
      setDrafts(found)
      setNotice({ kind: 'drafts', message: `发现 ${found.length} 份可恢复的草稿` })
    }).catch(() => undefined)
  }, [desktop, settingsLoaded])

  useEffect(() => {
    // The window starts hidden so the default theme and size never flash before saved settings apply.
    if (!desktop || !settingsLoaded) return
    requestAnimationFrame(() => requestAnimationFrame(() => void invoke('show_workspace_window').catch(() => undefined)))
  }, [desktop, settingsLoaded])

  useEffect(() => {
    if (!desktop || !settingsLoaded) return
    let timer: number | undefined
    const onResize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setSettings((current) => ({ ...current, windowWidth: Math.max(720, Math.min(3000, window.innerWidth)), windowHeight: Math.max(520, Math.min(2000, window.innerHeight)) })), 250)
    }
    window.addEventListener('resize', onResize)
    return () => { window.clearTimeout(timer); window.removeEventListener('resize', onResize) }
  }, [desktop, settingsLoaded])

  useEffect(() => {
    const element = sidebarRoot.current
    if (!element || !settingsLoaded) return
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const width = Math.round(element.getBoundingClientRect().width)
        if (width >= 170 && width <= 420) setSettings((current) => current.sidebarWidth === width ? current : { ...current, sidebarWidth: width })
      }, 200)
    })
    observer.observe(element)
    return () => { window.clearTimeout(timer); observer.disconnect() }
  }, [sidebarOpen, settingsLoaded])

  async function rememberDocument(token: string): Promise<void> {
    await invoke('remember_recent_document', { token })
  }

  async function rememberWorkspace(token: string): Promise<void> {
    await invoke('remember_recent_workspace', { token })
  }

  /** Sends one draft snapshot. Images already stored in the draft are referenced, not resent. */
  async function sendDraft(note: DocumentState, diskRevision: string | null, markdown: string, instance: EditorInstance | null, fullUpload = false): Promise<void> {
    const visual = note.mode === 'visual'
    const live = visual && instance?.isReady() ? instance : null
    const referenced = live ? live.referencedImageUrls() : new Set(imageUrlsIn(markdown))
    const stored = fullUpload ? new Set<string>() : draftUploads.current.get(note.draftId) ?? new Set<string>()
    const retained = [...stored].filter((url) => referenced.has(url))
    const skip = new Set(retained)
    const uploads: PendingAsset[] = live ? await live.pendingAssets(false, skip) : []
    if (!live) for (const [url, asset] of note.recoveredAssets) if (referenced.has(url) && !skip.has(url)) uploads.push({ url, ...asset })
    const diskAssets = visual && note.token ? Array.from(note.imageUrls, ([url, relative]) => ({ url, relative: localAssetPath(relative) })).filter((asset) => referenced.has(asset.url) && !skip.has(asset.url) && asset.relative !== null) : []
    try {
      const saved = await invoke<string[]>('write_draft', { draftId: note.draftId, name: note.name, token: note.token || null, baseDiskRevision: diskRevision, markdown, assets: await stageAssets(uploads), diskAssets, retained })
      draftUploads.current.set(note.draftId, new Set(saved))
    } catch (error) {
      if (String(error) === 'DRAFT_ASSET_MISSING' && !fullUpload) return sendDraft(note, diskRevision, markdown, instance, true)
      throw error
    }
  }

  function persistTabDraft(tab: TabItem, instance: EditorInstance | null, requireSuccess = false): Promise<void> {
    const { document: savedDocument, session: savedSession } = tab
    const markdown = savedDocument.mode === 'visual' ? composeVisualMarkdown(savedDocument.prepared.analysis, savedDocument.markdown) : savedDocument.sourceText
    draftWriteChain.current = draftWriteChain.current.catch(() => undefined)
      .then(() => sendDraft(savedDocument, savedSession.diskRevision, markdown, instance))
      .catch((error: unknown) => {
        setNotice({ kind: 'error', message: `草稿保存失败：${errorText(error)}` })
        if (requireSuccess) throw error
      })
    return draftWriteChain.current
  }

  function currentTabSnapshot(): TabItem {
    const current = flushSourceText()
    let markdown = current.markdown
    if (current.mode === 'visual' && adapter.current?.isReady()) markdown = adapter.current.getMarkdown()
    return {
      key: activeTabKeyRef.current,
      document: { ...current, markdown, pendingFiles: adapter.current?.pendingFiles() ?? current.pendingFiles },
      session: sessionRef.current,
    }
  }

  const draftScheduler = useRef<DraftScheduler | null>(null)
  draftScheduler.current ??= createDraftScheduler(() => draftTimerRef.current(), 1500, 10000)
  const draftTimerRef = useRef<() => void>(() => undefined)
  draftTimerRef.current = () => {
    if (!isDirty(sessionRef.current)) return
    if (composingRef.current) { draftScheduler.current?.schedule(); return }
    if (documentRef.current.mode === 'visual' && !adapter.current?.isReady()) { draftScheduler.current?.schedule(); return }
    void persistTabDraft(currentTabSnapshot(), adapter.current)
  }

  useEffect(() => {
    if (desktop && isDirty(sessionRef.current) && sessionRef.current.generation === document.id && !toolbar.composing) draftScheduler.current?.schedule()
  }, [desktop, document.id, dirty, toolbar.composing])

  useEffect(() => () => draftScheduler.current?.cancel(), [document.id])

  async function discardDraft(draftId: string): Promise<void> {
    await draftWriteChain.current
    await invoke('discard_draft', { draftId })
    draftUploads.current.delete(draftId)
    setDrafts((current) => current.filter((item) => item.draftId !== draftId))
  }

  async function recoverDraft(draftId: string): Promise<void> {
    if (busy) { noteBusy(); return }
    setBusy(true)
    try {
      const recovered = await invoke<DraftContent>('read_draft', { draftId, includeAssets: true })
      const next = makeDocument(recovered.markdown, recovered.name, undefined, await prepareMarkdownAsync(recovered.markdown))
      next.draftId = draftId
      const sourceAssets = new Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string }>()
      const replacements = new Map<string, string>()
      for (const asset of recovered.assets) {
        const bytes = await readStaged(asset.staged)
        const url = next.mode === 'visual' ? blobUrl(bytes, asset.mime) : asset.url
        if (next.mode === 'visual') replacements.set(asset.url, url)
        sourceAssets.set(url, { bytes, mime: asset.mime })
      }
      // Attachments that were unreadable when the draft was written fall back to their relative path.
      for (const url of imageUrlsIn(recovered.markdown)) {
        const relative = relativeFromAssetUrl(url)
        if (isAssetUrl(url) && relative && !replacements.has(url) && !sourceAssets.has(url)) replacements.set(url, relative)
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
      setDraftsOpen(false)
      setDraftPreview(null)
      setStatus(recovered.targetStatus === 'changed' ? '已恢复草稿；原文件已有新版本，保存时请选择新文件名' : '已恢复草稿；请检查内容后保存')
    } catch (error) { setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  async function previewDraft(draftId: string): Promise<void> {
    try { setDraftPreview(await invoke<DraftContent>('read_draft', { draftId, includeAssets: false })) }
    catch (error) { setStatus(errorText(error)) }
  }

  useEffect(() => {
    if (!desktop || !document.token) return
    let active = true
    let inFlight = false
    let deleted = false
    const poll = async () => {
      if (inFlight || busyRef.current || composingRef.current || sessionRef.current.generation !== document.id || sessionRef.current.persistence === 'saving') return
      inFlight = true
      const expectedAtStart = sessionRef.current.diskRevision
      try {
        const result = await invoke<DiskStatus>('check_document_revision', { token: document.token })
        if (!active || sessionRef.current.generation !== document.id || sessionRef.current.diskRevision !== expectedAtStart) return
        if (result.kind === 'same' || result.revision === sessionRef.current.diskRevision) {
          if (deleted) {
            deleted = false
            updateSession(clearExternalConflict(sessionRef.current))
          }
          if (diskConflictRef.current?.documentId === document.id) {
            setDiskConflict(null)
            updateSession(clearExternalConflict(sessionRef.current))
          }
        } else if (result.kind === 'deleted') {
          if (!deleted) {
            deleted = true
            updateSession(externalConflict(sessionRef.current))
            setStatus('磁盘文件已删除；当前编辑内容保留在窗口中')
          }
        } else {
          if (busyRef.current) return
          if (isDirty(sessionRef.current)) {
            // Never replace unsaved work: the user chooses from the conflict notice.
            if (diskConflictRef.current?.documentId !== document.id || diskConflictRef.current.revision !== result.revision) {
              setDiskConflict({ documentId: document.id, revision: result.revision })
              updateSession(externalConflict(sessionRef.current))
            }
            return
          }
          await reloadFromDisk(active)
        }
      } catch (error) {
        if (active) {
          updateSession(externalConflict(sessionRef.current))
          setStatus(`自动重新加载失败：${errorText(error)}`)
        }
      } finally {
        inFlight = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3000)
    window.addEventListener('focus', poll)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', poll) }
  }, [desktop, document.id, document.token])

  /** Replaces the active document with the disk version, keeping any unsaved text recoverable as a draft. */
  async function reloadFromDisk(stillWanted = true): Promise<void> {
    const documentId = documentRef.current.id
    const token = documentRef.current.token
    const wasDirty = isDirty(sessionRef.current)
    const lockedEditor = adapter.current?.rootElement ?? null
    const lockedSource = sourceEditor.current
    busyRef.current = true
    setBusy(true)
    lockedEditor?.setAttribute('inert', '')
    if (lockedSource) lockedSource.readOnly = true
    try {
      if (wasDirty) await persistTabDraft(currentTabSnapshot(), adapter.current, true)
      if (!stillWanted || documentRef.current.id !== documentId) return
      const opened = await invoke<OpenResult>('reload_document', { token })
      const next = await hydrateImages(opened)
      if (documentRef.current.id !== documentId) return
      const previous = documentRef.current
      next.retiredTokens = previous.retiredTokens
      next.entryToken = previous.entryToken
      updateSession(createSession(next.id, next.revision))
      documentRef.current = next
      setDocument(next)
      updateTabs(tabsRef.current.map((tab) => tab.key === activeTabKeyRef.current ? { ...tab, document: next, session: sessionRef.current } : tab))
      for (const url of previous.imageUrls.keys()) URL.revokeObjectURL(url)
      for (const url of previous.recoveredAssets.keys()) URL.revokeObjectURL(url)
      for (const url of previous.pendingFiles.keys()) URL.revokeObjectURL(url)
      setDiskConflict(null)
      setStatus(wasDirty ? '已加载磁盘最新版本；未保存修改已留在恢复草稿中' : '已加载磁盘最新版本')
    } finally {
      lockedEditor?.removeAttribute('inert')
      if (lockedSource) lockedSource.readOnly = false
      busyRef.current = false
      setBusy(false)
    }
  }

  function currentDocumentText(): string {
    const current = flushSourceText()
    return current.mode === 'visual' && adapter.current?.isReady() ? composeVisualMarkdown(current.prepared.analysis, adapter.current.getPersistableMarkdown()) : current.sourceText
  }

  async function showDiskDiff(): Promise<void> {
    try {
      const disk = await invoke<string>('read_disk_version', { token: documentRef.current.token })
      setDiskDiff({ lines: lineDiff(disk, currentDocumentText()) ?? undefined })
    } catch (error) { setStatus(errorText(error)) }
  }

  async function useDiskVersion(): Promise<void> {
    if (busyRef.current) { noteBusy(); return }
    try { await reloadFromDisk() }
    catch (error) { setNotice({ kind: 'error', message: `无法加载磁盘版本：${errorText(error)}` }) }
  }

  async function saveConflictCopyAs(): Promise<void> {
    if (busyRef.current) { noteBusy(); return }
    setBusy(true)
    try {
      const markdown = currentDocumentText()
      const assets = adapter.current?.isReady() ? await adapter.current.pendingAssets() : []
      const name = await invoke<string | null>('save_conflict_copy', { token: documentRef.current.token, markdown, assets: await stageAssets(assets) })
      setStatus(name ? `已另存副本 ${name}；可继续选择使用磁盘版本` : '已取消另存，当前内容仍在编辑器中')
    } catch (error) { setNotice({ kind: 'error', message: errorText(error) }) }
    finally { setBusy(false) }
  }

  function refreshDrafts() {
    void invoke<DraftSummary[]>('list_drafts').then(setDrafts).catch((error: unknown) => setStatus(errorText(error)))
  }

  async function canProceed(finalizeDiscard = false): Promise<boolean> {
    if (busy) { setStatus('当前操作尚未完成，请稍后再试'); return false }
    if (!isDirty(sessionRef.current)) { pendingDiscardDraftId.current = null; return true }
    pendingDiscardDraftId.current = null
    if (!desktop) return window.confirm(translateStatus('当前修改尚未保存。确定放弃修改吗？', settings.language))
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
        adapter.current.insertFile(new File([await readStaged(image.staged)], image.name, { type: image.mime }))
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
    void getCurrentWindow().listen('open-intents-available', () => void drain()).then((stop) => { if (canceled) stop(); else unlisten = stop }).catch((error: unknown) => setStatus(errorText(error)))
    void getCurrentWindow().listen('open-intents-empty-drop', () => setStatus('macOS 未提供拖入文件路径，请从 Finder 拖入本地 Markdown 文件')).then((stop) => { if (canceled) stop(); else unlistenEmpty = stop }).catch((error: unknown) => setStatus(errorText(error)))
    void drain()
    return () => { canceled = true; unlisten?.(); unlistenEmpty?.() }
  }, [desktop])

  async function newDocument() {
    if (busy) { noteBusy(); return }
    openTab(makeDocument('', settings.language === 'en-US' ? 'Untitled' : '未命名'))
  }

  async function openDocument() {
    if (busy) { noteBusy(); return }
    let candidateToken: string | null = null
    try {
      const opened = await invoke<OpenResult | null>('open_document')
      if (opened) {
        candidateToken = opened.token
        setBusy(true)
        setStatus(`正在打开 ${opened.name}…`)
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
    setTree((current) => ({ ...current, [token]: { entries: current[token]?.entries ?? [], nextOffset: null, expanded: true, loading: true, error: null } }))
    try {
      const page = await invoke<ChildrenPage>('list_children', { directoryToken: token, offset })
      setTree((current) => ({ ...current, [token]: { entries: [...(offset ? current[token]?.entries ?? [] : []), ...page.entries], nextOffset: page.nextOffset, expanded: true, loading: false, error: null } }))
    } catch (error) {
      setTree((current) => ({ ...current, [token]: { entries: current[token]?.entries ?? [], nextOffset: current[token]?.nextOffset ?? null, expanded: true, loading: false, error: errorText(error) } }))
    }
  }

  async function chooseWorkspace() {
    if (busy) { noteBusy(); return }
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
    setSettings((current) => ({ ...current, showSidebar: true }))
    await loadChildren(chosen.token)
    setStatus(`已打开文件夹 ${chosen.name}`)
    void rememberWorkspace(chosen.token).catch(() => undefined)
  }

  async function openWorkspaceEntry(token: string) {
    if (busy) { noteBusy(); return }
    setBusy(true)
    setStatus('正在打开文档…')
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

  function toggleDirectory(token: string) {
    const current = tree[token]
    if (!current) { void loadChildren(token); return }
    if (!current.expanded && current.entries.length === 0) { void loadChildren(token); return }
    setTree((old) => ({ ...old, [token]: { ...old[token], expanded: !old[token].expanded } }))
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
    if (!selectedEntry || !window.confirm(settings.language === 'en-US' ? `Move “${selectedEntry.name}” to the Trash?` : `将“${selectedEntry.name}”移到废纸篓？`)) return
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
      if (sessionRef.current.persistence === 'saving') { queuedSave.current = true; setStatus('正在保存，完成后会再保存一次') }
      else noteBusy()
      return false
    }
    if (document.mode === 'visual' && !instance) return false
    if (toolbar.composing) { setStatus('请先完成当前中文输入，再保存'); return false }
    if (document.token && !asNew && !isDirty(sessionRef.current)) {
      setStatus('内容未修改，磁盘文件无需重写')
      return true
    }
    const sourceText = flushSourceText().sourceText
    setBusy(true)
    const { session: saving, ticket } = beginSave(sessionRef.current)
    updateSession(saving)
    try {
      const visual = document.mode === 'visual'
      const editorMarkdown = visual ? instance!.getPersistableMarkdown() : sourceText
      const markdown = visual ? composeVisualMarkdown(document.prepared.analysis, editorMarkdown) : editorMarkdown
      const referenced = new Set(imageUrlsIn(markdown))
      const assets: PendingAsset[] = visual ? await instance!.pendingAssets() : Array.from(document.recoveredAssets, ([url, asset]) => ({ url, ...asset })).filter((asset) => referenced.has(asset.url))
      const saved = await invoke<SaveResult | null>(asNew && document.token ? 'save_as_document' : 'save_document', {
        token: document.token || null,
        expectedRevision: ticket.diskRevision,
        markdown,
        assets: await stageAssets(assets),
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
      if (unchangedDuringSave && sourceEditor.current && document.mode === 'source-protected') sourceEditor.current.value = saved.markdown
      setDocument((current) => current.id === document.id ? {
        ...current, token: saved.token, assetKey: saved.assetKey, retiredTokens: document.token && saved.token !== document.token ? [...current.retiredTokens, document.token] : current.retiredTokens, name: saved.name, revision: saved.revision, originalMarkdown: saved.markdown, sourceText: current.mode === 'source-protected' && unchangedDuringSave ? saved.markdown : current.sourceText, sampleId: undefined,
      } : current)
      setNotice((current) => current?.kind === 'error' ? null : current)
      const completed = saveSucceeded(sessionRef.current, ticket, saved.revision)
      updateSession(completed)
      let draftCleanupError = ''
      if (!isDirty(completed)) {
        try { await discardDraft(document.draftId) }
        catch (draftError) { draftCleanupError = `；草稿清理失败：${errorText(draftError)}` }
      }
      setStatus(`已保存 ${saved.name}${isDirty(completed) ? '；保存期间的新修改仍未保存' : ''}${draftCleanupError}`)
      void rememberDocument(saved.token).catch(() => undefined)
      return !isDirty(completed)
    } catch (error) {
      queuedSave.current = false
      updateSession(saveFailed(sessionRef.current, ticket, String(error)))
      setStatus(errorText(error))
      setNotice({ kind: 'error', message: `保存失败：${errorText(error)}` })
      return false
    } finally {
      setBusy(false)
    }
  }
  saveDocumentRef.current = () => saveDocument()

  async function exportPage(mode: 'html' | 'print') {
    const instance = adapter.current
    if (busy) { noteBusy(); return }
    if (!instance || document.mode === 'source-protected' || toolbar.composing) return
    setBusy(true)
    let snapshotId: string | null = null
    try {
      snapshotId = await captureSnapshot(false)
      const frozen = await invoke<SnapshotOut>('read_snapshot', { snapshotId })
      const assets = new Map(await Promise.all(frozen.assets.map(async (asset) => [asset.url, { bytes: await readStaged(asset.staged), mime: asset.mime }] as const)))
      const [{ renderHtml }, { printHtml }] = await Promise.all([import('../features/export/renderHtml'), import('../features/export/printHtml')])
      const html = await renderHtml(frozen.markdown, frozen.title.replace(/\.(md|markdown)$/i, ''), async (url) => {
        const asset = assets.get(url)
        return asset ?? null
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
      : flushSourceText().sourceText
    const assets: PendingAsset[] = []
    const diskAssets: { url: string; relative: string }[] = []
    if (!textOnly) {
      const pending = new Map((await instance!.pendingAssets()).map((asset) => [asset.url, asset]))
      for (const url of imageUrlsIn(markdown)) {
        const staged = pending.get(url)
        if (staged) { assets.push(staged); continue }
        const relative = localAssetPath(url)
        if (!document.token || !relative) throw new Error('EXPORT_RESOURCE_MISSING')
        diskAssets.push({ url, relative })
      }
    }
    return invoke<string>('create_snapshot', { markdown, title: document.name, assets: await stageAssets(assets), diskAssets, token: document.token || null, generation: document.id, revision })
  }

  async function exportSnapshotMD(textOnly: boolean) {
    if (busy) { noteBusy(); return }
    if (!desktop || (!textOnly && document.mode === 'source-protected')) return
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

  function runFileAction(action: string) {
    if (action.startsWith('recent:')) { void openRecent(action); return }
    if (action === 'new') void newDocument()
    if (action === 'open') void openDocument()
    if (action === 'open-folder') void chooseWorkspace()
    if (action === 'save') void saveDocument()
    if (action === 'save-as') void saveDocument(true)
    if (action === 'export-md') void exportSnapshotMD(false)
    if (action === 'export-text') void exportSnapshotMD(true)
    if (action === 'find') openFind()
    if (action === 'toggle-source') { if (document.mode === 'visual') switchToSource(); else void switchToVisual() }
    if (action === 'export-html') void exportPage('html')
    if (action === 'print') void exportPage('print')
    if (action === 'view-toolbar') setSettings((current) => ({ ...current, showFileToolbar: !current.showFileToolbar }))
    if (action === 'view-sidebar') setSettings((current) => ({ ...current, showSidebar: !current.showSidebar }))
    if (action === 'preferences') setSettingsOpen(true)
    if (action === 'recover-drafts') {
      setDraftsOpen(true)
      void invoke<DraftSummary[]>('list_drafts').then(setDrafts).catch((error: unknown) => setStatus(errorText(error)))
    }
    if (action === 'new-window') void invoke('create_workspace_window', { transfer: null }).catch((error: unknown) => setStatus(errorText(error)))
    if (action === 'close-tab') void closeTabs([activeTabKeyRef.current])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // In the desktop app the native menu owns these shortcuts, so each key press has exactly one path.
      if (!desktop && (event.metaKey || event.ctrlKey)) {
        const key = event.key.toLowerCase()
        const action = key === 's' ? null : key === 'n' ? (event.shiftKey ? 'new-window' : 'new') : key === 'o' ? (event.shiftKey ? 'open-folder' : 'open') : key === 'w' ? 'close-tab' : key === ',' ? 'preferences' : key === 'f' ? 'find' : null
        if (key === 's') event.preventDefault()
        if (action) { event.preventDefault(); runFileAction(action) }
      }
      if (event.key === 'Escape') {
        setTabMenu(null)
        setSettingsOpen(false)
        setDraftsOpen(false)
        setDiskDiff(null)
        closeDetailsMenus(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function closeDetailsMenus(target: Element | null) {
    for (const menu of window.document.querySelectorAll<HTMLDetailsElement>('details[open]:not(.verification-panel)')) {
      const inside = target !== null && menu.contains(target)
      if (inside && target.closest('summary')) continue
      if (!inside || target.closest('button')) menu.removeAttribute('open')
    }
  }

  useEffect(() => {
    const onClick = (event: Event) => closeDetailsMenus(event.target instanceof Element ? event.target : null)
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [])

  async function openRecent(action: string) {
    const [, kind, id] = action.split(':')
    if (busyRef.current) { noteBusy(); return }
    let candidateToken: string | null = null
    try {
      if (kind === 'folder') {
        const chosen = await invoke<WorkspaceRoot | null>('choose_recent_workspace', { id })
        if (chosen) await activateWorkspace(chosen)
        return
      }
      const opened = await invoke<OpenResult | null>('choose_recent_file', { id })
      if (!opened) return
      candidateToken = opened.token
      setBusy(true)
      setStatus(`正在打开 ${opened.name}…`)
      const hydrated = await hydrateImages(opened)
      openTab(hydrated, createSession(hydrated.id, hydrated.revision))
      candidateToken = null
      void rememberDocument(opened.token).catch(() => undefined)
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  function openFind() {
    setFindOpen(true)
    if (documentRef.current.mode === 'source-protected') setSourceView(true)
  }

  function closeFind() {
    setFindOpen(false)
    adapter.current?.find('')
    setFindCount({ current: 0, total: 0 })
    adapter.current?.focus()
  }

  function revealSourceMatch() {
    const element = sourceEditor.current
    const match = sourceFind.current.matches[sourceFind.current.index]
    if (!element || !match) return
    element.setSelectionRange(match.from, match.to)
    const lines = element.value.slice(0, match.from).split('\n').length
    element.scrollTop = Math.max(0, (lines - 3) * (parseFloat(getComputedStyle(element).lineHeight) || 22))
  }

  function reapplyFind(instance: EditorInstance) {
    const count = instance.find(findRef.current.open ? findRef.current.query : '')
    if (adapter.current === instance) setFindCount(count)
  }

  function runFind(query: string) {
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.find(query) ?? { current: 0, total: 0 }); return }
    sourceFind.current = { matches: findInText(sourceEditor.current?.value ?? documentRef.current.sourceText, query), index: 0 }
    setFindCount({ current: 0, total: sourceFind.current.matches.length })
    revealSourceMatch()
  }

  /** The user can type in the source editor while the find bar is open, so stored offsets go stale. */
  function refreshSourceMatches() {
    const matches = findInText(sourceEditor.current?.value ?? documentRef.current.sourceText, findQuery)
    sourceFind.current = { matches, index: Math.min(sourceFind.current.index, Math.max(0, matches.length - 1)) }
  }

  function findStep(direction: 1 | -1) {
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.findStep(direction) ?? { current: 0, total: 0 }); return }
    refreshSourceMatches()
    const { matches, index } = sourceFind.current
    if (matches.length === 0) return
    sourceFind.current.index = (index + direction + matches.length) % matches.length
    setFindCount({ current: sourceFind.current.index, total: matches.length })
    revealSourceMatch()
  }

  runFindRef.current = runFind

  function replaceInSource(ranges: FindMatch[]) {
    const element = sourceEditor.current
    if (!element) return
    for (const range of [...ranges].reverse()) element.setRangeText(replaceText, range.from, range.to, 'end')
    updateSession(editSession(sessionRef.current))
    runFind(findQuery)
  }

  function replaceOne() {
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.replaceCurrent(replaceText) ?? { current: 0, total: 0 }); return }
    refreshSourceMatches()
    const match = sourceFind.current.matches[sourceFind.current.index]
    if (match) replaceInSource([match])
  }

  function replaceEvery() {
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.replaceAll(replaceText) ?? { current: 0, total: 0 }); return }
    refreshSourceMatches()
    replaceInSource(sourceFind.current.matches)
  }

  const linkOpenRef = useRef<(href: string) => void>(() => undefined)
  linkOpenRef.current = (href) => {
    const safe = safeLinkHref(href)
    if (!safe) { setStatus('链接地址无效或使用了不允许的协议'); return }
    if (/^(https?|mailto):/i.test(safe)) { void invoke('open_external', { url: safe }).catch((error: unknown) => setStatus(errorText(error))); return }
    openSiblingDocument(safe)
  }

  function openSiblingDocument(href: string) {
    if (!documentRef.current.entryToken) return
    let name: string
    try { name = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/^\.\//, '') } catch { return }
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || !/\.(?:md|markdown)$/i.test(name)) return
    const siblings = Object.values(tree).find((state) => state.entries.some((entry) => entry.token === documentRef.current.entryToken))?.entries
    const sibling = siblings?.find((entry) => !entry.directory && entry.name === name)
    if (sibling) void openWorkspaceEntry(sibling.token)
  }

  const menuActionRef = useRef<(action: string) => void>(() => undefined)
  menuActionRef.current = runFileAction
  useEffect(() => {
    if (!desktop) return
    let stop: (() => void) | undefined
    let canceled = false
    void getCurrentWindow().listen<string>('menu-action', (event) => menuActionRef.current(event.payload)).then((unlisten) => { if (canceled) unlisten(); else stop = unlisten })
    return () => { canceled = true; stop?.() }
  }, [desktop])

  useEffect(() => {
    if (!busy && queuedSave.current && isDirty(sessionRef.current)) {
      queuedSave.current = false
      void saveDocument()
    }
  }, [busy, session])

  async function requestCloseWindow(): Promise<void> {
    if (closingWindowRef.current) return
    closingWindowRef.current = true
    try {
      for (const { key, session: storedSession } of [...tabsRef.current]) {
        if (!isDirty(key === activeTabKeyRef.current ? sessionRef.current : storedSession)) continue
        if (!await focusTabForSave(key)) return
        const active = documentRef.current
        if (active.token && isDirty(sessionRef.current)) {
          if (!await saveDocumentRef.current()) return
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        } else if (!await canProceedRef.current(true)) return
      }
      await draftWriteChain.current.catch(() => undefined)
      await invoke('close_workspace_window')
    } finally { closingWindowRef.current = false }
  }
  closeWindowRef.current = requestCloseWindow

  useEffect(() => {
    if (!desktop) return
    let unlistenClose: (() => void) | undefined
    let unlistenQuit: (() => void) | undefined
    let canceled = false
    getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault()
      void closeWindowRef.current().catch((error: unknown) => setStatus(errorText(error)))
    }).then((stop) => { if (canceled) stop(); else unlistenClose = stop }).catch((error: unknown) => setStatus(errorText(error)))
    void getCurrentWindow().listen('app-quit-requested', () => {
      void closeWindowRef.current().catch((error: unknown) => setStatus(errorText(error)))
    }).then((stop) => { if (canceled) stop(); else unlistenQuit = stop }).catch((error: unknown) => setStatus(errorText(error)))
    return () => { canceled = true; unlistenClose?.(); unlistenQuit?.() }
  }, [desktop])

  useEffect(() => {
    if (desktop) void getCurrentWindow().setTitle(document.name).catch(() => undefined)
  }, [desktop, document.name])

  async function selectSample(sampleId: string) {
    if (busy || !await canProceed()) {
      setStatus('已取消切换，当前文档未改变')
      return
    }
    const sample = samples.find((item) => item.id === sampleId) ?? samples[0]
    try { await finishLeave() }
    catch (error) { setStatus(errorText(error)); return }
    setDocument(makeDocument(await loadSample(sample.id), sample.label, sample.id))
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
    if (busy) { noteBusy(); return }
    if (!instance || document.mode !== 'visual') return
    if (instance.hasPendingAssets()) {
      setStatus('请先保存待处理图片，再切换到源码模式')
      return
    }
    const sourceText = isDirty(sessionRef.current)
      ? composeVisualMarkdown(document.prepared.analysis, instance.getPersistableMarkdown())
      : document.originalMarkdown
    const id = nextDocumentId++
    forceSourceView.current = true
    updateSession({ ...sessionRef.current, generation: id })
    setDocument({ ...document, id, mode: 'source-protected', sourceText })
  }

  function applyLink() {
    const href = safeLinkHref(linkHref)
    if (!href) { setStatus('链接地址无效或使用了不允许的协议'); return }
    adapter.current?.setLink(href)
    setLinkOpen(false)
  }

  useEffect(() => {
    if (!tablePicker) return
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.table-size-picker')) setTablePicker(null)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    return () => window.removeEventListener('pointerdown', closeOutside, true)
  }, [tablePicker])

  function openTablePickerFromToolbar(event: MouseEvent<HTMLButtonElement>) {
    adapter.current?.captureSelection()
    event.currentTarget.closest('details')?.removeAttribute('open')
    const rect = event.currentTarget.getBoundingClientRect()
    setTablePicker({ x: rect.left, y: rect.bottom })
  }

  function onPreviewClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    if (!href.startsWith('#')) {
      if (event.metaKey || !/^(https?|mailto):/i.test(href)) linkOpenRef.current(href)
      return
    }
    let id: string
    try { id = decodeURIComponent(href.slice(1)) } catch { return }
    const destination = window.document.getElementById(`user-content-${id}`)
    if (destination && previewRoot.current?.contains(destination)) destination.scrollIntoView({ block: 'start' })
  }

  async function switchToVisual() {
    if (busy) { noteBusy(); return }
    if (document.mode !== 'source-protected') return
    const document_ = flushSourceText()
    if (document_ !== document) { window.setTimeout(() => void switchToVisualRef.current(), 0); return }
    setBusy(true)
    try {
      const visual = await hydrateImages({ token: document.token, assetKey: document.assetKey, name: document.name, markdown: document.sourceText, revision: document.revision })
      if (visual.mode !== 'visual') {
        setStatus(`仍需源码保护：${describeIssues(visual.prepared.analysis)}`)
        return
      }
      const recoveredReplacements = new Map<string, string>()
      for (const [oldUrl, asset] of document.recoveredAssets) {
        const newUrl = blobUrl(asset.bytes, asset.mime)
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
      setDocument({ ...visual, draftId: document.draftId, retiredTokens: document.retiredTokens, originalMarkdown: document.originalMarkdown, sampleId: document.sampleId })
    } finally {
      setBusy(false)
    }
  }

  const switchToVisualRef = useRef(switchToVisual)
  switchToVisualRef.current = switchToVisual

  const persistenceLabel = session.persistence === 'saving' ? '保存中' : session.persistence === 'failed' ? '保存失败' : session.persistence === 'conflict' ? '磁盘冲突' : dirty ? '未保存' : document.token ? '已保存' : '未保存到磁盘'

  return { notice, setNotice, activeConflict, showDiskDiff, useDiskVersion, saveConflictCopyAs, refreshDrafts, diskDiff, setDiskDiff, findOpen, findQuery, setFindQuery, replaceText, setReplaceText, findCount, runFind, findStep, replaceOne, replaceEvery, closeFind, tablePicker, setTablePicker, activeTabKey, adapter, applyLink, busy, checkRoundTrip, chooseWorkspace, closeTabs, closeWorkspace, createEntry, desktop, detachTab, discardDraft, document, draftPreview, drafts, draftsOpen, editorHost, exportPage, exportSnapshotMD, flushSourceText, imageAltOpen, imageAltText, imageInput, imageInputAction, linkHref, linkOpen, loadChildren, newDocument, newEntryName, newEntryType, onPreviewClick, openDocument, openTablePickerFromToolbar, openWorkspaceEntry, persistenceLabel, preview, previewDraft, previewHtml, previewPending, previewRoot, recoverDraft, renameEntry, renameName, renaming, reorderTabs, saveDocument, selectSample, selectedEntry, session, sessionRef, setDraftsOpen, setImageAltOpen, setImageAltText, setLinkHref, setLinkOpen, setNewEntryName, setNewEntryType, setRenameName, setRenaming, setSelectedDirectory, setSelectedEntry, setSettings, setSettingsOpen, setSettingsTab, setSourceView, setStatus, setTabMenu, settings, settingsOpen, settingsTab, sidebarOpen, sidebarRoot, sourceEditor, sourceView, status, switchTab, switchToSource, switchToVisual, t, tabDragRef, tabMenu, tabs, toggleDirectory, toolbar, trashEntry, tree, updateSession, workspace }
}

export type DocumentWorkspace = ReturnType<typeof useDocumentWorkspace>
