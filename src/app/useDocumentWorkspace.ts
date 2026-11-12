import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { compareMarkdown, describeIssues, exceedsVisualLimit, protectedFragments } from '../core/markdown/compatibility'
import { opensForQuickReading, previewHead, quickReadAnalysis } from '../features/document/largeDocument'
import { countWordsAsync, imageUrlsInAsync, mermaidSourcesAsync, prepareMarkdownAsync, renderCodePreviewAsync, renderExportAsync, renderPreviewAsync, renderTextPreviewAsync } from '../core/markdown/analysisClient'
import { delimiterOf, extensionOf, isTextKind, kindOfName, titleOf, type DocumentKind } from '../features/document/kinds'
import { textHead, textOutline } from '../features/text/textDocument'
import type { PdfBridge, PdfHandle, PdfPosition } from '../features/pdf/PdfView'
import { blockPosition, restoreBlockPosition } from '../features/text/readingPosition'
import { mayContainMermaid } from '../core/markdown/diagrams'
import { composeVisualMarkdown, prepareMarkdown, type PreparedMarkdown } from '../core/markdown/codec'
import type { EditorAdapter as EditorInstance, PendingAsset, ToolbarState } from '../features/editor/EditorAdapter'
import { EditorPool } from '../features/editor/editorPool'
import { safeLinkHref } from '../features/editor/linkSafety'
import { assetUrl, isAssetUrl, relativeFromAssetUrl } from '../features/editor/assetUrl'
import { beginSave, clearExternalConflict, createSession, editSession, externalConflict, isDirty, saveCanceled, saveFailed, saveSucceeded, type DocumentSession } from '../features/document/session'
import { mayLeaveDocument, type UnsavedAction } from '../features/document/lifecycle'
import { createDraftScheduler, type DraftScheduler } from '../features/document/draftScheduler'
import { autosaveDecision } from '../features/document/autosave'
import { lineDiff, type DiffLine } from '../features/document/lineDiff'
import { defaultFindOptions, findInText, replacementFor, type FindMatch, type FindOptions } from '../features/editor/find'
import { outlineFromSource, type OutlineItem } from '../features/outline/outline'
import { imageUrlsIn, localAssetPath, rewriteImageUrls, snapshotResources } from '../features/export/snapshot'
import { translate, translateStatus, type Language } from './i18n'
import { activeStyle, defaultReadingSettings, documentTypography, layoutScript, lineHeights, opensInReadingMode, pickedStyle, toggledDayNight, type ReadingSettings } from './readingSettings'
import { typographyVariables } from '../features/reading/css'
import { dominantScript } from '../features/reading/script'
import { migrateStyleId, type ReadingStyle } from '../features/reading/styles'
import { previewAiTransport, previewSampleSource } from './previewSample'
import { useAiAssistant, type InsertPlacement } from './aiAssistant'
import type { AiTransport } from '../features/ai/client'
import { isZoomAction, zoomedFontSize } from './textZoom'
import { formatMenuCommands, transformMenuActions } from './formatActions'
import type { SourceEditor } from '../features/source/SourceEditor'
import { applyRemoteSettings, settingsPatch } from './settingsSync'
import { blobUrl, readStaged, stageAssets, type StagedAsset } from './binary'
// Listed individually so unused Crepe features add no styles.
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/block-edit.css'
import '@milkdown/crepe/theme/common/code-mirror.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/image-block.css'
import '@milkdown/crepe/theme/common/latex.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import '@milkdown/crepe/theme/common/table.css'
import '@milkdown/crepe/theme/classic.css'

