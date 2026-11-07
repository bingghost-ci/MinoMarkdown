import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { listen } from '@tauri-apps/api/event'
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
const toolbarItems: { command: EditorCommand; label: string; title: string }[] = [
  { command: 'bold', label: 'B', title: '加粗' }, { command: 'italic', label: 'I', title: '斜体' },
  { command: 'strike', label: 'S', title: '删除线' }, { command: 'inlineCode', label: '</>', title: '行内代码' },
  { command: 'clearFormat', label: '清除格式', title: '清除格式' },
  { command: 'bullet', label: '项目列表', title: '项目列表' }, { command: 'ordered', label: '编号列表', title: '编号列表' },
  { command: 'quote', label: '引用', title: '引用' }, { command: 'rule', label: '分割线', title: '插入分割线' },
  { command: 'codeBlock', label: '代码块', title: '插入代码块' },
  { command: 'undo', label: '撤销', title: '撤销' }, { command: 'redo', label: '重做', title: '重做' },
]

type OpenResult = { token: string; name: string; markdown: string; revision: string }
type SaveResult = OpenResult & { assetPaths: Record<string, string>; assetRelocations: Record<string, string> }
type DiskStatus = { kind: 'same' | 'changed' | 'deleted'; revision: string | null }
type DocumentState = OpenResult & { id: number; draftId: string; imageUrls: Map<string, string>; recoveredAssets: Map<string, { bytes: number[]; mime: string }>; entryToken?: string; sampleId?: string; originalMarkdown: string; prepared: PreparedMarkdown; sourceText: string; mode: 'visual' | 'source-protected' }
type DraftSummary = { draftId: string; name: string; targetPath: string | null; targetStatus: 'same' | 'changed' | 'deleted' | 'unknown' | 'untitled'; snapshots: number }
type DraftContent = DraftSummary & { markdown: string; assets: { url: string; mime: string; bytes: number[] }[] }
type WorkspaceRoot = { token: string; name: string }
type WorkspaceEntry = { token: string; name: string; directory: boolean }
type ChildrenPage = { entries: WorkspaceEntry[]; nextOffset: number | null }
type SnapshotOut = { markdown: string; title: string; assets: PendingAsset[]; generation: number; revision: number }
type OpenIntent = { token: string; name: string; kind: 'markdown' | 'image' | 'folder' }
type NativeImageIntent = { name: string; mime: string; bytes: number[] }
type RecentItem = { id: string; name: string; kind: 'file' | 'folder'; available: boolean; lastOpened: number }
type Settings = { schemaVersion: number; theme: 'system' | 'light' | 'dark'; sidebarWidth: number; windowWidth: number; windowHeight: number }
const defaultSettings: Settings = { schemaVersion: 1, theme: 'system', sidebarWidth: 230, windowWidth: 1100, windowHeight: 760 }
type TreeState = { entries: WorkspaceEntry[]; nextOffset: number | null; expanded: boolean; loading: boolean; error: string | null }
let nextDocumentId = 1

function makeDocument(markdown: string, name = '未命名文档', sampleId?: string): DocumentState {
  const prepared = prepareMarkdown(markdown)
  return { id: nextDocumentId++, draftId: crypto.randomUUID(), name, token: '', revision: '', markdown: prepared.editorMarkdown, originalMarkdown: markdown, imageUrls: new Map(), recoveredAssets: new Map(), sampleId, prepared, sourceText: markdown, mode: prepared.analysis.mode }
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
  return { ...opened, id: nextDocumentId++, draftId: crypto.randomUUID(), markdown, originalMarkdown: opened.markdown, imageUrls, recoveredAssets: new Map(), prepared, sourceText: opened.markdown, mode: hydrationFailed ? 'source-protected' : prepared.analysis.mode }
}

export function App() {
  const editorRoot = useRef<HTMLDivElement>(null)
  const sidebarRoot = useRef<HTMLElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const imageInputAction = useRef<'insert' | 'replace'>('insert')
  const lastFileAction = useRef<{ action: string; at: number }>({ action: '', at: 0 })
  const adapter = useRef<EditorAdapter | null>(null)
  const [document, setDocument] = useState<DocumentState>(() => makeDocument(''))
  const initialDocumentId = useRef(document.id)
  const [session, setSession] = useState<DocumentSession>(() => createSession(document.id))
  const sessionRef = useRef(session)
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
  const [workspace, setWorkspace] = useState<WorkspaceRoot | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [tree, setTree] = useState<Record<string, TreeState>>({})
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<(WorkspaceEntry & { parentToken: string }) | null>(null)
  const [newEntryType, setNewEntryType] = useState<'file' | 'directory' | null>(null)
  const [newEntryName, setNewEntryName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const draftWriteChain = useRef<Promise<void>>(Promise.resolve())
  const activeTokenRef = useRef(document.token)
  const pendingDiscardDraftId = useRef<string | null>(null)
  const desktop = isTauri()
  busyRef.current = busy
  const dirty = isDirty(session)
  const welcomeVisible = document.id === initialDocumentId.current && !document.token && !workspace && document.markdown === '' && !dirty
  const canProceedRef = useRef<(finalizeDiscard?: boolean) => Promise<boolean>>(async () => true)

  function updateSession(next: DocumentSession) {
    sessionRef.current = next
    setSession(next)
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
    }, document.imageUrls, document.recoveredAssets, setToolbar, setImageError)
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
      void creation.finally(() => instance.destroy()).catch(() => undefined)
    }
  }, [document.id, welcomeVisible])

  useEffect(() => {
    setDiskChange(null)
    setDiskPreview(null)
  }, [document.id])

  useEffect(() => {
    const previous = activeTokenRef.current
    activeTokenRef.current = document.token
    if (!desktop || !previous || previous === document.token) return
    const pendingWrites = draftWriteChain.current
    void pendingWrites.catch(() => undefined).then(() => invoke('release_document', { token: previous })).catch((error: unknown) => {
      setStatus(`旧文档访问清理失败：${errorText(error)}`)
    })
  }, [desktop, document.id, document.token])

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
    if (busy || !await canProceed()) return
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
      await finishLeave(next.draftId)
      updateSession(editSession(createSession(next.id)))
      setDocument(next)
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
        if (!await canProceedRef.current()) { await invoke('discard_open_intent', { token: intent.token }); return }
        const opened = await invoke<OpenResult>('open_intent_document', { token: intent.token })
        candidateToken = opened.token
        const hydrated = await hydrateImages(opened)
        await finishLeave(hydrated.draftId)
        updateSession(createSession(hydrated.id, hydrated.revision))
        setDocument(hydrated)
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
    void drain()
    return () => { canceled = true; unlisten?.() }
  }, [desktop])

  async function newDocument() {
    if (busy || !await canProceed()) return
    try { await finishLeave() }
    catch (error) { setStatus(errorText(error)); return }
    setDocument(makeDocument(''))
  }

  async function openDocument() {
    if (busy) return
    let candidateToken: string | null = null
    try {
      const opened = await invoke<OpenResult | null>('open_document')
      if (opened) {
        candidateToken = opened.token
        if (!await canProceed()) { await releaseCandidate(candidateToken); return }
        setBusy(true)
        const hydrated = await hydrateImages(opened)
        await finishLeave(hydrated.draftId)
        setDocument(hydrated)
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
    if (busy || !await canProceed()) return
    setBusy(true)
    let candidateToken: string | null = null
    try {
      const opened = await invoke<OpenResult>('open_workspace_document', { entryToken: token })
      candidateToken = opened.token
      const hydrated = await hydrateImages(opened)
      await finishLeave(hydrated.draftId)
      setDocument({ ...hydrated, entryToken: token })
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
        if (!await canProceed()) { await releaseCandidate(candidateToken); return }
        const hydrated = await hydrateImages(opened)
        await finishLeave(hydrated.draftId)
        setDocument(hydrated)
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
          <span className="tree-chevron" aria-hidden="true">{entry.directory ? tree[entry.token]?.expanded ? '⌄' : '›' : ''}</span>
          <svg className="tree-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{entry.directory ? <path d="M2.5 5.5h5l1.5 2h8.5v8.5h-15z M2.5 7.5v-2a1 1 0 0 1 1-1h4" /> : <path d="M5 2.5h7l3 3V17H5z M12 2.5v3h3 M7.5 9h5 M7.5 12h5" />}</svg>
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
      if (document.entryToken === renamed.token) setDocument((current) => ({ ...current, name: renamed.name }))
      setSelectedEntry({ ...selectedEntry, name: renamed.name })
      await loadChildren(selectedEntry.parentToken)
      setRenaming(false)
      setStatus(`已重命名为 ${renamed.name}`)
    } catch (error) { setStatus(errorText(error)) }
  }

  async function trashEntry() {
    if (!selectedEntry || !window.confirm(`将“${selectedEntry.name}”移到废纸篓？`)) return
    if (document.entryToken === selectedEntry.token && !await canProceed()) return
    try {
      await invoke('trash_workspace_entry', { entryToken: selectedEntry.token })
      let draftCleanupFailed = false
      if (document.entryToken === selectedEntry.token) {
        try { await finishLeave() }
        catch { draftCleanupFailed = true }
        setDocument(makeDocument(''))
      }
      await loadChildren(selectedEntry.parentToken)
      setStatus(draftCleanupFailed ? `已移到废纸篓：${selectedEntry.name}；恢复草稿清理失败，可在恢复区手动丢弃` : `已移到废纸篓：${selectedEntry.name}`)
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
    getCurrentWindow().onCloseRequested(async (event) => {
      if (!await canProceedRef.current(true)) event.preventDefault()
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>MinoMarkdown</h1>
        </div>
        <span className="app-stage">{welcomeVisible ? '开始' : document.name}{dirty ? ' · 未保存' : ''}{session.persistence === 'saving' ? ' · 保存中' : ''}{session.persistence === 'failed' ? ' · 保存失败' : ''}{session.persistence === 'conflict' ? ' · 磁盘冲突' : ''}</span>
      </header>
      <div className="file-controls" aria-label="文档操作">
        <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-expanded={sidebarOpen} aria-controls="document-sidebar" aria-label={sidebarOpen ? '隐藏文件栏' : '显示文件栏'} title={sidebarOpen ? '隐藏文件栏' : '显示文件栏'}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M7.5 3v14"/></svg></button>
        <button type="button" className="primary-action" onClick={() => void chooseWorkspace()} disabled={!desktop || busy}>打开文件夹</button>
        <button type="button" onClick={() => void openDocument()} disabled={!desktop || busy}>打开文件</button>
        <button type="button" onClick={() => void newDocument()} disabled={busy}>新建文档</button>
        {!welcomeVisible && <button type="button" onClick={() => void saveDocument()} disabled={!desktop || busy}>保存 <kbd>⌘S</kbd></button>}
        {!welcomeVisible && <details className="more-actions"><summary>更多操作</summary><div className="more-actions-menu">
        <button type="button" onClick={() => void saveDocument(true)} disabled={!desktop || busy || !document.token}>另存为</button>
        {document.mode === 'visual'
          ? <button type="button" onClick={switchToSource} disabled={busy}>源码模式</button>
          : <button type="button" onClick={() => void switchToVisual()} disabled={busy}>尝试可视化</button>}
        <button type="button" onClick={() => void exportPage('html')} disabled={!desktop || busy || document.mode === 'source-protected'}>导出 HTML</button>
        <button type="button" onClick={() => void exportPage('print')} disabled={!desktop || busy || document.mode === 'source-protected'}>打印 / 存储为 PDF</button>
        {document.mode === 'visual' && <button type="button" onClick={() => void exportSnapshotMD(false)} disabled={!desktop || busy}>导出 MD + 图片</button>}
        <button type="button" onClick={() => void exportSnapshotMD(true)} disabled={!desktop || busy}>仅正文 MD（图片占位）</button>
        </div></details>}
        <label className="theme-control">外观 <select aria-label="外观主题" value={settings.theme} onChange={(event) => setSettings((current) => ({ ...current, theme: event.target.value as Settings['theme'] }))}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      </div>
      <p className="app-status" role="status">{status}</p>
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
          <div className="sidebar-heading"><h2>文件资源管理器</h2><button type="button" title="打开文件夹" aria-label="打开文件夹" onClick={() => void chooseWorkspace()} disabled={!desktop}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 6h5l1.5 2h8.5v8h-15z"/><path d="M13 2.5v5M10.5 5h5"/></svg></button></div>
          {!workspace && <div className="sidebar-empty"><p>尚未打开文件夹</p><span>可从 Finder 拖入文件夹</span></div>}
          {workspace && <>
            <div className="tree-header"><strong title={workspace.name}>{workspace.name}</strong><button type="button" onClick={() => void loadChildren(workspace.token)} title="刷新目录">刷新</button><button type="button" onClick={() => void closeWorkspace()} title="关闭目录">关闭</button></div>
            <div role="tree" aria-label="文件夹目录" className="file-tree">{renderChildren(workspace.token)}</div>
            <div className="tree-actions">
              <button type="button" onClick={() => { setNewEntryType('file'); setNewEntryName('新文档.md') }}>新建 MD</button>
              <button type="button" onClick={() => { setNewEntryType('directory'); setNewEntryName('新目录') }}>新建目录</button>
              <button type="button" disabled={!selectedEntry} onClick={() => { setRenameName(selectedEntry?.name ?? ''); setRenaming(true) }}>重命名</button>
              <button type="button" disabled={!selectedEntry} onClick={() => void trashEntry()}>移到废纸篓</button>
            </div>
            {newEntryType && <div className="tree-form"><label>{newEntryType === 'file' ? '文件名' : '目录名'}<input value={newEntryName} onChange={(event) => setNewEntryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createEntry(); if (event.key === 'Escape') setNewEntryType(null) }} /></label><button type="button" onClick={() => void createEntry()}>创建</button><button type="button" onClick={() => setNewEntryType(null)}>取消</button></div>}
            {renaming && <div className="tree-form"><label>新名称<input value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameEntry(); if (event.key === 'Escape') setRenaming(false) }} /></label><button type="button" onClick={() => void renameEntry()}>确定</button><button type="button" onClick={() => setRenaming(false)}>取消</button></div>}
          </>}
          {recent.length > 0 && <div className="recent-list"><h2>最近使用</h2>{recent.map((item) => <div className="recent-item" key={item.id}><button type="button" onClick={() => void openRecent(item)}><span className="recent-kind">{item.kind === 'folder' ? '目录' : 'MD'}</span>{item.name}{!item.available ? ' · 失效' : ''}</button><button type="button" aria-label={`移除 ${item.name}`} onClick={() => void removeRecent(item.id)}>×</button></div>)}</div>}
        </aside>}
      {welcomeVisible ? <section className="welcome-panel" aria-label="开始使用 MinoMarkdown">
        <div className="welcome-content">
        <svg className="welcome-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 13h14l5 6h19v21H5z"/><path d="M5 19v-7a3 3 0 0 1 3-3h11"/><path d="M16 28h17M16 33h11"/></svg>
        <div className="welcome-kicker">本地 Markdown 工作区</div>
        <h2>从文件夹开始</h2>
        <p>浏览多级目录中的 Markdown 文档，在右侧直接编辑。也可以从 Finder 拖入文件夹。</p>
        <div className="welcome-actions">
          <button type="button" onClick={() => void chooseWorkspace()} disabled={!desktop}>打开文件夹</button>
          <button type="button" onClick={() => void newDocument()}>新建文档</button>
        </div>
        <div className="drop-hint">支持拖入文件夹和 Markdown 文件</div>
        </div>
      </section> : <>
        <section className="editor-panel" aria-label="Markdown 编辑区域">
          {document.mode === 'visual' && <div className="editor-toolbar" role="toolbar" aria-label="编辑工具栏" onMouseDown={(event) => { if ((event.target as HTMLElement).closest('button')) event.preventDefault() }}>
            <select aria-label="段落样式" value={toolbar.block.startsWith('heading') ? toolbar.block : 'paragraph'} disabled={!toolbar.ready || toolbar.composing} onChange={(event) => adapter.current?.runCommand(event.target.value as EditorCommand)}>
              <option value="paragraph">正文</option>
              {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={`heading${level}`}>标题 {level}</option>)}
            </select>
            {toolbarItems.map((item) => {
              const active = ({ bold: 'strong', italic: 'emphasis', strike: 'strike_through', inlineCode: 'inlineCode', bullet: 'bullet_list', ordered: 'ordered_list', quote: 'blockquote', codeBlock: 'code_block' } as Record<string, string>)[item.command]
              return <button key={item.command} type="button" title={item.title} aria-label={item.title} aria-pressed={active ? (item.command === 'bullet' || item.command === 'ordered' || item.command === 'quote' || item.command === 'codeBlock' ? toolbar.block === active : toolbar.marks.includes(active)) : undefined} disabled={!toolbar.ready || toolbar.composing || item.command === 'undo' && !toolbar.canUndo || item.command === 'redo' && !toolbar.canRedo} onClick={() => adapter.current?.runCommand(item.command)}>{item.label}</button>
            })}
            <button type="button" disabled={!toolbar.ready || toolbar.composing} onClick={() => adapter.current?.runTableCommand('insert')}>插入表格</button>
            <button type="button" disabled={!toolbar.ready || toolbar.composing} onClick={() => { imageInputAction.current = 'insert'; imageInput.current?.click() }}>插入图片</button>
            <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) { try { if (imageInputAction.current === 'replace') adapter.current?.replaceSelectedImage(file); else adapter.current?.insertFile(file) } catch (error) { setStatus(errorText(error)) } } event.target.value = '' }} />
            {toolbar.inTable && <>
              <button type="button" onClick={() => adapter.current?.runTableCommand('row')}>加行</button>
              <button type="button" onClick={() => adapter.current?.runTableCommand('column')}>加列</button>
              <button type="button" onClick={() => adapter.current?.runTableCommand('deleteRow')}>删行</button>
              <button type="button" onClick={() => adapter.current?.runTableCommand('deleteColumn')}>删列</button>
              <button type="button" onClick={() => adapter.current?.runTableCommand('alignLeft')}>左对齐</button>
              <button type="button" onClick={() => adapter.current?.runTableCommand('alignCenter')}>居中</button>
              <button type="button" onClick={() => adapter.current?.runTableCommand('alignRight')}>右对齐</button>
            </>}
            <button type="button" disabled={!toolbar.ready || toolbar.composing} onClick={() => { setLinkHref(adapter.current?.captureSelection() ?? ''); setLinkOpen(true) }}>链接</button>
            {toolbar.imageAlt !== null && <button type="button" onClick={() => { adapter.current?.captureSelection(); setImageAltText(toolbar.imageAlt ?? ''); setImageAltOpen(true) }}>图片说明</button>}
            {toolbar.imageAlt !== null && <button type="button" onClick={() => { adapter.current?.captureSelection(); imageInputAction.current = 'replace'; imageInput.current?.click() }}>替换图片</button>}
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
      {import.meta.env.DEV && !welcomeVisible && <details className="verification-panel">
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