const spikeDocument = '# Mino 编辑验证\n\n请在这里输入中文、英文和 Markdown。\n\n选中这段文字，再用顶部工具栏尝试加粗和撤销。\n'
const MAX_LIVE_EDITORS = 5
const loadEditorAdapter = () => import('../features/editor/EditorAdapter')
// Development-only verification samples; the production bundle does not include them.
const sampleFiles = import.meta.env.DEV ? import.meta.glob<string>('../../tests/fixtures/markdown/F0[1-5]-*.md', { query: '?raw', import: 'default' }) : {}
// Development-only samples of the other formats (T81–T89), for `?ui-preview=editor&ui-file=<name>` screenshots.
const formatSamples = import.meta.env.DEV ? import.meta.glob<string>('../../tests/fixtures/formats/*.{txt,json,yaml,log,csv,tsv,html}', { query: '?raw', import: 'default' }) : {}
const formatSampleUrls = import.meta.env.DEV ? import.meta.glob<string>('../../tests/fixtures/formats/*.pdf', { query: '?url', import: 'default' }) : {}
/** A long text made in the page, for timing: `ui-file=generated.txt&ui-chars=2000000`. */
function generatedNovel(chars: number): string {
  const parts: string[] = []
  let length = 0
  for (let chapter = 1; length < chars; chapter++) {
    parts.push(`第${chapter}章 潮声\n`)
    for (let paragraph = 0; paragraph < 40 && length < chars; paragraph++) {
      const text = `　　这是第 ${chapter} 章的第 ${paragraph + 1} 段，用来测量长文本的打开时间：风从海面上吹来，带着盐和铁锈的气味，灯塔的光一圈一圈扫过礁石。\n`
      parts.push(text)
      length += text.length
    }
  }
  return parts.join('')
}
const loadSample = async (id: string) => { const path = Object.keys(sampleFiles).find((item) => item.includes(`/${id}-`)); return path ? sampleFiles[path]() : spikeDocument }
export const samples = [
  { id: 'intro', label: '输入验证' },
  { id: 'F01', label: 'F01 标题与文字' },
  { id: 'F02', label: 'F02 列表与引用' },
  { id: 'F03', label: 'F03 代码与转义' },
  { id: 'F04', label: 'F04 链接与图片' },
  { id: 'F05', label: 'F05 表格' },
] as const
type OpenResult = { token: string; name: string; markdown: string; revision: string; assetKey: string; /** What Rust opened the file as (T81); a PDF has no `markdown`. */ kind: DocumentKind; encoding?: string; size?: number }
type SaveResult = OpenResult & { assetPaths: Record<string, string>; assetRelocations: Record<string, string> }
type DiskStatus = { kind: 'same' | 'changed' | 'deleted'; revision: string | null }
type DocumentState = OpenResult & { id: number; draftId: string; imageUrls: Map<string, string>; recoveredAssets: Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string }>; pendingFiles: Map<string, File>; retiredTokens: string[]; entryToken?: string; sampleId?: string; originalMarkdown: string; prepared: PreparedMarkdown; /** T77: a large document shown through the preview until the user edits; see largeDocument.ts. */ deferredVisual?: boolean; sourceText: string; mode: 'visual' | 'source-protected'; reading?: boolean }
/** The bytes a PDF may hold in one IPC answer; Rust allows 8 MiB. */
const PDF_TEXT_BUDGET = 2_000_000
type DraftSummary = { draftId: string; name: string; targetPath: string | null; targetStatus: 'same' | 'changed' | 'deleted' | 'unknown' | 'untitled'; snapshots: number }
type DraftContent = DraftSummary & { markdown: string; assets: StagedAsset[]; assetCount: number }
type WorkspaceRoot = { token: string; name: string }
export type WorkspaceEntry = { token: string; name: string; directory: boolean }
type ChildrenPage = { entries: WorkspaceEntry[]; nextOffset: number | null }
export type SearchHit = { token: string; name: string; path: string; line: number; snippet: string; occurrence: number; /** The open folder the hit is in; shown when several are open. */ root?: string }
type SearchResults = { hits: SearchHit[]; truncated: boolean; skipped: number }
const SEARCH_HIT_LIMIT = 500
type SnapshotOut = { markdown: string; title: string; assets: StagedAsset[]; generation: number; revision: number }
type RestoredSession = { documents: OpenResult[]; active: number | null; missing: number }
type OpenIntent = { token: string; name: string; kind: 'document' | 'image' | 'folder' }
type NativeImageIntent = { name: string; mime: string; staged: string }
export type Settings = ReadingSettings & { schemaVersion: number; sidebarWidth: number; outlineWidth: number; aiWidth: number; windowWidth: number; windowHeight: number; showFileToolbar: boolean; showSidebar: boolean; showOutline: boolean; autoSave: boolean; autoSaveSeconds: number; restoreSession: boolean; editorWidth: 'centered' | 'wide'; language: Language }
const defaultSettings: Settings = { ...defaultReadingSettings, schemaVersion: 1, sidebarWidth: 230, outlineWidth: 240, aiWidth: 400, windowWidth: 1100, windowHeight: 760, showFileToolbar: false, showSidebar: true, showOutline: false, autoSave: false, autoSaveSeconds: 30, restoreSession: false, editorWidth: 'centered', language: 'zh-CN' }
export type SettingsTab = 'appearance' | 'typography' | 'reading' | 'workspace' | 'ai'
export type FloatingPanel = 'appearance' | null
type TabItem = { key: string; document: DocumentState; session: DocumentSession }
type DetachedAsset = { url: string; staged: string; mime: string }
type DetachedTransfer = { name: string; kind?: DocumentKind; encoding?: string; size?: number; token: string; assetKey: string; retiredTokens: string[]; revision: string; markdown: string; originalMarkdown: string; sourceText: string; mode: DocumentState['mode']; draftId: string; session: DocumentSession; assets: DetachedAsset[]; imageUrls: [string, string][] }
type TreeState = { entries: WorkspaceEntry[]; nextOffset: number | null; expanded: boolean; loading: boolean; error: string | null }
let nextDocumentId = 1
/** The thin bar above the document shows how far the reader has scrolled; it is drawn without React. */
function updateReadingProgress(scroller: HTMLElement) {
  const bar = window.document.querySelector<HTMLElement>('.reading-progress > i')
  if (!bar) return
  const max = scroller.scrollHeight - scroller.clientHeight
  bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scroller.scrollTop / max) : 0})`
}

/** The UI preview (`?ui-preview=editor`) takes a style and reading settings from the URL, for screenshots. */
function previewSettings(): Settings {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('ui-theme') ?? 'dark'
  let overrides: Partial<Settings> = {}
  try { overrides = JSON.parse(params.get('ui-settings') ?? '{}') as Partial<Settings> } catch { /* ignore */ }
  return { ...defaultSettings, theme: migrateStyleId(theme) ?? 'dark', ...overrides }
}
export const uiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('ui-preview') === 'editor'
const previewTree: Record<string, TreeState> = {
  'preview-notes': { entries: [{ token: 'preview-notes-a', name: '读书笔记.md', directory: false }, { token: 'preview-notes-b', name: '草稿', directory: true }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-root': { entries: [{ token: 'preview-docs', name: 'doc', directory: true }, { token: 'preview-readme', name: 'README.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-docs': { entries: [{ token: 'preview-plan', name: '设计方案', directory: true }, { token: 'preview-file', name: '产品笔记.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
  'preview-plan': { entries: [{ token: 'preview-spec', name: '编辑器需求.md', directory: false }], nextOffset: null, expanded: true, loading: false, error: null },
}

function makeDocument(markdown: string, name = '未命名', sampleId?: string, prepared = prepareMarkdown(markdown)): DocumentState {
  return { id: nextDocumentId++, draftId: crypto.randomUUID(), name, kind: 'markdown', token: '', assetKey: '', revision: '', markdown: prepared.editorMarkdown, originalMarkdown: markdown, imageUrls: new Map(), recoveredAssets: new Map(), pendingFiles: new Map(), retiredTokens: [], sampleId, prepared, sourceText: markdown, mode: prepared.analysis.mode }
}

export function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  const messages: Record<string, string> = {
    CONFLICT: '磁盘文件已被其他程序修改，请先保留当前内容并重新打开检查。',
    READING_MODE: '阅读模式下不能修改文档，按 ⌘⇧R 开始编辑。',
    COMMIT_UNCERTAIN: '文件可能已写入，但原目录在操作期间发生变化。请先到磁盘确认文件位置，再决定是否重试。',
    TARGET_EXISTS: '目标文件已存在，请选择其他文件名。',
    INVALID_ENCODING: '无法识别这个文件的文字编码，没有打开，原文件未改动。',
    UNSUPPORTED_FORMAT: '文件内容不是它的扩展名所表示的格式（可能是二进制文件），没有打开。',
    UNSUPPORTED_FILE_TYPE: '不支持这种文件类型。可以打开 Markdown、纯文本、常见代码与配置文件和 PDF。',
    UNENCODABLE: '内容里有原编码无法表示的字符，文件没有写入。',
    READ_ONLY: 'PDF 只能阅读，不能保存或导出。',
    CHANGED: '磁盘上的文件已经变化，正在重新载入。',
    DOCUMENT_TOO_LARGE: '文件超过大小上限（PDF 200 MiB，其他 20 MiB），未截断或修改原文件。请在 Finder 中选择其他应用打开。',
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

/** T77: a large document as it opens for reading, before any analysis: the preview shows it and saving keeps its source. */
function quickDocument(markdown: string, name: string): DocumentState {
  return { token: '', assetKey: '', name, kind: 'markdown', markdown, revision: '', id: nextDocumentId++, draftId: crypto.randomUUID(), originalMarkdown: markdown, imageUrls: new Map(), recoveredAssets: new Map(), pendingFiles: new Map(), retiredTokens: [], prepared: { analysis: quickReadAnalysis(markdown), editorMarkdown: markdown }, sourceText: markdown, mode: 'source-protected', deferredVisual: true }
}

/**
 * A text, source or PDF document (T81). It never enters the visual editor and is never analyzed as Markdown:
 * it is read through its own preview and, when it is text, edited in the source editor and saved as typed.
 */
function plainDocument(text: string, name: string, kind: DocumentKind): DocumentState {
  return { ...quickDocument(text, name), kind, deferredVisual: false }
}

/** Prepares an opened file without reading its images; the webview loads those lazily by URL. */
async function hydrateImages(opened: OpenResult, quickRead = false): Promise<DocumentState> {
  if (opened.kind !== 'markdown') return { ...plainDocument(opened.markdown, opened.name, opened.kind), ...opened }
  if (opensForQuickReading(opened.markdown, quickRead)) return { ...quickDocument(opened.markdown, opened.name), ...opened }
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
  const sourceEditor = useRef<SourceEditor | null>(null)
  const forceSourceView = useRef(false)
  const sidebarRoot = useRef<HTMLElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const imageInputAction = useRef<'insert' | 'replace'>('insert')
  const adapter = useRef<EditorInstance | null>(null)
  const adapterDocumentId = useRef<number | null>(null)
  const draftUploads = useRef(new Map<string, Set<string>>())
  const previewPdf = useRef<Uint8Array | null>(null)
  const [document, setDocument] = useState<DocumentState>(() => uiPreview ? { ...(new URLSearchParams(window.location.search).get('ui-quick') === '1' ? quickDocument(previewSampleSource(new URLSearchParams(window.location.search).get('ui-sample')), '产品笔记.md') : makeDocument(previewSampleSource(new URLSearchParams(window.location.search).get('ui-sample')), '产品笔记.md')), entryToken: 'preview-file', reading: new URLSearchParams(window.location.search).get('ui-reading') === '1' } : makeDocument(''))
  const documentRef = useRef(document)
  documentRef.current = document
  // `?ui-preview=editor&ui-file=novel-utf8.txt` (development only) shows a format sample as an opened file would be.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const name = uiPreview ? params.get('ui-file') : null
    if (!name) return
    const kind = kindOfName(name)
    const reading = params.get('ui-reading') !== '0'
    void (async () => {
      if (kind === 'pdf') {
        const url = Object.entries(formatSampleUrls).find(([path]) => path.endsWith(`/${name}`))?.[1]
        if (!url) return
        previewPdf.current = new Uint8Array(await (await fetch(await url())).arrayBuffer())
        setDocument({ ...plainDocument('', name, 'pdf'), token: 'preview-pdf', size: previewPdf.current.length, reading: true })
      } else if (kind === 'text' || kind === 'code') {
        const load = Object.entries(formatSamples).find(([path]) => path.endsWith(`/${name}`))?.[1]
        const text = name === 'generated.txt' ? generatedNovel(Number(params.get('ui-chars')) || 1_000_000) : load ? await load() : null
        if (text !== null) setDocument({ ...plainDocument(text, name, kind), token: 'preview-text', encoding: 'UTF-8', reading })
      }
    })()
  }, [])
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
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const previewSettingsTab = uiPreview ? new URLSearchParams(window.location.search).get('ui-settings-tab') as SettingsTab | null : null
  const [settingsOpen, setSettingsOpen] = useState(previewSettingsTab !== null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(previewSettingsTab ?? 'appearance')
  const [panel, setPanel] = useState<FloatingPanel>(uiPreview && new URLSearchParams(window.location.search).get('ui-panel') === 'appearance' ? 'appearance' : null)
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null)
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
  const [findOptions, setFindOptionsState] = useState<FindOptions>(defaultFindOptions)
  const findOptionsRef = useRef<FindOptions>(defaultFindOptions)
  const [findRegexBlocked, setFindRegexBlocked] = useState(false)
  const findRef = useRef({ open: findOpen, query: findQuery })
  findRef.current = { open: findOpen, query: findQuery }
  const runFindRef = useRef<(query: string) => void>(() => undefined)
  const findStepRef = useRef<(direction: 1 | -1) => void>(() => undefined)
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [draftPreview, setDraftPreview] = useState<DraftContent | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [toolbar, setToolbar] = useState<ToolbarState>({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, inList: false, linkHref: null, imageAlt: null })
  const [linkOpen, setLinkOpen] = useState(false)
  const [sourceView, setSourceView] = useState(false)
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([])
  const [wordCounts, setWordCounts] = useState<{ total: number; selected: number | null }>({ total: 0, selected: null })
  const wordCountSequence = useRef(0)
  const derivedTimer = useRef<number | undefined>(undefined)
  const [tablePicker, setTablePicker] = useState<{ x: number; y: number } | null>(null)
  const [linkHref, setLinkHref] = useState('')
  const [imageAltOpen, setImageAltOpen] = useState(false)
  const [imageAltText, setImageAltText] = useState('')
  /** The folders open in the sidebar (T79). Each has its own grant in Rust; closing one releases only that grant. */
  const [workspaces, setWorkspaces] = useState<WorkspaceRoot[]>(uiPreview ? [{ token: 'preview-root', name: 'Mino' }, ...(new URLSearchParams(window.location.search).get('ui-folders') === '2' ? [{ token: 'preview-notes', name: 'Notes' }] : [])] : [])
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const [settings, setSettings] = useState<Settings>(() => uiPreview ? previewSettings() : defaultSettings)
  const sidebarOpen = settings.showSidebar
  const t = (value: string) => translate(value, settings.language)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [tree, setTree] = useState<Record<string, TreeState>>(uiPreview ? previewTree : {})
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<{ results: SearchResults | null; searching: boolean; error: string | null }>({ results: null, searching: false, error: null })
  const searchSequence = useRef(0)
  const searchTimer = useRef<number | undefined>(undefined)
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
  const reading = Boolean(document.reading)
  const plain = document.kind !== 'markdown'
  const isPdf = document.kind === 'pdf'
  /** A CSV or TSV file is shown as a table unless the reader asks for its text (T85). */
  const [tableView, setTableView] = useState(true)
  const delimiter = document.kind === 'code' && tableView ? delimiterOf(document.name) : null
  // A text or source file is read through its preview and edited in the source editor (T84); find shows the source.
  const sourceShown = plain ? !isPdf && (!reading || sourceView) : sourceView
  const wantsPreview = document.mode === 'source-protected' && !isPdf && !sourceShown && (document.kind === 'text' || !exceedsVisualLimit(document.sourceText))
  const previewVariant = `${document.kind}:${document.kind === 'code' ? `${extensionOf(document.name)}:${delimiter ?? ''}` : ''}`
  const [preview, setPreview] = useState<{ source: string; variant: string; html: string | null; partial?: boolean } | null>(null)
  const previewPending = wantsPreview && (preview?.source !== document.sourceText || preview.variant !== previewVariant)
  const previewHtml = wantsPreview && !previewPending ? preview?.html ?? null : null
  const previewPartial = previewHtml !== null && Boolean(preview?.partial)
  const previewPartialRef = useRef(previewPartial)
  previewPartialRef.current = previewPartial
  useEffect(() => {
    if (!wantsPreview) return
    let current = true
    const source = document.sourceText
    const variant = previewVariant
    // Each kind has its own renderer; only Markdown is parsed as Markdown.
    const render = document.kind === 'text' ? (text: string) => renderTextPreviewAsync(text)
      : document.kind === 'code' ? (text: string) => renderCodePreviewAsync(text, document.name, delimiter)
      : (text: string) => renderPreviewAsync(text, document.assetKey || undefined, settings.imageCaptions)
    // T77: the opening pages of a long document appear first; the worker renders the whole after them.
    const head = document.kind === 'markdown' ? previewHead(source) : document.kind === 'text' ? textHead(source) : null
    if (head !== null) render(head).then((html) => { if (current) { performance.mark('mino-preview-head'); setPreview((shown) => shown?.source === source && shown.variant === variant && !shown.partial ? shown : { source, variant, html, partial: true }) } }, () => undefined)
    render(source).then((html) => html, () => null).then((html) => { if (current) { performance.mark('mino-preview-full'); setPreview({ source, variant, html }) } })
    return () => { current = false }
  }, [wantsPreview, document.sourceText, document.assetKey, document.kind, document.name, previewVariant, settings.imageCaptions])
  const refreshDerivedRef = useRef<() => void>(() => undefined)
  refreshDerivedRef.current = () => {
    if (settingsRef.current.showOutline) setOutlineItems(currentOutline())
    void refreshWordCounts()
  }
  const [pdfOutlineItems, setPdfOutlineItems] = useState<{ id: number; items: OutlineItem[] }>({ id: 0, items: [] })
  const pdfOutlineRef = useRef(pdfOutlineItems)
  pdfOutlineRef.current = pdfOutlineItems
  const [pdfPages, setPdfPages] = useState<{ id: number; pages: number } | null>(null)
  const pdfView = useRef<PdfHandle | null>(null)
  useEffect(() => { refreshDerivedRef.current() }, [document.id, document.mode, toolbar.ready, sourceShown, previewHtml, settings.showOutline, pdfOutlineItems])

  async function refreshWordCounts(): Promise<void> {
    const sequence = ++wordCountSequence.current
    const current = documentRef.current
    if (current.kind === 'pdf') { setWordCounts((old) => old.total === 0 && old.selected === null ? old : { total: 0, selected: null }); return }
    const element = sourceEditor.current
    const visual = current.mode === 'visual' ? adapter.current?.plainText() : null
    const text = visual?.text ?? element?.value ?? current.sourceText
    const selected = visual ? visual.selected : element && element.selectionStart !== element.selectionEnd ? element.value.slice(element.selectionStart, element.selectionEnd) : null
    const [total, selectedTotal] = await Promise.all([countWordsAsync(text), selected === null ? null : countWordsAsync(selected)])
    if (sequence !== wordCountSequence.current) return
    setWordCounts((old) => old.total === total && old.selected === selectedTotal ? old : { total, selected: selectedTotal })
  }
  useEffect(() => () => window.clearTimeout(derivedTimer.current), [])

  function currentOutline(): OutlineItem[] {
    const current = documentRef.current
    if (current.mode === 'visual') return adapter.current?.outline() ?? []
    if (current.kind === 'pdf') return pdfOutlineRef.current.id === current.id ? pdfOutlineRef.current.items : []
    if (previewRoot.current) return Array.from(previewRoot.current.querySelectorAll('h1, h2, h3, h4, h5, h6'), (heading, target) => ({ level: Number(heading.tagName[1]), text: heading.textContent?.trim() ?? '', target })).filter((item) => item.text)
    if (current.kind === 'code') return []
    return (current.kind === 'text' ? textOutline : outlineFromSource)(sourceEditor.current?.value ?? current.sourceText)
  }

  function goToOutlineItem(item: OutlineItem) {
    if (documentRef.current.mode === 'visual') { adapter.current?.revealHeading(item.target); return }
    if (documentRef.current.kind === 'pdf') { pdfView.current?.goToPage(item.target); return }
    if (previewRoot.current) { previewRoot.current.querySelectorAll('h1, h2, h3, h4, h5, h6')[item.target]?.scrollIntoView({ block: 'start' }); return }
    const element = sourceEditor.current
    if (!element) return
    element.focus()
    element.setSelectionRange(item.target, item.target)
    element.reveal(item.target, 1)
  }

  const canProceedRef = useRef<(finalizeDiscard?: boolean) => Promise<boolean>>(async () => true)
  const saveDocumentRef = useRef<(background?: boolean) => Promise<boolean>>(async () => false)
  const closeWindowRef = useRef<() => Promise<void>>(async () => undefined)

  /** Keystrokes only advance the ref; React re-renders when something visible about the session changes. */
  function updateSession(next: DocumentSession) {
    const previous = sessionRef.current
    sessionRef.current = next
    if (next.revision !== previous.revision && isDirty(next)) draftScheduler.current?.schedule()
    if (next.revision !== previous.revision) scheduleDerivedRefresh()
    if (next.revision !== previous.revision && isDirty(next)) autosaveScheduler.current?.schedule()
    if (isDirty(next) !== isDirty(previous) || next.generation !== previous.generation || next.persistence !== previous.persistence || next.diskRevision !== previous.diskRevision || next.errorCode !== previous.errorCode) setSession(next)
  }

  /** Derived views follow edits on a delay, so typing never waits for them. */
  function scheduleDerivedRefresh() {
    window.clearTimeout(derivedTimer.current)
    derivedTimer.current = window.setTimeout(() => {
      if (composingRef.current) { scheduleDerivedRefresh(); return }
      refreshDerivedRef.current()
    }, 300)
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

  const scrollPositions = useRef(new Map<number, number>())
  /** Where a text or source file was left the last time it was read (T83), by document id, until it is applied. */
  const savedPositions = useRef(new Map<number, number>())

  /** The element that scrolls the active document: the editor root, or the preview of a protected document. */
  function documentScroller(): HTMLElement | null {
    if (documentRef.current.mode === 'visual') return adapter.current?.rootElement ?? null
    if (documentRef.current.kind === 'pdf') return pdfView.current?.scroller ?? null
    return previewRoot.current
  }

  function setReading(next: boolean) {
    const current = documentRef.current
    if (Boolean(current.reading) === next) return
    if (current.kind === 'pdf') { setStatus('PDF 只能阅读'); return }
    if (next && toolbar.composing) return
    documentRef.current = { ...current, reading: next }
    setDocument(documentRef.current)
    updateTabs(tabsRef.current.map((tab) => tab.key === activeTabKeyRef.current ? { ...tab, document: documentRef.current } : tab))
    if (next) { flushSourceText(); setLinkOpen(false); setImageAltOpen(false); setTablePicker(null); if (documentRef.current.mode === 'source-protected') setSourceView(false) }
    setStatus(next ? '阅读模式 · 按 ⌘⇧R 开始编辑' : '编辑模式')
    if (!next) window.setTimeout(() => current.kind === 'markdown' ? adapter.current?.focus() : sourceEditor.current?.focus(), 0)
  }

  /** T77: where the reader was in the quick-reading preview, as a fraction, for the editor that replaces it. */
  const carriedScroll = useRef<{ id: number; fraction: number } | null>(null)
  /** Puts the active document back where it was read last in this session, and redraws the progress bar. */
  function restoreScroll() {
    requestAnimationFrame(() => {
      const scroller = documentScroller()
      if (!scroller) return
      const id = documentRef.current.id
      const carried = carriedScroll.current?.id === id ? carriedScroll.current.fraction : null
      carriedScroll.current = null
      const session = scrollPositions.current.get(id)
      const saved = savedPositions.current.get(id)
      // A text file returns to where it was left in an earlier run, once its whole page is there (T83).
      if (carried === null && session === undefined && saved !== undefined && !previewPartialRef.current && scroller === previewRoot.current) {
        if (restoreBlockPosition(scroller, saved)) savedPositions.current.delete(id)
      } else scroller.scrollTop = carried !== null ? carried * (scroller.scrollHeight - scroller.clientHeight) : session ?? 0
      updateReadingProgress(scroller)
    })
  }

  useEffect(() => { adapter.current?.setReadonly(reading) }, [reading, document.id, toolbar.ready])
  useEffect(() => { if (previewHtml !== null) restoreScroll() }, [previewHtml])
  // T77: a quickly opened large document is analyzed and loaded into the editor once the user leaves reading mode.
  useEffect(() => { if (document.deferredVisual && document.kind === 'markdown' && !document.reading && !busy) void switchToVisualRef.current().catch(() => { if (documentRef.current.deferredVisual) setDocument({ ...documentRef.current, deferredVisual: false }); setStatus('无法准备编辑器，文档保持源码模式') }) }, [document.id, document.deferredVisual, document.reading, busy])

  useEffect(() => {
    let frame = 0
    // Scroll events do not bubble, so one capturing listener sees every document's scroller.
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target !== documentScroller()) return
      scrollPositions.current.set(documentRef.current.id, target.scrollTop)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => updateReadingProgress(target))
      schedulePositionSave()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll, true) }
  }, [])

  const positionTimer = useRef<number | undefined>(undefined)
  /** Remembers the place in a text or source file a moment after scrolling stops; the PDF view saves its own. */
  function schedulePositionSave() {
    const current = documentRef.current
    if (!desktop || !current.token || (current.kind !== 'text' && current.kind !== 'code')) return
    window.clearTimeout(positionTimer.current)
    positionTimer.current = window.setTimeout(() => {
      const scroller = previewRoot.current
      if (!scroller || documentRef.current.id !== current.id || previewPartialRef.current) return
      const offset = blockPosition(scroller)
      if (offset !== null) void invoke('set_reading_position', { token: current.token, position: { page: 0, offset } }).catch(() => undefined)
    }, 1200)
  }
  useEffect(() => () => window.clearTimeout(positionTimer.current), [])
  // Ask once per opened text or source file where it was left.
  useEffect(() => {
    const { id, token, kind } = documentRef.current
    if (!desktop || !token || (kind !== 'text' && kind !== 'code') || scrollPositions.current.has(id)) return
    let current = true
    void invoke<PdfPosition | null>('get_reading_position', { token }).then((position) => {
      if (!current || !position || position.offset <= 0 || scrollPositions.current.has(id)) return
      savedPositions.current.set(id, position.offset)
      if (documentRef.current.id === id && previewRoot.current) restoreScroll()
    }).catch(() => undefined)
    return () => { current = false }
  }, [desktop, document.id, document.token])

  /** Reading keys: space pages down less two lines, arrows scroll smoothly, letters only show a hint. */
  function handleReadingKey(event: KeyboardEvent): boolean {
    const target = event.target instanceof Element ? event.target : null
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false
    if (target?.closest('input, textarea, select, button, .find-bar, .cm-editor, .settings-dialog, [contenteditable="true"]')) return false
    const scroller = documentScroller()
    if (!scroller) return false
    const line = settingsRef.current.editorFontSize * lineHeights[settingsRef.current.editorLineHeight]
    const page = Math.max(line, scroller.clientHeight - 2 * line)
    const by = (top: number) => { event.preventDefault(); scroller.scrollBy({ top, behavior: 'smooth' }); return true }
    if (event.key === ' ' || event.key === 'PageDown') return by(event.shiftKey ? -page : page)
    if (event.key === 'PageUp') return by(-page)
    if (event.key === 'ArrowDown') return by(line * 2)
    if (event.key === 'ArrowUp') return by(-line * 2)
    if (event.key === 'Home') { event.preventDefault(); scroller.scrollTo({ top: 0, behavior: 'smooth' }); return true }
    if (event.key === 'End') { event.preventDefault(); scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }); return true }
    if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
      event.preventDefault()
      if (documentRef.current.kind !== 'pdf') setStatus('阅读模式 · 按 ⌘⇧R 开始编辑')
      return true
    }
    return false
  }

  function noteBusy() { setStatus('当前操作尚未完成，请稍后再试') }

  function switchTab(key: string) {
    if (key === activeTabKeyRef.current) return
    if (busyRef.current) { noteBusy(); return }
    captureCurrentTab()
    const target = tabsRef.current.find((tab) => tab.key === key)
    if (target) activateTab(target)
  }

  function openTab(opened: DocumentState, nextSession = createSession(opened.id)) {
    // Files opened from disk start in reading mode; new, draft-restored and unsaved documents open for editing.
    const nextDocument = opened.kind === 'pdf' ? { ...opened, reading: true } : opened.reading !== undefined ? opened : { ...opened, reading: opensInReadingMode(settingsRef.current.openInReadingMode, Boolean(opened.token), isDirty(nextSession)) }
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
      const transfer: DetachedTransfer = { name: note.name, kind: note.kind, encoding: note.encoding, size: note.size, token: note.token, assetKey: note.assetKey, retiredTokens: note.retiredTokens, imageUrls: Array.from(note.imageUrls), revision: note.revision, markdown, originalMarkdown: note.originalMarkdown, sourceText: note.sourceText, mode: note.mode, draftId: note.draftId, session: tab.session, assets }
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
      const kind = transfer.kind ?? 'markdown'
      const next = kind === 'markdown' ? makeDocument(transfer.originalMarkdown, transfer.name, undefined, await prepareMarkdownAsync(transfer.originalMarkdown)) : { ...plainDocument(transfer.originalMarkdown, transfer.name, kind), encoding: transfer.encoding, size: transfer.size }
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
    setToolbar({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, inList: false, linkHref: null, imageAlt: null })
    setLinkOpen(false)
    setSourceView(forceSourceView.current || (findRef.current.open && document.mode === 'source-protected'))
    forceSourceView.current = false
    setTablePicker(null)
    setImageAltOpen(false)
    if (document.mode === 'source-protected') {
      setStatus(document.kind === 'pdf' ? `已打开 ${document.name}` : document.kind !== 'markdown' ? `已打开 ${document.name}${document.reading ? ' · 阅读模式，按 ⌘⇧R 开始编辑' : ''}` : document.deferredVisual ? `已打开 ${document.name} · 大文档快速阅读，按 ⌘⇧R 开始编辑` : `源码模式：${describeIssues(document.prepared.analysis) || '手动切换'}；可保存原文`)
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
      }, document.imageUrls, document.recoveredAssets, document.pendingFiles, setToolbar, (message) => { if (message) setStatus(message) }, setTablePicker, (href) => linkOpenRef.current(href), scheduleDerivedRefresh))
      adapter.current = instance
      adapterDocumentId.current = document.id
      instance.setReadonly(Boolean(documentRef.current.reading))
      editorPool.current.retain(new Set([documentRef.current.id, ...tabsRef.current.map((tab) => tab.document.id)]))
      if (!created) {
        void instance.create().then(() => { if (!disposed) { if (documentRef.current.reading) instance.setReadonly(true); else instance.resume(); restoreScroll(); reapplyFind(instance); setStatus(document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存') } }).catch(() => undefined)
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
          setStatus(documentRef.current.reading ? `已打开 ${document.name} · 阅读模式，按 ⌘⇧R 开始编辑` : document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存')
          restoreScroll()
          if (!document.token && !documentRef.current.reading) instance.focus()
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

  const style = activeStyle(settings, systemDark)
  useEffect(() => {
    window.document.documentElement.dataset.theme = style.id
    // Diagrams take their colors from the style; Mermaid only loads when one is on screen.
    if (window.document.querySelector('.mermaid-preview')) void import('../features/diagrams/mermaid').then((module) => module.restyleDiagrams(window.document, style.id))
  }, [style.id])

  // Western layout follows the text the document had when it was opened or last saved, so typing never reflows the page.
  const docScript = useMemo(() => dominantScript(document.sourceText), [document.id, document.sourceText])
  const latinLayout = layoutScript(settings, docScript) === 'latin'
  const typography = documentTypography(settings, style, docScript)
  const typographyKey = JSON.stringify(typography)
  useEffect(() => {
    const root = window.document.documentElement
    for (const [name, value] of Object.entries(typographyVariables(typography, style))) root.style.setProperty(name, value)
    root.style.setProperty('--editor-font', typography.fontFamily)
    root.style.setProperty('--editor-font-size', `${typography.fontSize}px`)
    root.style.setProperty('--editor-line-height', String(typography.lineHeight))
  }, [typographyKey, style.id])

  /** Font families installed on this Mac, read once when the font panel first needs them (T67). */
  function loadSystemFonts() {
    if (systemFonts !== null) return
    if (!desktop) { setSystemFonts(uiPreview ? (window as { previewFonts?: string[] }).previewFonts ?? ['Avenir Next', 'Baskerville', 'Georgia', 'Helvetica Neue', 'Kaiti SC', 'PingFang SC', 'Songti SC', 'Times New Roman'] : []); return }
    void invoke<string[]>('list_system_fonts').then(setSystemFonts, () => setSystemFonts([]))
  }
  const pickStyle = (picked: ReadingStyle) => setSettings((current) => ({ ...current, ...pickedStyle(picked, current, systemDark) }))
  const toggleDayNight = () => setSettings((current) => ({ ...current, ...toggledDayNight(current, systemDark) }))

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

  const autosaveScheduler = useRef<DraftScheduler | null>(null)
  const autosaveStopped = useRef(new Set<number>())
  const autosaveTimerRef = useRef<() => void>(() => undefined)
  autosaveTimerRef.current = () => {
    const current = documentRef.current
    const decision = autosaveDecision({
      enabled: settingsRef.current.autoSave, hasFile: Boolean(current.token), dirty: isDirty(sessionRef.current), persistence: sessionRef.current.persistence,
      stopped: autosaveStopped.current.has(current.id), conflict: diskConflictRef.current?.documentId === current.id,
      busy: busyRef.current, composing: composingRef.current, ready: current.mode !== 'visual' || Boolean(adapter.current?.isReady()),
    })
    if (decision === 'wait') autosaveScheduler.current?.schedule()
    if (decision !== 'save') return
    void saveDocumentRef.current(true).then((saved) => {
      if (documentRef.current.id !== current.id) return
      if (['failed', 'conflict'].includes(sessionRef.current.persistence)) {
        // The save reported why; repeating it every interval would only hide the first error.
        autosaveStopped.current.add(current.id)
        setStatus('自动保存已暂停；请处理上面的问题后手动保存一次')
      } else if (!saved && isDirty(sessionRef.current)) autosaveScheduler.current?.schedule()
    })
  }

  useEffect(() => {
    autosaveScheduler.current?.cancel()
    autosaveScheduler.current = settings.autoSave ? createDraftScheduler(() => autosaveTimerRef.current(), settings.autoSaveSeconds * 1000, settings.autoSaveSeconds * 1000) : null
    if (isDirty(sessionRef.current)) autosaveScheduler.current?.schedule()
    return () => autosaveScheduler.current?.cancel()
  }, [settings.autoSave, settings.autoSaveSeconds])

  useEffect(() => {
    if (isDirty(sessionRef.current) && sessionRef.current.generation === document.id) autosaveScheduler.current?.schedule()
  }, [document.id, document.token])

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
      // A draft of a text or source file comes back as one; its name says what it was.
      const recoveredKind = kindOfName(recovered.name)
      const next = recoveredKind === 'text' || recoveredKind === 'code' ? plainDocument(recovered.markdown, recovered.name, recoveredKind) : makeDocument(recovered.markdown, recovered.name, undefined, await prepareMarkdownAsync(recovered.markdown))
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
      const next = await hydrateImages(opened, Boolean(documentRef.current.reading))
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
      if (lockedSource) lockedSource.readOnly = documentRef.current.kind !== 'markdown' && Boolean(documentRef.current.reading)
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

  /**
   * Runs a save command; when the text cannot be written in the file's own encoding (T82) the user is asked
   * whether to save it as UTF-8 instead, and nothing is written unless they agree. `assets` is called again
   * for the second attempt because staged uploads are consumed by the first.
   */
  async function invokeSave<T>(command: string, args: Record<string, unknown>, assets: () => Promise<StagedAsset[]>): Promise<T> {
    try { return await invoke<T>(command, { ...args, assets: await assets(), forceUtf8: false }) }
    catch (error) {
      if (String(error) !== 'UNENCODABLE') throw error
      const encoding = documentRef.current.encoding ?? ''
      const agreed = window.confirm(settingsRef.current.language === 'en-US'
        ? `Some characters cannot be written in this file's encoding${encoding ? ` (${encoding})` : ''}.\nSave the file as UTF-8 instead?`
        : `内容里有原编码${encoding ? `（${encoding}）` : ''}无法表示的字符。\n要把这个文件改存为 UTF-8 吗？`)
      if (!agreed) throw new Error('UNENCODABLE')
      return invoke<T>(command, { ...args, assets: await assets(), forceUtf8: true })
    }
  }

  async function saveConflictCopyAs(): Promise<void> {
    if (busyRef.current) { noteBusy(); return }
    if (!isTextKind(documentRef.current.kind)) { setStatus(errorText('READ_ONLY')); return }
    setBusy(true)
    try {
      const markdown = currentDocumentText()
      const assets = adapter.current?.isReady() ? await adapter.current.pendingAssets() : []
      const name = await invokeSave<string | null>('save_conflict_copy', { token: documentRef.current.token, markdown }, () => stageAssets(assets))
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
      if (intent.kind === 'document') {
        const opened = await invoke<OpenResult>('open_intent_document', { token: intent.token })
        candidateToken = opened.token
        const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
        openTab(hydrated, createSession(hydrated.id, hydrated.revision))
        candidateToken = null
        void rememberDocument(hydrated.token).catch(() => undefined)
      } else if (intent.kind === 'folder') {
        const chosen = await invoke<WorkspaceRoot>('open_intent_workspace', { token: intent.token })
        await activateWorkspace(chosen)
      } else {
        if (document.mode !== 'visual') { await invoke('discard_open_intent', { token: intent.token }); setStatus(document.kind === 'markdown' ? '源码保护模式不能直接插入图片' : '这类文档不能插入图片'); return }
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
    void getCurrentWindow().listen('open-intents-empty-drop', () => setStatus('macOS 未提供拖入文件路径，请从 Finder 拖入本地文件')).then((stop) => { if (canceled) stop(); else unlistenEmpty = stop }).catch((error: unknown) => setStatus(errorText(error)))
    void drain()
    return () => { canceled = true; unlisten?.(); unlistenEmpty?.() }
  }, [desktop])

  const sessionStarted = useRef(false)
  const [sessionReady, setSessionReady] = useState(false)
  const lastSessionRecord = useRef('')

  async function restoreLastSession(): Promise<void> {
    // A Finder open already in progress must finish first, so its file counts as open below.
    while (busyRef.current) await new Promise((resolve) => window.setTimeout(resolve, 100))
    busyRef.current = true
    setBusy(true)
    try {
      const restored = await invoke<RestoredSession>('restore_session', { openTokens: tabsRef.current.map((tab) => tab.document.token).filter(Boolean) })
      const items: TabItem[] = []
      let activeItem: TabItem | null = null
      let missing = restored.missing
      for (const [index, opened] of restored.documents.entries()) {
        try {
          const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
          const item = { key: crypto.randomUUID(), document: hydrated, session: createSession(hydrated.id, hydrated.revision) }
          items.push(item)
          if (index === restored.active) activeItem = item
        } catch { missing++; await releaseCandidate(opened.token) }
      }
      if (items.length > 0) {
        const activeDocument = documentRef.current
        const onlyBlank = tabsRef.current.length === 1 && activeDocument.id === initialDocumentId.current && !activeDocument.token && activeDocument.markdown === '' && !isDirty(sessionRef.current)
        if (onlyBlank) { updateTabs(items); activateTab(activeItem ?? items[0]) }
        // Something else opened first, such as a file from Finder, so it stays in front.
        else { captureCurrentTab(); updateTabs([...items, ...tabsRef.current]) }
      }
      if (missing > 0) setStatus(`已恢复 ${items.length} 个文档；${missing} 个文件已不在原位置`)
    } catch (error) { setStatus(errorText(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  useEffect(() => {
    if (!desktop || !settingsLoaded || sessionStarted.current) return
    sessionStarted.current = true
    if (getCurrentWindow().label !== 'main' || !settingsRef.current.restoreSession) { setSessionReady(true); return }
    void restoreLastSession().finally(() => setSessionReady(true))
  }, [desktop, settingsLoaded])

  useEffect(() => {
    // Waiting for `sessionReady` keeps the blank startup tab from overwriting the saved session.
    if (!desktop || !sessionReady || getCurrentWindow().label !== 'main') return
    if (!settings.restoreSession) {
      if (lastSessionRecord.current) { lastSessionRecord.current = ''; void invoke('remember_session', { tokens: [], active: null }).catch(() => undefined) }
      return
    }
    const timer = window.setTimeout(() => {
      const open = tabsRef.current.map((tab) => ({ key: tab.key, token: tab.key === activeTabKeyRef.current ? documentRef.current.token : tab.document.token })).filter((tab) => tab.token)
      const active = open.findIndex((tab) => tab.key === activeTabKeyRef.current)
      const payload = { tokens: open.map((tab) => tab.token), active: active < 0 ? null : active }
      const record = JSON.stringify(payload)
      if (record === lastSessionRecord.current) return
      lastSessionRecord.current = record
      void invoke('remember_session', payload).catch((error: unknown) => setStatus(errorText(error)))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [desktop, sessionReady, settings.restoreSession, tabs, activeTabKey, document.token])

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
        const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
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
    resetWorkspaceSearch()
    // Rust returns the existing grant for a folder that is already open, so it is not listed twice.
    setWorkspaces((current) => current.some((root) => root.token === chosen.token) ? current : [...current, chosen])
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
      const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
      openTab({ ...hydrated, entryToken: token }, createSession(hydrated.id, hydrated.revision))
      candidateToken = null
      void rememberDocument(opened.token).catch(() => undefined)
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  /** Newer queries overtake older ones: Rust stops the old walk and the sequence drops any late answer. */
  function runWorkspaceSearch(query: string) {
    window.clearTimeout(searchTimer.current)
    const sequence = ++searchSequence.current
    const roots = workspacesRef.current
    if (roots.length === 0 || !query.trim()) {
      setSearchState({ results: null, searching: false, error: null })
      if (roots.length > 0 && desktop) void invoke('search_workspace', { rootToken: roots[0].token, query: '' }).catch(() => undefined)
      return
    }
    setSearchState((current) => ({ ...current, searching: true, error: null }))
    searchTimer.current = window.setTimeout(() => {
      // One folder after another: Rust keeps a single search per window and a new call stops the one before it.
      void (async () => {
        const merged: SearchResults = { hits: [], truncated: false, skipped: 0 }
        try {
          for (const root of roots) {
            const results = await invoke<SearchResults>('search_workspace', { rootToken: root.token, query })
            if (sequence !== searchSequence.current) return
            merged.hits.push(...results.hits.map((hit) => ({ ...hit, root: root.name })))
            merged.truncated ||= results.truncated
            merged.skipped += results.skipped
            if (merged.hits.length >= SEARCH_HIT_LIMIT) { merged.hits.length = SEARCH_HIT_LIMIT; merged.truncated = true; break }
          }
          setSearchState({ results: merged, searching: false, error: null })
        } catch (error) {
          if (sequence === searchSequence.current && String(error) !== 'SEARCH_CANCELED') setSearchState({ results: null, searching: false, error: errorText(error) })
        }
      })()
    }, 250)
  }

  function resetWorkspaceSearch() {
    window.clearTimeout(searchTimer.current)
    searchSequence.current++
    setSearchQuery('')
    setSearchState({ results: null, searching: false, error: null })
  }

  async function openSearchHit(hit: SearchHit) {
    const query = searchQuery.trim()
    const open = tabsRef.current.find((tab) => tab.document.entryToken === hit.token)
    if (open) switchTab(open.key)
    else await openWorkspaceEntry(hit.token)
    if (documentRef.current.entryToken !== hit.token) return
    findRef.current = { open: true, query }
    findOptionsRef.current = defaultFindOptions
    setFindOptionsState(defaultFindOptions)
    setFindQuery(query)
    openFind()
    const deadline = performance.now() + 5000
    do await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    while (performance.now() < deadline && !(documentRef.current.mode === 'visual' ? adapterDocumentId.current === documentRef.current.id && adapter.current?.isReady() : sourceEditor.current))
    runFindRef.current(query)
    for (let step = 0; step < hit.occurrence; step++) findStepRef.current(1)
  }

  /** Closes one open folder, or all of them. Documents already open from it stay open: each holds its own grant. */
  async function closeWorkspace(token?: string) {
    const closing = workspacesRef.current.filter((root) => token === undefined || root.token === token)
    if (closing.length === 0) return
    resetWorkspaceSearch()
    try {
      for (const root of closing) await invoke('release_workspace', { token: root.token })
      const rest = workspacesRef.current.filter((root) => !closing.includes(root))
      setWorkspaces(rest)
      setTree((current) => rest.length === 0 ? {} : Object.fromEntries(Object.entries(current).filter(([key]) => !closing.some((root) => root.token === key))))
      setSelectedDirectory(rest[0]?.token ?? null)
      setSelectedEntry(null)
      setStatus(closing.length === 1 ? `已关闭文件夹 ${closing[0].name}` : '已关闭全部文件夹')
    } catch (error) { setStatus(errorText(error)) }
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

  async function saveDocument(asNew = false, background = false): Promise<boolean> {
    const instance = adapter.current
    if (background && (busyRef.current || toolbar.composing)) return false
    if (busy) {
      if (sessionRef.current.persistence === 'saving') { queuedSave.current = true; setStatus('正在保存，完成后会再保存一次') }
      else noteBusy()
      return false
    }
    if (!isTextKind(document.kind)) { if (!background) setStatus(errorText('READ_ONLY')); return false }
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
      const saved = await invokeSave<SaveResult | null>(asNew && document.token ? 'save_as_document' : 'save_document', {
        token: document.token || null,
        expectedRevision: ticket.diskRevision,
        markdown,
        // A recovered draft of a text file is offered its own name and type, not Markdown.
        suggestedName: !document.token && document.kind !== 'markdown' ? document.name : null,
      }, () => stageAssets(assets))
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
        ...current, kind: saved.kind, encoding: saved.encoding,
        // A text file saved as Markdown becomes a Markdown document: read as one now, analyzed when editing starts.
        deferredVisual: saved.kind === 'markdown' && current.kind !== 'markdown' ? true : current.deferredVisual,
        token: saved.token, assetKey: saved.assetKey, retiredTokens: document.token && saved.token !== document.token ? [...current.retiredTokens, document.token] : current.retiredTokens, name: saved.name, revision: saved.revision, originalMarkdown: saved.markdown, sourceText: current.mode === 'source-protected' && unchangedDuringSave ? saved.markdown : current.sourceText, sampleId: undefined,
      } : current)
      setNotice((current) => current?.kind === 'error' ? null : current)
      const completed = saveSucceeded(sessionRef.current, ticket, saved.revision)
      updateSession(completed)
      let draftCleanupError = ''
      if (!isDirty(completed)) {
        try { await discardDraft(document.draftId) }
        catch (draftError) { draftCleanupError = `；草稿清理失败：${errorText(draftError)}` }
      }
      setStatus(`${background ? '已自动保存' : '已保存'} ${saved.name}${isDirty(completed) ? '；保存期间的新修改仍未保存' : ''}${draftCleanupError}`)
      if (!background) {
        autosaveStopped.current.delete(document.id)
        void rememberDocument(saved.token).catch(() => undefined)
      }
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
  saveDocumentRef.current = (background = false) => saveDocument(false, background)

  async function exportPage(mode: 'html' | 'print') {
    if (busy) { noteBusy(); return }
    if (document.kind === 'pdf') { setStatus(errorText('READ_ONLY')); return }
    if ((document.mode === 'visual' && !adapter.current) || toolbar.composing) return
    setBusy(true)
    let snapshotId: string | null = null
    try {
      // A text or source file has no images and is not Markdown: its own renderer makes the body (T88).
      const plainText = document.kind === 'markdown' ? null : flushSourceText().sourceText
      const bodyHtml = plainText === null ? undefined : document.kind === 'text' ? await renderTextPreviewAsync(plainText) : await renderCodePreviewAsync(plainText, document.name, delimiter)
      if (plainText === null) snapshotId = await captureSnapshot(false)
      const frozen = plainText === null ? await invoke<SnapshotOut>('read_snapshot', { snapshotId }) : { markdown: '', title: document.name, assets: [] as StagedAsset[], generation: document.id, revision: sessionRef.current.revision }
      const assets = new Map(await Promise.all(frozen.assets.map(async (asset) => [asset.url, { bytes: await readStaged(asset.staged), mime: asset.mime }] as const)))
      // The page carries the reading style, typography and only the font subsets its characters need (T59).
      const current = settingsRef.current
      const { buildExportStyle } = await import('../features/export/exportStyle')
      const { readAppAsset } = await import('../features/export/appAssets')
      const look = await buildExportStyle({
        style, typography: documentTypography(current, style, docScript), exportStyle: current.exportStyle, pdfMode: current.pdfMode, pageSize: current.pageSize, pageMargin: current.pageMargin,
        text: `${frozen.title}\n${plainText ?? frozen.markdown}`, mode, readAsset: (path) => readAppAsset(path, (assetPath) => invoke<ArrayBuffer>('read_app_asset', { path: assetPath })),
      })
      const sources = mayContainMermaid(frozen.markdown) ? await mermaidSourcesAsync(frozen.markdown) : []
      const diagrams = sources.length ? await (await import('../features/diagrams/mermaid')).renderDiagramsForExport(sources, look.diagramStyleId) : new Map<string, string>()
      const rendered = await renderExportAsync(frozen.markdown, titleOf(frozen.title), assets, diagrams, { stylesheet: look.stylesheet, fontsEmbedded: look.fontsEmbedded, captions: current.imageCaptions, lang: layoutScript(current, docScript) === 'latin' ? 'en' : 'zh-CN', bodyHtml })
      const { omittedHtml, failedDiagrams } = rendered
      const html = rendered.hasMath ? (await import('../features/export/katexStyles')).embedMathStyles(rendered.html) : rendered.html
      const omitted = `${omittedHtml ? `；${omittedHtml} 处原始 HTML 未输出` : ''}${failedDiagrams ? `；${failedDiagrams} 张图表无法渲染，已保留代码` : ''}${look.fontFallback ? '；字体未能内嵌，已改用系统字体' : ''}`
      if (mode === 'html') {
        const name = await invoke<string | null>('export_html', { html })
        setStatus(name ? `已导出 ${name}${omitted}` : '已取消 HTML 导出，当前文档未改变')
      } else {
        const { printHtml } = await import('../features/export/printHtml')
        const printState = await printHtml(html)
        setStatus(printState === 'dialogOpened' ? `打印页已交给系统；请在系统对话框中选择“存储为 PDF”。应用无法确认最终 PDF 路径。${omitted}` : '打印未完成')
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
    let assets: PendingAsset[] = []
    let diskAssets: { url: string; relative: string }[] = []
    if (!textOnly) {
      const held: PendingAsset[] = document.mode === 'visual' ? await instance!.pendingAssets() : Array.from(document.recoveredAssets, ([url, asset]) => ({ url, ...asset }))
      ;({ assets, diskAssets } = snapshotResources(await imageUrlsInAsync(markdown), new Map(held.map((asset) => [asset.url, asset])), Boolean(document.token)))
    }
    return invoke<string>('create_snapshot', { markdown, title: document.name, assets: await stageAssets(assets), diskAssets, token: document.token || null, generation: document.id, revision })
  }

  async function exportSnapshotMD(textOnly: boolean) {
    if (busy) { noteBusy(); return }
    if (document.kind !== 'markdown') { setStatus(document.kind === 'pdf' ? errorText('READ_ONLY') : '这类文档不是 Markdown；可以用“另存为”存成 Markdown。'); return }
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

  function runFormatAction(action: string) {
    const editor = adapter.current
    if (documentRef.current.mode !== 'visual' || !editor?.hasEditorFocus()) return
    if (action === 'format-link') { setLinkHref(editor.captureSelection() ?? ''); setLinkOpen(true); return }
    const command = formatMenuCommands[action]
    if (command) editor.runCommand(command)
    const transform = transformMenuActions[action]
    if (transform) editor.runTextTransform(transform)
  }

  function runFileAction(action: string) {
    if (action.startsWith('recent:')) { void openRecent(action); return }
    if (action.startsWith('format-') || action.startsWith('transform-')) { runFormatAction(action); return }
    if (isZoomAction(action) && documentRef.current.kind === 'pdf') { pdfView.current?.zoom(action as 'zoom-in' | 'zoom-out' | 'zoom-reset'); return }
    if (isZoomAction(action)) { setSettings((current) => ({ ...current, editorFontSize: zoomedFontSize(current.editorFontSize, action) })); return }
    if (action === 'new') void newDocument()
    if (action === 'open') void openDocument()
    if (action === 'open-folder') void chooseWorkspace()
    if (action === 'save') void saveDocument()
    if (action === 'save-as') void saveDocument(true)
    if (action === 'export-md') void exportSnapshotMD(false)
    if (action === 'export-text') void exportSnapshotMD(true)
    if (action === 'find') openFind()
    if (action === 'toggle-source' && document.kind === 'markdown') { if (document.mode === 'visual') switchToSource(); else void switchToVisual() }
    if (action === 'export-html') void exportPage('html')
    if (action === 'print') void exportPage('print')
    if (action === 'toggle-reading') setReading(!documentRef.current.reading)
    if (action === 'view-toolbar') setSettings((current) => ({ ...current, showFileToolbar: !current.showFileToolbar }))
    if (action === 'view-sidebar') setSettings((current) => ({ ...current, showSidebar: !current.showSidebar }))
    if (action === 'view-outline') setSettings((current) => ({ ...current, showOutline: !current.showOutline }))
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
        const action = key === 's' ? null : key === 'r' && event.shiftKey ? 'toggle-reading' : key === 'n' ? (event.shiftKey ? 'new-window' : 'new') : key === 'o' ? (event.shiftKey ? 'open-folder' : 'open') : key === 'w' ? 'close-tab' : key === ',' ? 'preferences' : key === 'f' ? 'find' : key === '=' || key === '+' ? 'zoom-in' : key === '-' ? 'zoom-out' : key === '0' ? 'zoom-reset' : key === 'k' ? 'format-link' : null
        if (key === 's') event.preventDefault()
        if (action) { event.preventDefault(); runFileAction(action) }
      }
      if (documentRef.current.reading && !settingsOpen && !draftsOpen && !lightbox && handleReadingKey(event)) return
      if (event.key === 'Escape') {
        setPanel(null)
        setLightbox(null)
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
      const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
      openTab(hydrated, createSession(hydrated.id, hydrated.revision))
      candidateToken = null
      void rememberDocument(opened.token).catch(() => undefined)
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { setBusy(false) }
  }

  function openFind() {
    setFindOpen(true)
    if (documentRef.current.mode === 'source-protected' && documentRef.current.kind !== 'pdf') setSourceView(true)
  }

  function closeFind() {
    setFindOpen(false)
    adapter.current?.find('')
    if (documentRef.current.kind === 'pdf') void pdfView.current?.find('', findOptionsRef.current)
    // A text or source file being read returns from its source to the reading page.
    else if (documentRef.current.kind !== 'markdown' && documentRef.current.reading) setSourceView(false)
    setFindCount({ current: 0, total: 0 })
    adapter.current?.focus()
  }

  function revealSourceMatch() {
    const element = sourceEditor.current
    const match = sourceFind.current.matches[sourceFind.current.index]
    if (!element || !match) return
    element.setSelectionRange(match.from, match.to)
    element.reveal(match.from, 2)
  }

  function reapplyFind(instance: EditorInstance) {
    const count = instance.find(findRef.current.open ? findRef.current.query : '', findOptionsRef.current)
    if (adapter.current === instance) setFindCount(count)
  }

  /** A pathological pattern on a huge document would freeze the window, so large sources search literally. */
  function sourceFindOptions(text: string): FindOptions {
    const options = findOptionsRef.current
    if (!options.regex) return options
    return exceedsVisualLimit(text) ? { ...options, regex: false } : options
  }

  const pdfFindSequence = useRef(0)
  function runFind(query: string) {
    if (documentRef.current.kind === 'pdf') {
      // The text of a PDF is read page by page, so the count arrives a little later.
      const sequence = ++pdfFindSequence.current
      setFindRegexBlocked(false)
      void pdfView.current?.find(query, findOptionsRef.current).then((count) => { if (sequence === pdfFindSequence.current) setFindCount(count) }, () => undefined)
      return
    }
    if (documentRef.current.mode === 'visual') { setFindRegexBlocked(false); setFindCount(adapter.current?.find(query, findOptionsRef.current) ?? { current: 0, total: 0 }); return }
    const text = sourceEditor.current?.value ?? documentRef.current.sourceText
    setFindRegexBlocked(exceedsVisualLimit(text))
    sourceFind.current = { matches: findInText(text, query, sourceFindOptions(text)), index: 0 }
    setFindCount({ current: 0, total: sourceFind.current.matches.length })
    revealSourceMatch()
  }

  /** The user can type in the source editor while the find bar is open, so stored offsets go stale. */
  function refreshSourceMatches() {
    const text = sourceEditor.current?.value ?? documentRef.current.sourceText
    const matches = findInText(text, findQuery, sourceFindOptions(text))
    sourceFind.current = { matches, index: Math.min(sourceFind.current.index, Math.max(0, matches.length - 1)) }
  }

  function findStep(direction: 1 | -1) {
    if (documentRef.current.kind === 'pdf') { setFindCount(pdfView.current?.findStep(direction) ?? { current: 0, total: 0 }); return }
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.findStep(direction) ?? { current: 0, total: 0 }); return }
    refreshSourceMatches()
    const { matches, index } = sourceFind.current
    if (matches.length === 0) return
    sourceFind.current.index = (index + direction + matches.length) % matches.length
    setFindCount({ current: sourceFind.current.index, total: matches.length })
    revealSourceMatch()
  }

  function setFindOptions(next: FindOptions) {
    findOptionsRef.current = next
    setFindOptionsState(next)
    runFind(findQuery)
  }

  runFindRef.current = runFind
  findStepRef.current = findStep

  function replaceInSource(ranges: FindMatch[]) {
    const element = sourceEditor.current
    if (!element) return
    element.replaceRanges(ranges.map((range) => ({ from: range.from, to: range.to, insert: replacementFor(range, replaceText) })))
    updateSession(editSession(sessionRef.current))
    runFind(findQuery)
  }

  function replaceOne() {
    if (documentRef.current.reading || documentRef.current.kind === 'pdf') { setStatus(errorText('READING_MODE')); return }
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.replaceCurrent(replaceText) ?? { current: 0, total: 0 }); return }
    refreshSourceMatches()
    const match = sourceFind.current.matches[sourceFind.current.index]
    if (match) replaceInSource([match])
  }

  function replaceEvery() {
    if (documentRef.current.reading || documentRef.current.kind === 'pdf') { setStatus(errorText('READING_MODE')); return }
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
    if (document.mode !== 'source-protected' || document.kind !== 'markdown') return
    if (document.deferredVisual) setStatus('正在准备编辑器，大文档需要一些时间…')
    const document_ = flushSourceText()
    if (document_ !== document) { window.setTimeout(() => void switchToVisualRef.current(), 0); return }
    setBusy(true)
    try {
      const visual = await hydrateImages({ token: document.token, assetKey: document.assetKey, name: document.name, markdown: document.sourceText, revision: document.revision, kind: 'markdown', encoding: document.encoding })
      if (visual.mode !== 'visual') {
        setStatus(`仍需源码保护：${describeIssues(visual.prepared.analysis)}`)
        // The stand-in analysis of a quickly opened document gives way to the real one, so this is not retried.
        if (document.deferredVisual) setDocument({ ...documentRef.current, deferredVisual: false, prepared: visual.prepared })
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
      const scroller = document.deferredVisual ? documentScroller() : null
      if (scroller && scroller.scrollHeight > scroller.clientHeight) carriedScroll.current = { id: visual.id, fraction: scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight) }
      updateSession({ ...sessionRef.current, generation: visual.id })
      setDocument({ ...visual, draftId: document.draftId, retiredTokens: document.retiredTokens, originalMarkdown: document.originalMarkdown, sampleId: document.sampleId })
    } finally {
      setBusy(false)
    }
  }

  const switchToVisualRef = useRef(switchToVisual)
  switchToVisualRef.current = switchToVisual

  const persistenceLabel = isPdf ? '只读' : session.persistence === 'saving' ? '保存中' : session.persistence === 'failed' ? '保存失败' : session.persistence === 'conflict' ? '磁盘冲突' : dirty ? '未保存' : document.token ? '已保存' : '未保存到磁盘'

  /** While reading, a click on an image opens it large over a dimmed page. */
  function openImageFromClick(event: { target: EventTarget | null }) {
    if (!documentRef.current.reading) return
    const image = event.target instanceof HTMLImageElement ? event.target : null
    if (!image || !image.closest('.editor-root') || !image.currentSrc) return
    setLightbox({ src: image.currentSrc, alt: image.alt })
  }

  // The optional AI assistant (T70–T73). Its requests leave from Rust; this hook only passes the IPC along.
  const aiTransport = useMemo<AiTransport | null>(() => uiPreview ? previewAiTransport() : desktop ? {
    invoke: (command, args) => invoke(command, args),
    listen: (event, handler) => getCurrentWindow().listen(event, (message) => handler(message.payload as never)),
  } : null, [desktop])
  function aiSelection() {
    const current = documentRef.current
    if (current.mode === 'visual') return adapter.current?.selectionContext() ?? null
    if (current.kind === 'pdf') {
      // The words selected on a PDF page; the text around them is not known, so the selection goes alone.
      const selection = pdfView.current?.selection() ?? null
      return selection ? { selection, before: '', after: '' } : null
    }
    const element = sourceEditor.current
    if (!element || element.selectionStart === element.selectionEnd) return null
    const text = element.value
    return { selection: text.slice(element.selectionStart, element.selectionEnd), before: text.slice(Math.max(0, element.selectionStart - 1500), element.selectionStart), after: text.slice(element.selectionEnd, element.selectionEnd + 1500) }
  }
  function insertAiMarkdown(markdown: string, placement: InsertPlacement) {
    const current = documentRef.current
    if (current.reading || current.kind === 'pdf') throw new Error('READING_MODE')
    if (current.mode === 'visual') {
      if (!adapter.current) throw new Error('EDITOR_NOT_READY')
      adapter.current.insertMarkdown(markdown, placement)
      return
    }
    const element = sourceEditor.current
    if (!element) throw new Error('EDITOR_NOT_READY')
    const [from, to] = [element.selectionStart, element.selectionEnd]
    element.replaceRanges(placement === 'replace' ? [{ from, to, insert: markdown }] : [{ from: to, to, insert: `\n\n${markdown}\n` }])
    if (sessionRef.current.generation === current.id) updateSession(editSession(sessionRef.current))
    element.focus()
  }
  const pdfText = useRef<{ id: number; text: string } | null>(null)
  // What the PDF view needs from Rust. A new object per document keeps a late answer from reaching the next one.
  const pdfBridge = useMemo<PdfBridge | null>(() => {
    if (document.kind !== 'pdf' || !document.token) return null
    const { id, token } = document
    const sample = uiPreview ? previewPdf.current : null
    if (sample) return {
      source: { size: sample.length, read: async (offset, length) => sample.slice(offset, offset + length), readAsset: async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer()) },
      loadPosition: async () => null, savePosition: () => undefined, register: (handle) => { pdfView.current = handle }, onOutline: (items) => setPdfOutlineItems({ id, items }), onPages: (pages) => setPdfPages({ id, pages }), openLink: (href) => setStatus(href), onStatus: setStatus,
    }
    return {
      source: {
        size: document.size ?? 0,
        read: async (offset, length) => { try { return new Uint8Array(await invoke<ArrayBuffer>('read_document_range', { token, offset, length })) } catch (error) { throw new Error(String(error)) } },
        readAsset: async (path) => new Uint8Array(await invoke<ArrayBuffer>('read_app_asset', { path })),
      },
      loadPosition: () => invoke<PdfPosition | null>('get_reading_position', { token }),
      savePosition: (position) => { void invoke('set_reading_position', { token, position }).catch(() => undefined) },
      register: (handle) => { if (handle) pdfView.current = handle; else if (documentRef.current.id === id || documentRef.current.kind !== 'pdf') pdfView.current = null },
      onOutline: (items) => setPdfOutlineItems({ id, items }),
      onPages: (pages) => setPdfPages({ id, pages }),
      openLink: (href) => linkOpenRef.current(href),
      onStatus: setStatus,
    }
  }, [document.id, document.kind, document.token, document.size])

  // The native menu follows the kind of document in front (T88): a PDF has nothing to save or format.
  useEffect(() => {
    if (!desktop) return
    const apply = () => { void invoke('set_menu_state', { kind: documentRef.current.kind }).catch(() => undefined) }
    apply()
    window.addEventListener('focus', apply)
    return () => window.removeEventListener('focus', apply)
  }, [desktop, document.kind])

  const ai = useAiAssistant({
    transport: aiTransport,
    documentId: document.id,
    language: settings.language,
    getDocument: () => {
      const current = documentRef.current
      if (current.kind === 'pdf') return { title: titleOf(current.name), markdown: pdfText.current?.id === current.id ? pdfText.current.text : '' }
      return { title: titleOf(current.name), markdown: current.mode === 'visual' ? adapter.current?.getMarkdown() ?? current.markdown : sourceEditor.current?.value ?? current.sourceText }
    },
    // The text of a PDF is extracted when a question is asked (T88); a scan has none and nothing is sent.
    prepareDocument: async () => {
      const current = documentRef.current
      if (current.kind !== 'pdf' || pdfText.current?.id === current.id) return
      if (!pdfView.current) throw new Error('PDF_NOT_READY')
      setStatus('正在读取 PDF 文字…')
      const extracted = await pdfView.current.text(PDF_TEXT_BUDGET)
      if (extracted.scanned || !extracted.text.trim()) throw new Error('PDF_NO_TEXT')
      if (documentRef.current.id === current.id) pdfText.current = { id: current.id, text: extracted.text }
      setStatus(extracted.truncated ? `已读取 PDF 文字（共 ${extracted.pages} 页，只取了开头的一部分）` : `已读取 PDF 文字（共 ${extracted.pages} 页）`)
    },
    getHeadings: () => currentOutline(),
    getSelection: aiSelection,
    // Answers go through the preview renderer: sanitized, and images are never fetched from the network.
    renderMarkdown: (markdown) => renderPreviewAsync(markdown, undefined, false).then((html) => html, () => null),
    insertMarkdown: insertAiMarkdown,
    saveNote: (name, markdown) => invoke<string | null>('save_note_beside', { token: documentRef.current.token || null, name, markdown }).catch((error: unknown) => { throw new Error(String(error)) }),
    onStatus: setStatus,
  })
  const sourceDark = style.dark
  return { plain, isPdf, tableView, setTableView, pdfBridge, pdfPages: pdfPages?.id === document.id ? pdfPages.pages : null, selectedDirectory, previewPartial, ai, panel, setPanel, systemFonts, loadSystemFonts, pickStyle, toggleDayNight, systemDark, latinLayout, style, sourceDark, reading, setReading, lightbox, setLightbox, openImageFromClick, findOptions, findRegexBlocked, setFindOptions, scheduleDerivedRefresh, wordCounts, openSearchHit, runWorkspaceSearch, searchQuery, searchState, setSearchQuery, goToOutlineItem, outlineItems, notice, setNotice, activeConflict, showDiskDiff, useDiskVersion, saveConflictCopyAs, refreshDrafts, diskDiff, setDiskDiff, findOpen, findQuery, setFindQuery, replaceText, setReplaceText, findCount, runFind, findStep, replaceOne, replaceEvery, closeFind, tablePicker, setTablePicker, activeTabKey, adapter, applyLink, busy, checkRoundTrip, chooseWorkspace, closeTabs, closeWorkspace, createEntry, desktop, detachTab, discardDraft, document, draftPreview, drafts, draftsOpen, editorHost, exportPage, exportSnapshotMD, flushSourceText, imageAltOpen, imageAltText, imageInput, imageInputAction, linkHref, linkOpen, loadChildren, newDocument, newEntryName, newEntryType, onPreviewClick, openDocument, openTablePickerFromToolbar, openWorkspaceEntry, persistenceLabel, preview, previewDraft, previewHtml, previewPending, previewRoot, recoverDraft, renameEntry, renameName, renaming, reorderTabs, saveDocument, selectSample, selectedEntry, session, sessionRef, setDraftsOpen, setImageAltOpen, setImageAltText, setLinkHref, setLinkOpen, setNewEntryName, setNewEntryType, setRenameName, setRenaming, setSelectedDirectory, setSelectedEntry, setSettings, setSettingsOpen, setSettingsTab, setSourceView, setStatus, setTabMenu, settings, settingsOpen, settingsTab, sidebarOpen, sidebarRoot, sourceEditor, sourceView: sourceShown, status, switchTab, switchToSource, switchToVisual, t, tabDragRef, tabMenu, tabs, toggleDirectory, toolbar, trashEntry, tree, updateSession, workspaces }
}

export type DocumentWorkspace = ReturnType<typeof useDocumentWorkspace>
