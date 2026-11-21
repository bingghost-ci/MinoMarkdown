import { customColorsKey } from '../features/diagrams/colorKey'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { compareMarkdown, describeIssues, exceedsVisualLimit, protectedFragments } from '../core/markdown/compatibility'
import { opensForQuickReading, previewHead, quickReadAnalysis } from '../features/document/largeDocument'
import { countWordsAsync, htmlImageFilesInAsync, hydrateMarkdownAsync, imageUrlsInAsync, mermaidSourcesAsync, prepareMarkdownAsync, rewriteImageUrlsAsync, renderCodePreviewAsync, renderExportAsync, renderPreviewAsync, renderTextPreviewAsync } from '../core/markdown/analysisClient'
import { delimiterOf, extensionOf, isTextKind, kindOfName, titleOf, type DocumentKind } from '../features/document/kinds'
import { textHead, textOutline } from '../features/text/textDocument'
import type { PdfBridge, PdfHandle, PdfPosition } from '../features/pdf/PdfView'
import { blockPosition, restoreBlockPosition } from '../features/text/readingPosition'
import { mayContainMermaid } from '../core/markdown/diagrams'
import { composeVisualMarkdown, prepareMarkdown, type PreparedMarkdown } from '../core/markdown/codec'
import type { EditorAdapter as EditorInstance, PendingAsset, ToolbarState } from '../features/editor/EditorAdapter'
import { EditorPool } from '../features/editor/editorPool'
import { isExternalHref, safeLinkHref } from '../features/editor/linkSafety'
import { isAssetUrl, relativeFromAssetUrl } from '../features/editor/assetUrl'
import { beginSave, clearExternalConflict, createSession, discardChanges, editSession, externalConflict, isDirty, saveCanceled, saveFailed, saveSucceeded, withGeneration, type DocumentSession } from '../features/document/session'
import { mayLeaveDocument, type UnsavedAction } from '../features/document/lifecycle'
import { createDraftScheduler, type DraftScheduler } from '../features/document/draftScheduler'
import { autosaveDecision } from '../features/document/autosave'
import { lineDiff, type DiffLine } from '../features/document/lineDiff'
import { defaultFindOptions, findInText, replacementFor, type FindMatch, type FindOptions } from '../features/editor/findText'
import { outlineFromSource, type OutlineItem } from '../features/outline/outline'
import { localAssetPath, snapshotResources } from '../features/export/snapshot'
import { translate, translateStatus, translateWith, type Language } from './i18n'
import { activeStyle, defaultReadingSettings, documentTypography, layoutScript, lineHeights, opensInReadingMode, pickedStyle, toggledDayNight, type ReadingSettings } from './readingSettings'
import { dominantScript } from '../features/reading/script'
import { createWordCounter, sameOutline } from '../features/document/derived'
import { useStableFunctions } from './stable'
import { whenStyled } from './whenStyled'
import { migrateStyleId, type ReadingStyle } from '../features/reading/styles'
import { previewAiTransport, previewSampleSource } from './previewSample'
import { useAiAssistant, type InsertPlacement } from './aiAssistant'
import type { AiTransport } from '../features/ai/client'
import { isZoomAction, zoomedFontSize } from './textZoom'
import { resetPinchZoom } from './pinchZoom'
import type { Lightbox } from './components/ZoomViewer'
import { formatMenuCommands, transformMenuActions } from './formatActions'
import type { SourceEditor } from '../features/source/SourceEditor'
import { settingsPatch } from './settingsSync'
import { followSavedSettings, paintWindow, saveSettingsLater, tauriAiTransport, useSystemDark, writeTypography } from './settingsEffects'
import { untilCleanup } from './subscription'
import { bodyMenu, entryMenu, tabMenu as tabMenuItems, type BodyView, type MenuEntry } from './contextMenu'
import type { AiSelectionAction } from '../features/ai/prompts'
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
/** `markdown` comes back only when saving changed the text (pasted images now point at their files); otherwise it is the text that was sent (T100). */
type SaveResult = Omit<OpenResult, 'markdown'> & { markdown?: string; assetPaths: Record<string, string>; assetRelocations: Record<string, string> }
/** Where a file just opened is already shown (`claim_document`): nowhere else, in a tab here, or in another window. */
type Claim = { where: 'claimed' } | { where: 'here'; token: string } | { where: 'elsewhere' }
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
export const defaultSettings: Settings = { ...defaultReadingSettings, schemaVersion: 1, sidebarWidth: 230, outlineWidth: 240, aiWidth: 400, windowWidth: 1100, windowHeight: 760, showFileToolbar: false, showSidebar: true, showOutline: false, autoSave: false, autoSaveSeconds: 30, restoreSession: false, editorWidth: 'centered', language: 'zh-CN' }
export type SettingsTab = 'appearance' | 'code' | 'diagrams' | 'typography' | 'reading' | 'workspace' | 'ai'
/**
 * What the settings pages need from their host: the workspace when they are shown as a dialog over a document, or
 * `useSettingsWindow` when they fill the settings window (T113).
 */
export type SettingsHost = Pick<DocumentWorkspace, 'loadSystemFonts' | 'pickStyle' | 'settings' | 'settingsOpen' | 'settingsTab' | 'setSettingsOpen' | 'setSettingsTab' | 'style' | 'systemFonts' | 't' | 'updateSettings'> & {
  ai: Pick<DocumentWorkspace['ai'], 'available' | 'clearKey' | 'config' | 'fetchModels' | 'fetchedModels' | 'modelsBusy' | 'modelsError' | 'pickModel' | 'saveConfig' | 'setEnabled' | 'setKey'>
}
export type FloatingPanel = 'appearance' | null
type TabItem = { key: string; document: DocumentState; session: DocumentSession }
type DetachedAsset = { url: string; staged: string; mime: string }
type DetachedTransfer = { name: string; kind?: DocumentKind; encoding?: string; size?: number; token: string; assetKey: string; retiredTokens: string[]; revision: string; markdown: string; originalMarkdown: string; sourceText: string; mode: DocumentState['mode']; draftId: string; session: DocumentSession; assets: DetachedAsset[]; imageUrls: [string, string][] }
/** What a right-click menu was opened on (T105); its chosen item acts on this. */
type ContextTarget =
  | { area: 'body'; tabKey: string; view: BodyView; link: string | null; text: string }
  | { area: 'tab'; tabKey: string }
  | { area: 'entry'; entry: WorkspaceEntry & { parentToken: string } }
  | { area: 'root'; token: string }
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

/** The name of a document that has no file yet, in the language of the interface. */
function untitledName(language: string): string { return language === 'en-US' ? 'Untitled' : '未命名' }

function makeDocument(markdown: string, name = '未命名', sampleId?: string, prepared = prepareMarkdown(markdown)): DocumentState {
  return { id: nextDocumentId++, draftId: crypto.randomUUID(), name, kind: 'markdown', token: '', assetKey: '', revision: '', markdown: prepared.editorMarkdown, originalMarkdown: markdown, imageUrls: new Map(), recoveredAssets: new Map(), pendingFiles: new Map(), retiredTokens: [], sampleId, prepared, sourceText: markdown, mode: prepared.analysis.mode }
}

/** The bare error code a command failed with: Rust sends a string, the editor throws an Error. */
function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function errorText(error: unknown): string {
  const code = errorCode(error)
  const messages: Record<string, string> = {
    CONFLICT: '磁盘文件已被其他程序修改，请先保留当前内容并重新打开检查。',
    READING_MODE: '阅读模式下不能修改文档，按 ⌘⇧R 开始编辑。',
    COMMIT_UNCERTAIN: '文件可能已写入，但原目录在操作期间发生变化。请先到磁盘确认文件位置，再决定是否重试。',
    TARGET_EXISTS: '目标文件已存在，请选择其他文件名。',
    INVALID_TARGET: '不能把文件夹移到它自己或它里面的文件夹中。',
    CROSS_DEVICE: '不能在不同的磁盘之间移动，请在 Finder 中拷贝。',
    INVALID_ENCODING: '无法识别这个文件的文字编码，没有打开，原文件未改动。',
    UNSUPPORTED_FORMAT: '文件内容不是它的扩展名所表示的格式（可能是二进制文件），没有打开。',
    UNSUPPORTED_FILE_TYPE: '不支持这种文件类型。可以打开 Markdown、纯文本、常见代码与配置文件和 PDF。',
    UNENCODABLE: '内容里有原编码无法表示的字符，文件没有写入。',
    READ_ONLY: 'PDF 只能阅读，不能保存或导出。',
    CHANGED: '磁盘上的文件已经变化，正在重新载入。',
    STALE_OPERATION: '文件在操作期间被移动或改名，请稍后重试。',
    DOCUMENT_TOO_LARGE: '文件超过大小上限（PDF 200 MiB，其他 20 MiB），未截断或修改原文件。请在 Finder 中选择其他应用打开。',
    IMAGE_TOO_LARGE: '图片超过当前 20 MB 限制。',
    ASSET_WRITE_FAILED: '图片附件写入失败，正文没有保存。',
    ASSET_NOT_FOUND: '被引用的本地图片不存在，正文没有写入。',
    INVALID_IMAGE: '图片内容无法解码或格式与类型不匹配。',
    INVALID_ASSET: '图片引用与附件不一致，正文没有写入。',
    INVALID_NAME: '名称为空、包含路径字符，或扩展名不受支持。',
    TRASH_FAILED: '系统废纸篓操作失败，原文件仍保留。',
    SNAPSHOT_TOO_LARGE: '当前导出快照超过大小限制。',
    OUT_OF_SCOPE: '文件或图片路径超出本次打开的范围。',
    EXPORT_TOO_LARGE: '导出文件超过当前 100 MB 限制。',
    EXPORT_FAILED: '没能生成 PDF，当前文档未改变。请重试；如果仍然失败，可以先导出 HTML。',
    EXPORT_TIMEOUT: '生成 PDF 超时，当前文档未改变。',
    WRITE_BLOCKED: 'macOS 没有允许写入所选文件夹。请看看是否有隐私授权提示，或在“系统设置 › 隐私与安全性 › 文件与文件夹”里允许 Mino，也可以换一个文件夹。',
    PERMISSION_DENIED: '没有写入这个位置的权限，请换一个文件夹。',
    EXPORT_RESOURCE_MISSING: '图片附件缺失或包含远程图片，无法生成完整资源包。可选择“仅正文 MD”。',
    SNAPSHOT_BUDGET: '同时进行的导出作业过多，请稍后重试。',
    NOT_FOUND: '原文件或文件夹已经不在原位置，请重新选择文件或文件夹。',
    OPEN_ELSEWHERE: '其中有文件正在另一个窗口中打开，请先在那个窗口关闭它。',
    FILE_OPEN_ELSEWHERE: '所选文件正在一个标签页中打开，不能覆盖。请换一个名字，或先关闭那个标签页。',
    DRAFT_IN_USE: '这份草稿正由另一个窗口里的文档使用。',
    STAGING_BUDGET: '同时处理的图片过多，请稍后重试。',
  }
  return messages[code] ?? `操作失败：${code}`
}

/** `t` is called while rendering and its result depends on the language. */
const STABLE_EXCEPT = ['t'] as const
const FIND_INPUT_DELAY_MS = 120
/** Matches listed in the source editor, as in a PDF: a pattern that matches every character would otherwise hold millions of them (T94). */
const SOURCE_MATCH_LIMIT = 5000

/** Frees the object URLs a document held for its images. */
function revokeDocumentUrls(closed: DocumentState): void {
  for (const urls of [closed.imageUrls, closed.recoveredAssets, closed.pendingFiles]) for (const url of urls.keys()) URL.revokeObjectURL(url)
}

/** Resolves at the next animation frame. */
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())) }

/** What the find bar counts before a search and when nothing matches. */
const NO_MATCHES: { current: number; total: number } = { current: 0, total: 0 }

/** The text of a document that a draft is written from. */
function draftText(note: DocumentState): string {
  return note.mode === 'visual' ? note.markdown : note.sourceText
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
  const { prepared, markdown, imageUrls, failed } = await hydrateMarkdownAsync(opened.markdown, opened.assetKey)
  return { ...opened, id: nextDocumentId++, draftId: crypto.randomUUID(), markdown, originalMarkdown: opened.markdown, imageUrls, recoveredAssets: new Map(), pendingFiles: new Map(), retiredTokens: [], prepared, sourceText: opened.markdown, mode: failed ? 'source-protected' : prepared.analysis.mode }
}

export function useDocumentWorkspace() {
  const editorHost = useRef<HTMLDivElement>(null)
  const editorPool = useRef<EditorPool<EditorInstance> | null>(null)
  const previewRoot = useRef<HTMLDivElement>(null)
  const sourceEditor = useRef<SourceEditor | null>(null)
  const forceSourceView = useRef(false)
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
  const contextTarget = useRef<ContextTarget | null>(null)
  const [documentRename, setDocumentRename] = useState<{ tabKey: string; name: string } | null>(null)
  const tabDragRef = useRef<{ key: string; x: number; y: number } | null>(null)
  const closingTabsRef = useRef(false)
  const closingWindowRef = useRef(false)
  const [lightbox, setLightbox] = useState<Lightbox | null>(null)
  const previewSettingsTab = uiPreview ? new URLSearchParams(window.location.search).get('ui-settings-tab') as SettingsTab | null : null
  const [settingsOpen, setSettingsOpen] = useState(previewSettingsTab !== null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(previewSettingsTab ?? 'appearance')
  /**
   * Settings live in a window of their own (T113), so they can sit beside the document or on another display. The
   * dialog over the document remains for the browser preview, and for when the window cannot be made.
   */
  function openSettings(tab?: SettingsTab) {
    if (tab) setSettingsTab(tab)
    if (!isTauri()) { setSettingsOpen(true); return }
    void invoke('open_settings_window', { tab: tab ?? null }).catch(() => setSettingsOpen(true))
  }
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
  const [findCount, setFindCount] = useState(NO_MATCHES)
  const sourceFind = useRef<{ matches: FindMatch[]; index: number }>({ matches: [], index: 0 })
  const [findOptions, setFindOptionsState] = useState<FindOptions>(defaultFindOptions)
  const findOptionsRef = useRef<FindOptions>(defaultFindOptions)
  const [findRegexBlocked, setFindRegexBlocked] = useState(false)
  /** The source editor found more matches than it lists (T94). */
  const [findCapped, setFindCapped] = useState(false)
  const queuedFind = useRef<{ timer: number; query: string | null }>({ timer: 0, query: null })
  const findRef = useRef({ open: findOpen, query: findQuery })
  findRef.current = { open: findOpen, query: findQuery }
  const runFindRef = useRef<(query: string) => void>(() => undefined)
  const findGoToRef = useRef<(index: number) => void>(() => undefined)
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [draftPreview, setDraftPreview] = useState<DraftContent | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [toolbar, setToolbar] = useState<ToolbarState>({ ready: false, composing: false, block: 'paragraph', marks: [], canUndo: false, canRedo: false, inTable: false, inList: false, linkHref: null, imageAlt: null })
  const [linkOpen, setLinkOpen] = useState(false)
  const [sourceView, setSourceView] = useState(false)
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([])
  const [wordCounts, setWordCounts] = useState<{ total: number; selected: number | null }>({ total: 0, selected: null })
  const wordCountSequence = useRef(0)
  const wordCounter = useRef(createWordCounter(countWordsAsync))
  /** The text of each document's last stored draft, so leaving a tab that has not changed since does not write it again (T93). */
  const draftedText = useRef(new Map<string, { text: string; name: string; diskRevision: string | null }>())
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
  /** Changes some settings and leaves the rest: the fields themselves, or a function of the current settings that gives them. */
  function updateSettings(patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) {
    setSettings((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))
  }
  // Its identity follows the language, so a `memo` component that shows text renders again when the language changes.
  const t = useCallback((value: string) => translate(value, settings.language), [settings.language])
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const systemDark = useSystemDark()
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
  /** Documents whose visual editor has passed `fragmentsSurvived`. */
  const verifiedEditors = useRef(new Set<number>())
  const desktop = isTauri()
  // `busyRef` alone is the lock (`takeBusy`, `releaseBusy`); `busy` only redraws what depends on it. Copying the state
  // into the ref on render would let a render that ran before `setBusy(true)` applied drop a lock still held.
  const composingRef = useRef(false)
  composingRef.current = toolbar.composing
  /** Whether either editor is in the middle of an input method composition; nothing half-typed is saved or drafted. */
  function composingNow(): boolean { return composingRef.current || Boolean(sourceEditor.current?.composing) }
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
  // Measuring a text near the limit encodes all of it, which must not happen on every render (T93).
  const overVisualLimit = useMemo(() => exceedsVisualLimit(document.sourceText), [document.sourceText])
  const wantsPreview = document.mode === 'source-protected' && !isPdf && !sourceShown && (document.kind === 'text' || !overVisualLimit)
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
    if (settingsRef.current.showOutline) { const next = currentOutline(); setOutlineItems((old) => sameOutline(old, next) ? old : next) }
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
    const counted = await wordCounter.current(text, selected)
    if (sequence !== wordCountSequence.current) return
    setWordCounts((old) => old.total === counted.total && old.selected === counted.selected ? old : counted)
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
  /** Save As for the document in front, read through a ref by flows that await between tabs. */
  const saveDocumentAsRef = useRef<() => Promise<boolean>>(async () => false)
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

  /**
   * The editor of `note`, or null. Right after a tab switch `documentRef` already names the new document while
   * `adapter` still holds the previous one's editor until the effects run, so the two must be matched by id.
   */
  function liveEditorFor(note: DocumentState): EditorInstance | null {
    return note.mode === 'visual' && adapterDocumentId.current === note.id ? adapter.current : null
  }

  function captureCurrentTab(): TabItem {
    flushSourceText()
    const current = tabsRef.current.find((tab) => tab.key === activeTabKeyRef.current)!
    const activeDocument = documentRef.current
    const live = liveEditorFor(activeDocument)
    let markdown = activeDocument.markdown
    if (live?.isReady()) {
      // The editor keeps its Markdown until the document changes, so an untouched tab costs nothing here.
      try { markdown = live.getMarkdown() } catch { /* Keep the last complete snapshot. */ }
    }
    const captured = { ...current, document: { ...activeDocument, markdown, pendingFiles: live?.pendingFiles() ?? activeDocument.pendingFiles }, session: sessionRef.current }
    updateTabs(tabsRef.current.map((tab) => tab.key === captured.key ? captured : tab))
    const drafted = draftedText.current.get(activeDocument.draftId)
    if (desktop && isDirty(captured.session) && !(drafted && drafted.text === draftText(captured.document) && drafted.name === activeDocument.name && drafted.diskRevision === captured.session.diskRevision)) void persistTabDraft(captured, live)
    return captured
  }

  function activateTab(tab: TabItem) {
    activeTabKeyRef.current = tab.key
    setActiveTabKey(tab.key)
    updateSession(tab.session)
    documentRef.current = tab.document
    setDocument(tab.document)
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

  /** Remembers how far down the page the reader is, as a fraction, for the view of document `id` that replaces this one. */
  function carryScroll(id: number, scroller: HTMLElement | null) {
    if (scroller && scroller.scrollHeight > scroller.clientHeight) carriedScroll.current = { id, fraction: scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight) }
  }
  function noteBusy() { setStatus('当前操作尚未完成，请稍后再试') }
  /** Busy is checked through the ref, which changes at once; the state only redraws what depends on it. */
  function takeBusy() { busyRef.current = true; setBusy(true) }
  function releaseBusy() { busyRef.current = false; setBusy(false) }

  function switchTab(key: string) {
    if (key === activeTabKeyRef.current) return
    // While tabs or the window close, the tab being closed stays in front until it is done (see `focusTabForSave`).
    if (busyRef.current || closingTabsRef.current || closingWindowRef.current) { noteBusy(); return }
    captureCurrentTab()
    const target = tabsRef.current.find((tab) => tab.key === key)
    if (target) activateTab(target)
  }

  function openTab(opened: DocumentState, nextSession = createSession(opened.id)) {
    // Files opened from disk start in reading mode; new, draft-restored and unsaved documents open for editing.
    const nextDocument = opened.kind === 'pdf' ? { ...opened, reading: true } : opened.reading !== undefined ? opened : { ...opened, reading: opensInReadingMode(settingsRef.current.openInReadingMode, Boolean(opened.token), isDirty(nextSession)) }
    const onlyWelcome = onlyUntouchedBlank()
    if (!onlyWelcome) captureCurrentTab()
    const tab = { key: crypto.randomUUID(), document: nextDocument, session: nextSession }
    updateTabs(onlyWelcome ? [tab] : [...tabsRef.current, tab])
    activateTab(tab)
  }

  /** Makes `key` the active tab and waits until its content can really be saved. */
  async function focusTabForSave(key: string): Promise<boolean> {
    if (key !== activeTabKeyRef.current) {
      if (busyRef.current) { noteBusy(); return false }
      captureCurrentTab()
      const target = tabsRef.current.find((tab) => tab.key === key)
      if (target) activateTab(target)
      if (activeTabKeyRef.current !== key) { noteBusy(); return false }
    }
    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      await nextFrame()
      // Something else came to the front meanwhile, such as a file opened from Finder: what is ready now is not
      // this tab, so nothing may be saved, asked about or closed in its name.
      if (activeTabKeyRef.current !== key) { setStatus('标签页已切换，操作已取消，内容没有改变'); return false }
      const active = documentRef.current
      if (active.mode !== 'visual' || (adapterDocumentId.current === active.id && adapter.current?.isReady())) return true
    }
    setStatus('编辑器尚未就绪，操作已取消，内容没有改变')
    return false
  }

  /** Whether the window holds nothing but the empty document it started with, which the first file opened takes the place of. */
  function onlyUntouchedBlank(): boolean {
    const active = documentRef.current
    return tabsRef.current.length === 1 && active.id === initialDocumentId.current && !active.token && active.markdown === '' && !isDirty(sessionRef.current)
  }

  /** Shows a file Rust has just opened in a new tab and notes it among the recent files. The caller releases the file's token if this fails. */
  async function showOpened(opened: OpenResult, entryToken?: string): Promise<void> {
    // A file is open in one tab of one window only: a file a tab already shows comes to the front there, with its
    // edits, rather than in a second tab whose saves would race the first.
    const claim = await claimDocument(opened.token)
    if (claim.where !== 'claimed') {
      await releaseCandidate(opened.token)
      if (claim.where === 'here') showTabOf(claim.token)
      setStatus(claim.where === 'here' ? `${opened.name} 已经打开` : `${opened.name} 已在另一个窗口打开`)
      return
    }
    const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
    openTab(entryToken ? { ...hydrated, entryToken } : hydrated, createSession(hydrated.id, hydrated.revision))
    void rememberDocument(opened.token).catch(() => undefined)
  }

  /** Asks Rust who shows the file behind `token`; when no one does, this window's new tab now holds it. */
  async function claimDocument(token: string): Promise<Claim> {
    return desktop ? await invoke<Claim>('claim_document', { token }) : { where: 'claimed' }
  }

  /** Brings the tab that holds document token `token` to the front, if this window has one. The caller holds the lock. */
  function showTabOf(token: string) {
    const match = tabsRef.current.find((tab) => (tab.key === activeTabKeyRef.current ? documentRef.current.token : tab.document.token) === token)
    if (!match || match.key === activeTabKeyRef.current) return
    captureCurrentTab()
    const target = tabsRef.current.find((tab) => tab.key === match.key)
    if (target) activateTab(target)
  }

  // Another window was asked to open a file this one shows: Rust has brought this window to the front, and the
  // tab follows unless something is under way here, such as a save or a tab closing.
  const revealRef = useRef<(token: string) => void>(() => undefined)
  revealRef.current = (token) => {
    if (busyRef.current || closingTabsRef.current || closingWindowRef.current) return
    takeBusy()
    try { showTabOf(token) } finally { releaseBusy() }
  }
  useEffect(() => {
    if (!desktop) return
    return untilCleanup(getCurrentWindow().listen<string>('reveal-document', (event) => revealRef.current(event.payload)))
  }, [desktop])

  /** Takes a tab out of the bar and shows its neighbour, or an empty document when it was the last. */
  function removeTab(key: string, index: number) {
    const remaining = tabsRef.current.filter((tab) => tab.key !== key)
    if (remaining.length) { updateTabs(remaining); activateTab(remaining[Math.min(index, remaining.length - 1)]); return }
    const empty = makeDocument('', untitledName(settingsRef.current.language))
    initialDocumentId.current = empty.id
    const replacement = { key: crypto.randomUUID(), document: empty, session: createSession(empty.id) }
    updateTabs([replacement])
    activateTab(replacement)
  }

  /** Lets go of what is kept for a document that has left this window: its live editor and its remembered positions (T96). */
  function forgetDocument(closed: DocumentState) {
    editorPool.current?.drop(closed.id)
    verifiedEditors.current.delete(closed.id)
    scrollPositions.current.delete(closed.id)
    savedPositions.current.delete(closed.id)
    autosaveStopped.current.delete(closed.id)
    draftUploads.current.delete(closed.draftId)
    draftedText.current.delete(closed.draftId)
    ai.forget(closed.draftId)
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
        forgetDocument(tab.document)
        await draftWriteChain.current.catch(() => undefined)
        for (const retired of [tab.document.token, ...tab.document.retiredTokens]) await releaseCandidate(retired)
        revokeDocumentUrls(tab.document)
        continue
      }
      if (!await focusTabForSave(key)) return false
      if (!await canProceedRef.current(true)) return false
      await nextFrame()
      const closing = tabsRef.current.find((tab) => tab.key === key)
      if (!closing) continue
      // What is released below is the document in front; it has to be this tab's.
      if (activeTabKeyRef.current !== key) { setStatus('标签页已切换，操作已取消，内容没有改变'); return false }
      const activePendingUrls = Array.from(adapter.current?.pendingFiles().keys() ?? [])
      // The tab's entry can hold an older version of the document in front: switching between source and visual
      // mode gives it a new id, its editor and its images, and the entry is updated only when the tab is left.
      const live = documentRef.current
      const token = live.token || closing.document.token
      const retiredTokens = [...closing.document.retiredTokens, ...live.retiredTokens]
      removeTab(key, index)
      await draftWriteChain.current.catch(() => undefined)
      for (const retired of new Set([token, ...retiredTokens])) await releaseCandidate(retired)
      for (const note of live.id === closing.document.id ? [live] : [live, closing.document]) { revokeDocumentUrls(note); forgetDocument(note) }
      for (const url of activePendingUrls) URL.revokeObjectURL(url)
      setStatus(`已关闭 ${closing.document.name}`)
    }
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
    // Waits until the tab's own editor is in front, so what is captured below is this document's.
    if (!await focusTabForSave(key)) return
    const tab = captureCurrentTab()
    const note = tab.document
    const live = liveEditorFor(note)
    const markdown = draftText(note)
    takeBusy()
    try {
      const assets: DetachedAsset[] = []
      if (note.mode === 'visual') {
        const referenced = new Set(await imageUrlsInAsync(markdown))
        const pending = live?.isReady() ? await live.pendingAssets(false) : await Promise.all(Array.from(note.pendingFiles, async ([url, file]) => ({ url, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })))
        const uploads = pending.filter((asset) => referenced.has(asset.url))
        for (const [url, asset] of note.recoveredAssets) if (referenced.has(url) && !uploads.some((item) => item.url === url)) uploads.push({ url, ...asset })
        assets.push(...await stageAssets(uploads))
      }
      await draftWriteChain.current.catch(() => undefined)
      const transfer: DetachedTransfer = { name: note.name, kind: note.kind, encoding: note.encoding, size: note.size, token: note.token, assetKey: note.assetKey, retiredTokens: note.retiredTokens, imageUrls: Array.from(note.imageUrls), revision: note.revision, markdown, originalMarkdown: note.originalMarkdown, sourceText: note.sourceText, mode: note.mode, draftId: note.draftId, session: tab.session, assets }
      await invoke('create_workspace_window', { transfer })
      removeTab(key, tabsRef.current.findIndex((item) => item.key === key))
      revokeDocumentUrls(note)
      forgetDocument(note)
      setStatus(`已将 ${note.name} 移到新窗口`)
    } catch (error) { setStatus(errorText(error)) }
    finally { releaseBusy() }
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
      next.markdown = await rewriteImageUrlsAsync(transfer.markdown, replacements)
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
      }, document.imageUrls, document.recoveredAssets, document.pendingFiles, setToolbar, (message) => { if (message) setStatus(message) }, setTablePicker, (href) => linkOpenRef.current(href), scheduleDerivedRefresh, () => (documentRef.current.id === document.id ? documentRef.current : document).assetKey))
      adapter.current = instance
      adapterDocumentId.current = document.id
      instance.setReadonly(Boolean(documentRef.current.reading))
      editorPool.current.retain(new Set([documentRef.current.id, ...tabsRef.current.map((tab) => tab.document.id)]))
      const revisionAtStart = sessionRef.current.revision
      /** Checks once per editor, on whichever showing first sees it created, that it keeps raw HTML and footnotes
       * as they are; leaving the tab while it was still being created must not skip the check. */
      const fellBack = () => {
        if (disposed || verifiedEditors.current.has(document.id)) return false
        if (sessionRef.current.revision !== revisionAtStart || fragmentsSurvived(instance)) { verifiedEditors.current.add(document.id); return false }
        // The editor would change raw HTML or footnotes, so this document stays source-only.
        const current = documentRef.current
        const issues = [...current.prepared.analysis.issues, { code: 'ROUNDTRIP_RISK' as const, detail: 'Visual editor changed protected fragments' }]
        const id = nextDocumentId++
        updateSession(withGeneration(sessionRef.current, id))
        setDocument({ ...current, id, mode: 'source-protected', prepared: { ...current.prepared, analysis: { ...current.prepared.analysis, mode: 'source-protected', issues } } })
        return true
      }
      if (!created) {
        void instance.create().then(() => { if (!disposed && !fellBack()) { if (documentRef.current.reading) instance.setReadonly(true); else instance.resume(); restoreScroll(); reapplyFind(instance); setStatus(document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存') } }).catch(() => undefined)
        return
      }
      void instance.create().then(() => {
        reapplyFind(instance)
        if (fellBack()) return
        if (!disposed) {
          setStatus(documentRef.current.reading ? `已打开 ${document.name} · 阅读模式，按 ⌘⇧R 开始编辑` : document.token ? `已打开 ${document.name}` : '编辑器已就绪 · 新文档尚未保存')
          restoreScroll()
          if (!document.token && !documentRef.current.reading) instance.focus()
        }
      }).catch((error: unknown) => {
        if (!disposed) setStatus(`编辑器启动失败：${errorCode(error)}`)
      })
    }).catch((error: unknown) => {
      if (!disposed) setStatus(`编辑器启动失败：${errorCode(error)}`)
    })
    return () => {
      disposed = true
      adapter.current = null
      adapterDocumentId.current = null
    }
  }, [document.id])

  // Synchronous on purpose: it must finish before the user can type into an editor that would rewrite these fragments.
  function fragmentsSurvived(instance: EditorInstance): boolean {
    const expected = documentRef.current.prepared.analysis.fragments ?? []
    if (expected.length === 0) return true
    try { return JSON.stringify(protectedFragments(instance.getMarkdown())) === JSON.stringify(expected) }
    catch { return false }
  }

  useEffect(() => () => { editorPool.current?.destroyAll(); editorPool.current = null }, [])

  const style = activeStyle(settings, systemDark)
  useEffect(() => {
    const root = window.document.documentElement
    root.dataset.theme = style.id
    root.dataset.diagram = settings.diagramStyle
    root.dataset.diagramLine = settings.diagramLine
    root.dataset.diagramCurve = settings.diagramCurve
    root.dataset.diagramFill = settings.diagramFill ?? 'auto'
    root.dataset.diagramColors = settings.diagramColors ?? 'auto'
    root.dataset.diagramFont = settings.diagramFont ?? 'auto'
    root.dataset.diagramCustom = customColorsKey(settings.diagramCustomColors ?? {})
    // Diagrams take their colors from the style and their drawing from the diagram settings; Mermaid only loads when one is on screen.
    if (window.document.querySelector('.mermaid-preview')) void import('../features/diagrams/mermaid').then((module) => module.restyleDiagrams(window.document))
  }, [style.id, settings.diagramStyle, settings.diagramLine, settings.diagramCurve, settings.diagramFill, settings.diagramColors, settings.diagramFont, settings.diagramCustomColors])

  // The window takes the style's light or dark appearance rather than the system's, so the traffic lights, native
  // menus, dialogs and the color shown while the window is resized match the page.
  useEffect(() => {
    if (!desktop) return
    paintWindow(style.dark, style.desk)
  }, [desktop, style.id])

  // There is no system title bar (titleBarStyle Overlay): the traffic lights sit on the app's top row, which leaves
  // room for them. In full screen macOS hides them, and the room goes away.
  useEffect(() => {
    if (!desktop) return
    const root = window.document.documentElement
    const current = getCurrentWindow()
    let alive = true
    let stop: (() => void) | undefined
    const update = () => void current.isFullscreen().then((full) => { if (alive) root.classList.toggle('window-overlay', !full) }).catch(() => undefined)
    root.classList.add('window-overlay')
    update()
    void current.onResized(update).then((off) => { if (alive) stop = off; else off() }).catch(() => undefined)
    return () => { alive = false; stop?.(); root.classList.remove('window-overlay') }
  }, [desktop])

  // Western layout follows the text the document had when it was opened or last saved, so typing never reflows the page.
  const docScript = useMemo(() => dominantScript(document.sourceText), [document.id, document.revision])
  const latinLayout = layoutScript(settings, docScript) === 'latin'
  const typography = documentTypography(settings, style, docScript)
  const typographyKey = JSON.stringify(typography)
  useEffect(() => {
    writeTypography(typography, style)
  }, [typographyKey, style.id])

  /** Font families installed on this Mac, read once when the font panel first needs them (T67). */
  function loadSystemFonts() {
    if (systemFonts !== null) return
    if (!desktop) { setSystemFonts(uiPreview ? (window as { previewFonts?: string[] }).previewFonts ?? ['Avenir Next', 'Baskerville', 'Georgia', 'Helvetica Neue', 'Kaiti SC', 'PingFang SC', 'Songti SC', 'Times New Roman'] : []); return }
    void invoke<string[]>('list_system_fonts').then(setSystemFonts, () => setSystemFonts([]))
  }
  const pickStyle = (picked: ReadingStyle) => updateSettings((current) => ({ ...pickedStyle(picked, current, systemDark) }))
  const toggleDayNight = () => updateSettings((current) => ({ ...toggledDayNight(current, systemDark) }))

  useEffect(() => {
    window.document.documentElement.lang = settings.language
  }, [settings.language])

  // Every untitled tab takes the name of the new language, not only the one in front.
  useEffect(() => {
    const name = untitledName(settings.language)
    const renamed = (note: DocumentState) => !note.token && note.name !== name && ['未命名', 'Untitled'].includes(note.name)
    const current = documentRef.current
    if (renamed(current)) { documentRef.current = { ...current, name }; setDocument(documentRef.current) }
    if (!tabsRef.current.some((tab) => tab.key === activeTabKeyRef.current ? renamed(current) : renamed(tab.document))) return
    updateTabs(tabsRef.current.map((tab) => tab.key === activeTabKeyRef.current ? { ...tab, document: documentRef.current } : renamed(tab.document) ? { ...tab, document: { ...tab.document, name } } : tab))
  }, [settings.language])

  useEffect(() => {
    if (!desktop) return
    return followSavedSettings(settingsRef, persistedSettings, setSettings)
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
    return saveSettingsLater(persistedSettings, patch, 500, (error) => setStatus(errorText(error)))
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
    whenStyled(() => void invoke('show_workspace_window').catch(() => undefined))
  }, [desktop, settingsLoaded])

  useEffect(() => {
    if (!desktop || !settingsLoaded) return
    let timer: number | undefined
    const onResize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => updateSettings({ windowWidth: Math.max(720, Math.min(3000, window.innerWidth)), windowHeight: Math.max(520, Math.min(2000, window.innerHeight)) }), 250)
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
    const stored = fullUpload ? new Set<string>() : draftUploads.current.get(note.draftId) ?? new Set<string>()
    // Without a live editor the image list costs a parse of the whole text, so it is made only when something below reads it (T92).
    const referenced = live ? live.referencedImageUrls() : stored.size || note.recoveredAssets.size || (visual && note.token && note.imageUrls.size) ? new Set(await imageUrlsInAsync(markdown)) : new Set<string>()
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
      .then(() => { draftedText.current.set(savedDocument.draftId, { text: draftText(savedDocument), name: savedDocument.name, diskRevision: savedSession.diskRevision }) })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', message: `草稿保存失败：${errorText(error)}` })
        if (requireSuccess) throw error
      })
    return draftWriteChain.current
  }

  function currentTabSnapshot(): TabItem {
    const current = flushSourceText()
    const live = liveEditorFor(current)
    let markdown = current.markdown
    if (live?.isReady()) markdown = live.getMarkdown()
    return {
      key: activeTabKeyRef.current,
      document: { ...current, markdown, pendingFiles: live?.pendingFiles() ?? current.pendingFiles },
      session: sessionRef.current,
    }
  }

  const draftScheduler = useRef<DraftScheduler | null>(null)
  draftScheduler.current ??= createDraftScheduler(() => draftTimerRef.current(), 1500, 10000)
  const draftTimerRef = useRef<() => void>(() => undefined)
  draftTimerRef.current = () => {
    if (!isDirty(sessionRef.current)) return
    if (composingNow()) { draftScheduler.current?.schedule(); return }
    if (documentRef.current.mode === 'visual' && !liveEditorFor(documentRef.current)?.isReady()) { draftScheduler.current?.schedule(); return }
    void persistTabDraft(currentTabSnapshot(), liveEditorFor(documentRef.current))
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
      busy: busyRef.current, composing: composingNow(), ready: current.mode !== 'visual' || Boolean(adapter.current?.isReady()),
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
    draftedText.current.delete(draftId)
    await invoke('discard_draft', { draftId })
    draftUploads.current.delete(draftId)
    setDrafts((current) => current.filter((item) => item.draftId !== draftId))
  }

  async function recoverDraft(draftId: string): Promise<void> {
    if (busyRef.current) { noteBusy(); return }
    // A draft belongs to one tab. The tab that writes it already holds its text, so it comes to the front instead
    // of a second tab writing the same draft; Rust refuses one another window holds (`DRAFT_IN_USE`).
    const owner = tabsRef.current.find((tab) => (tab.key === activeTabKeyRef.current ? documentRef.current : tab.document).draftId === draftId)
    if (owner) { switchTab(owner.key); setDraftsOpen(false); return }
    takeBusy()
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
      for (const url of await imageUrlsInAsync(recovered.markdown)) {
        const relative = relativeFromAssetUrl(url)
        if (isAssetUrl(url) && relative && !replacements.has(url) && !sourceAssets.has(url)) replacements.set(url, relative)
      }
      if (next.mode === 'visual') {
        try {
          next.markdown = await rewriteImageUrlsAsync(next.markdown, replacements)
          next.sourceText = await rewriteImageUrlsAsync(next.sourceText, replacements)
        } catch (error) {
          for (const url of sourceAssets.keys()) URL.revokeObjectURL(url)
          throw error
        }
      }
      next.recoveredAssets = sourceAssets
      openTab(next, editSession(createSession(next.id)))
      setDraftsOpen(false)
      setDraftPreview(null)
      const lost = recovered.assetCount - recovered.assets.length
      setStatus(`${recovered.targetStatus === 'changed' ? '已恢复草稿；原文件已有新版本，保存时请选择新文件名' : '已恢复草稿；请检查内容后保存'}${lost > 0 ? `；${lost} 张图片已损坏，未能恢复` : ''}`)
    } catch (error) { setStatus(errorText(error)) }
    finally { releaseBusy() }
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
      if (inFlight || busyRef.current || composingNow() || sessionRef.current.generation !== document.id || sessionRef.current.persistence === 'saving') return
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
          await reloadFromDisk(() => active)
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
  /** `stillWanted` is asked after each wait: the poll that started this may have been stopped meanwhile. */
  async function reloadFromDisk(stillWanted: () => boolean = () => true): Promise<void> {
    const documentId = documentRef.current.id
    const token = documentRef.current.token
    const wasDirty = isDirty(sessionRef.current)
    const lockedEditor = liveEditorFor(documentRef.current)?.rootElement ?? null
    const lockedSource = sourceEditor.current
    takeBusy()
    lockedEditor?.setAttribute('inert', '')
    if (lockedSource) lockedSource.readOnly = true
    try {
      if (wasDirty) await persistTabDraft(currentTabSnapshot(), liveEditorFor(documentRef.current), true)
      if (!stillWanted() || documentRef.current.id !== documentId) return
      const opened = await invoke<OpenResult>('reload_document', { token })
      const next = await hydrateImages(opened, Boolean(documentRef.current.reading))
      if (!stillWanted() || documentRef.current.id !== documentId) return
      const previous = documentRef.current
      next.retiredTokens = previous.retiredTokens
      next.entryToken = previous.entryToken
      // The reader stays in the mode and at the place they were; a PDF is always read.
      next.reading = next.kind === 'pdf' ? true : previous.reading
      carryScroll(next.id, documentScroller())
      updateSession(createSession(next.id, next.revision))
      documentRef.current = next
      setDocument(next)
      updateTabs(tabsRef.current.map((tab) => tab.key === activeTabKeyRef.current ? { ...tab, document: next, session: sessionRef.current } : tab))
      revokeDocumentUrls(previous)
      // The old editor goes now; the effect for the new document makes the next one.
      if (adapterDocumentId.current === previous.id) { adapter.current = null; adapterDocumentId.current = null }
      forgetDocument(previous)
      setDiskConflict(null)
      setStatus(wasDirty ? '已加载磁盘最新版本；未保存修改已留在恢复草稿中' : '已加载磁盘最新版本')
    } finally {
      lockedEditor?.removeAttribute('inert')
      if (lockedSource) lockedSource.readOnly = documentRef.current.kind !== 'markdown' && Boolean(documentRef.current.reading)
      releaseBusy()
    }
  }

  /** The text the user sees now, or null while the visual editor that holds it is not ready (still loading, or an
   * input method is composing): falling back to the text as opened would pass it off as the user's edits. */
  function currentDocumentText(): string | null {
    const current = flushSourceText()
    if (current.mode !== 'visual') return current.sourceText
    const instance = adapter.current
    if (!instance?.isReady() || adapterDocumentId.current !== current.id || composingNow()) return null
    return composeVisualMarkdown(current.prepared.analysis, instance.getPersistableMarkdown())
  }

  async function showDiskDiff(): Promise<void> {
    try {
      const text = currentDocumentText()
      if (text === null) { setStatus('编辑器尚未就绪，请稍后再试'); return }
      const disk = await invoke<string>('read_disk_version', { token: documentRef.current.token })
      setDiskDiff({ lines: lineDiff(disk, text) ?? undefined })
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
      const agreed = window.confirm(translateWith(encoding ? '内容里有原编码（{encoding}）无法表示的字符。\n要把这个文件改存为 UTF-8 吗？' : '内容里有原编码无法表示的字符。\n要把这个文件改存为 UTF-8 吗？', settingsRef.current.language, { encoding }))
      if (!agreed) throw new Error('UNENCODABLE')
      return invoke<T>(command, { ...args, assets: await assets(), forceUtf8: true })
    }
  }

  async function saveConflictCopyAs(): Promise<void> {
    if (busyRef.current) { noteBusy(); return }
    if (!isTextKind(documentRef.current.kind)) { setStatus(errorText('READ_ONLY')); return }
    const markdown = currentDocumentText()
    if (markdown === null) { setStatus('编辑器尚未就绪，请稍后再另存副本'); return }
    takeBusy()
    try {
      const assets = adapter.current?.isReady() ? await adapter.current.pendingAssets() : []
      const name = await invokeSave<string | null>('save_conflict_copy', { token: documentRef.current.token, markdown }, () => stageAssets(assets))
      setStatus(name ? `已另存副本 ${name}；可继续选择使用磁盘版本` : '已取消另存，当前内容仍在编辑器中')
    } catch (error) { setNotice({ kind: 'error', message: errorText(error) }) }
    finally { releaseBusy() }
  }

  function refreshDrafts() {
    void invoke<DraftSummary[]>('list_drafts').then(setDrafts).catch((error: unknown) => setStatus(errorText(error)))
  }

  async function canProceed(finalizeDiscard = false): Promise<boolean> {
    if (busyRef.current) { noteBusy(); return false }
    if (!isDirty(sessionRef.current)) { pendingDiscardDraftId.current = null; return true }
    pendingDiscardDraftId.current = null
    if (!desktop) return window.confirm(translateStatus('当前修改尚未保存。确定放弃修改吗？', settingsRef.current.language))
    try {
      const action = await invoke<UnsavedAction>('choose_unsaved_action')
      const allowed = await mayLeaveDocument(action, saveDocument)
      if (allowed && action === 'discard') {
        // Nothing is dirty any more, so neither a pending draft timer nor leaving this tab writes the draft again.
        draftScheduler.current?.cancel()
        autosaveScheduler.current?.cancel()
        updateSession(discardChanges(sessionRef.current))
        pendingDiscardDraftId.current = documentRef.current.draftId
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
    while (busyRef.current) await new Promise((resolve) => window.setTimeout(resolve, 100))
    // Holds the lock like any other open, so a sidebar click cannot open the same file in a second tab meanwhile.
    takeBusy()
    try {
      if (intent.kind === 'document') {
        const opened = await invoke<OpenResult>('open_intent_document', { token: intent.token })
        candidateToken = opened.token
        await showOpened(opened)
        candidateToken = null
      } else if (intent.kind === 'folder') {
        const chosen = await invoke<WorkspaceRoot>('open_intent_workspace', { token: intent.token })
        await activateWorkspace(chosen)
      } else {
        const current = documentRef.current
        if (current.mode !== 'visual') { await invoke('discard_open_intent', { token: intent.token }); setStatus(current.kind === 'markdown' ? '源码保护模式不能直接插入图片' : '这类文档不能插入图片'); return }
        const image = await invoke<NativeImageIntent>('read_intent_image', { token: intent.token })
        let attempts = 0
        while (!liveEditorFor(documentRef.current)?.isReady() && attempts++ < 50) await new Promise((resolve) => window.setTimeout(resolve, 100))
        const editor = liveEditorFor(documentRef.current)
        if (!editor?.isReady()) throw new Error('EDITOR_NOT_READY')
        editor.insertFile(new File([await readStaged(image.staged)], image.name, { type: image.mime }))
      }
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { releaseBusy() }
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
    takeBusy()
    try {
      const restored = await invoke<RestoredSession>('restore_session', { openTokens: tabsRef.current.map((tab) => tab.document.token).filter(Boolean) })
      const items: TabItem[] = []
      let activeItem: TabItem | null = null
      let missing = restored.missing
      for (const [index, opened] of restored.documents.entries()) {
        try {
          // Another window may already show it, for one opened from Finder before this one restored its tabs.
          if ((await claimDocument(opened.token)).where !== 'claimed') { await releaseCandidate(opened.token); continue }
          const hydrated = await hydrateImages(opened, settingsRef.current.openInReadingMode)
          const item = { key: crypto.randomUUID(), document: hydrated, session: createSession(hydrated.id, hydrated.revision) }
          items.push(item)
          if (index === restored.active) activeItem = item
        } catch { missing++; await releaseCandidate(opened.token) }
      }
      if (items.length > 0) {
        if (onlyUntouchedBlank()) { updateTabs(items); activateTab(activeItem ?? items[0]) }
        // Something else opened first, such as a file from Finder, so it stays in front.
        else { captureCurrentTab(); updateTabs([...items, ...tabsRef.current]) }
      }
      if (missing > 0) setStatus(`已恢复 ${items.length} 个文档；${missing} 个文件已不在原位置`)
    } catch (error) { setStatus(errorText(error)) }
    finally { releaseBusy() }
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
    if (busyRef.current) { noteBusy(); return }
    openTab(makeDocument('', untitledName(settings.language)))
  }

  async function openDocument() {
    if (busyRef.current) { noteBusy(); return }
    let candidateToken: string | null = null
    let took = false
    try {
      const opened = await invoke<OpenResult | null>('open_document')
      if (opened) {
        candidateToken = opened.token
        // Something else may have started while the panel was open.
        while (busyRef.current) await new Promise((resolve) => window.setTimeout(resolve, 100))
        takeBusy()
        took = true
        setStatus(`正在打开 ${opened.name}…`)
        await showOpened(opened)
        candidateToken = null
      }
    } catch (error) {
      await releaseCandidate(candidateToken)
      setStatus(errorText(error))
    } finally {
      if (took) releaseBusy()
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
    if (busyRef.current) { noteBusy(); return }
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
    updateSettings({ showSidebar: true })
    await loadChildren(chosen.token)
    setStatus(`已打开文件夹 ${chosen.name}`)
    void rememberWorkspace(chosen.token).catch(() => undefined)
  }

  async function openWorkspaceEntry(token: string) {
    if (busyRef.current) { noteBusy(); return }
    takeBusy()
    setStatus('正在打开文档…')
    let candidateToken: string | null = null
    try {
      const opened = await invoke<OpenResult>('open_workspace_document', { entryToken: token })
      candidateToken = opened.token
      await showOpened(opened, token)
      candidateToken = null
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { releaseBusy() }
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
    do await nextFrame()
    while (performance.now() < deadline && !(documentRef.current.mode === 'visual' ? adapterDocumentId.current === documentRef.current.id && adapter.current?.isReady() : sourceEditor.current))
    runFindRef.current(query)
    findGoToRef.current(hit.occurrence)
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

  /**
   * Moves a file, or a folder with everything in it, into the folder `targetToken` (T109), dragged in the sidebar.
   * Rust moves the grants with it, so open tabs of files inside keep saving to the new place.
   */
  async function moveEntry(entry: WorkspaceEntry & { parentToken: string }, targetToken: string) {
    if (entry.token === targetToken || entry.parentToken === targetToken) return
    try {
      await invoke<WorkspaceEntry>('move_workspace_entry', { entryToken: entry.token, targetToken })
      setTree((current) => {
        const parent = current[entry.parentToken]
        return parent ? { ...current, [entry.parentToken]: { ...parent, entries: parent.entries.filter((item) => item.token !== entry.token) } } : current
      })
      if (selectedEntry?.token === entry.token) setSelectedEntry({ ...selectedEntry, parentToken: targetToken })
      if (selectedDirectory === entry.token || !entry.directory && selectedDirectory === entry.parentToken) setSelectedDirectory(entry.directory ? entry.token : targetToken)
      await Promise.all([loadChildren(entry.parentToken), loadChildren(targetToken)])
      setStatus(`已移动：${entry.name}`)
    } catch (error) {
      const code = errorCode(error)
      setStatus(code === 'TARGET_EXISTS' ? `目标文件夹里已有同名项目：${entry.name}` : code === 'ASSET_CONFLICT' ? `目标文件夹的 assets 里已有同名但内容不同的图片，未移动：${entry.name}` : errorText(error))
    }
  }

  /** Moves a file, or a folder with everything in it, to the Trash. Tabs of files inside a folder are closed first. */
  async function trashEntry(entry?: WorkspaceEntry & { parentToken: string }) {
    const target = entry ?? selectedEntry
    if (!target) return
    const question = translateWith(target.directory ? '将文件夹“{name}”及其中的所有内容移到废纸篓？' : '将“{name}”移到废纸篓？', settingsRef.current.language, { name: target.name })
    if (!window.confirm(question)) return
    try {
      // Rust names the sidebar entries and open documents at or inside the entry by token; the frontend never sees
      // paths. A file asks too: a tab may show it without having been opened from the sidebar.
      const inside = desktop ? await invoke<{ entryTokens: string[]; documentTokens: string[] }>('workspace_entry_contents', { entryToken: target.token }) : { entryTokens: [target.token], documentTokens: [] }
      const entries = new Set(inside.entryTokens), documents = new Set(inside.documentTokens)
      const affected = tabsRef.current.filter((tab) => { const note = tabDocument(tab.key) ?? tab.document; return (note.entryToken && entries.has(note.entryToken)) || (note.token && documents.has(note.token)) }).map((tab) => tab.key)
      // A tab with unsaved changes asks first; canceling keeps the folder where it is.
      if (affected.length && !await closeTabs(affected)) return
      await invoke('trash_workspace_entry', { entryToken: target.token })
      setTree((current) => Object.fromEntries(Object.entries(current).filter(([token]) => !entries.has(token))))
      if (selectedEntry && entries.has(selectedEntry.token)) setSelectedEntry(null)
      if (selectedDirectory && entries.has(selectedDirectory)) setSelectedDirectory(target.parentToken)
      await loadChildren(target.parentToken)
      setStatus(`已移到废纸篓：${target.name}`)
    } catch (error) { setStatus(errorText(error)) }
  }

  async function saveDocument(asNew = false, background = false): Promise<boolean> {
    const instance = adapter.current
    if (background && (busyRef.current || composingNow())) return false
    if (busyRef.current) {
      if (sessionRef.current.persistence === 'saving') { queuedSave.current = true; setStatus('正在保存，完成后会再保存一次') }
      else noteBusy()
      return false
    }
    if (!isTextKind(document.kind)) { if (!background) setStatus(errorText('READ_ONLY')); return false }
    // An editor still loading may yet fall back to source mode (`fragmentsSurvived`), which would orphan this save.
    if (document.mode === 'visual' && (!instance || !instance.isReady() || adapterDocumentId.current !== document.id)) { if (!background) setStatus('编辑器尚未就绪，请稍后再保存'); return false }
    if (composingNow()) { setStatus('请先完成当前中文输入，再保存'); return false }
    if (document.token && !asNew && !isDirty(sessionRef.current)) {
      setStatus('内容未修改，磁盘文件无需重写')
      return true
    }
    const sourceText = flushSourceText().sourceText
    let began: ReturnType<typeof beginSave>
    try { began = beginSave(sessionRef.current) }
    catch { noteBusy(); return false }
    const { session: saving, ticket } = began
    takeBusy()
    updateSession(saving)
    try {
      const visual = document.mode === 'visual'
      // Both calls read the editor before anything is awaited, so the text and its pending images are one state.
      const [editorMarkdown, pending] = visual ? await Promise.all([instance!.persistableMarkdown(), instance!.pendingAssets()]) : [sourceText, null]
      const markdown = visual ? composeVisualMarkdown(document.prepared.analysis, editorMarkdown) : editorMarkdown
      // Only a source-mode document that holds recovered images needs the list of images in its text (T92).
      const referenced = !visual && document.recoveredAssets.size ? new Set(await imageUrlsInAsync(markdown)) : null
      const assets: PendingAsset[] = pending ?? Array.from(document.recoveredAssets, ([url, asset]) => ({ url, ...asset })).filter((asset) => referenced!.has(asset.url))
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
      const savedText = saved.markdown ?? markdown
      if (unchangedDuringSave && sourceEditor.current && document.mode === 'source-protected') sourceEditor.current.value = savedText
      setDocument((current) => current.id === document.id ? {
        ...current, kind: saved.kind, encoding: saved.encoding,
        // A text file saved as Markdown becomes a Markdown document: read as one now, analyzed when editing starts.
        deferredVisual: saved.kind === 'markdown' && current.kind !== 'markdown' ? true : current.deferredVisual,
        token: saved.token, assetKey: saved.assetKey, retiredTokens: document.token && saved.token !== document.token ? [...current.retiredTokens, document.token] : current.retiredTokens, name: saved.name, revision: saved.revision, originalMarkdown: savedText, sourceText: current.mode === 'source-protected' && unchangedDuringSave ? savedText : current.sourceText, sampleId: undefined,
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
      releaseBusy()
    }
  }
  saveDocumentRef.current = (background = false) => saveDocument(false, background)
  saveDocumentAsRef.current = () => saveDocument(true)

  /** Export HTML, Export PDF, or Print through the system panel (T106): all three render the same page. */
  async function exportPage(mode: 'html' | 'print' | 'pdf') {
    if (busyRef.current) { noteBusy(); return }
    if (document.kind === 'pdf') { setStatus(errorText('READ_ONLY')); return }
    if ((document.mode === 'visual' && !adapter.current) || toolbar.composing) return
    takeBusy()
    let snapshotId: string | null = null
    try {
      // A text or source file has no images and is not Markdown: its own renderer makes the body (T88).
      const plainText = document.kind === 'markdown' ? null : flushSourceText().sourceText
      const bodyHtml = plainText === null ? undefined : document.kind === 'text' ? await renderTextPreviewAsync(plainText) : await renderCodePreviewAsync(plainText, document.name, delimiter)
      if (plainText === null) snapshotId = await captureSnapshot(false, true)
      const frozen = plainText === null ? await invoke<SnapshotOut>('read_snapshot', { snapshotId }) : { markdown: '', title: document.name, assets: [] as StagedAsset[], generation: document.id, revision: sessionRef.current.revision }
      const assets = new Map(await Promise.all(frozen.assets.map(async (asset) => [asset.url, { bytes: await readStaged(asset.staged), mime: asset.mime }] as const)))
      // The page carries the reading style, typography and only the font subsets its characters need (T59).
      const current = settingsRef.current
      const { buildExportStyle } = await import('../features/export/exportStyle')
      const { readAppAsset } = await import('../features/export/appAssets')
      const sources = mayContainMermaid(frozen.markdown) ? await mermaidSourcesAsync(frozen.markdown) : []
      const look = await buildExportStyle({
        diagrams: sources.length ? { fontFamily: (await import('../features/diagrams/looks')).diagramFontFamily(current.diagramStyle, current.diagramFont), text: sources.join('\n') } : undefined,
        style, typography: documentTypography(current, style, docScript), exportStyle: current.exportStyle, pdfMode: current.pdfMode, pageSize: current.pageSize, pageMargin: current.pageMargin,
        text: `${frozen.title}\n${plainText ?? frozen.markdown}`, mode, readAsset: (path) => readAppAsset(path, (assetPath) => invoke<ArrayBuffer>('read_app_asset', { path: assetPath })),
      })
      const diagrams = sources.length ? await (await import('../features/diagrams/mermaid')).renderDiagramsForExport(sources, look.diagramStyleId, { look: current.diagramStyle, line: current.diagramLine, curve: current.diagramCurve, fill: current.diagramFill, colors: current.diagramColors, custom: current.diagramCustomColors, font: current.diagramFont }) : new Map<string, string>()
      const rendered = await renderExportAsync(frozen.markdown, titleOf(frozen.title), assets, diagrams, { stylesheet: look.stylesheet, fontsEmbedded: look.fontsEmbedded, captions: current.imageCaptions, lang: layoutScript(current, docScript) === 'latin' ? 'en' : 'zh-CN', bodyHtml })
      const { omittedHtml, failedDiagrams } = rendered
      const html = rendered.hasMath ? (await import('../features/export/katexStyles')).embedMathStyles(rendered.html) : rendered.html
      const omitted = `${omittedHtml ? `；${omittedHtml} 处原始 HTML 未输出` : ''}${failedDiagrams ? `；${failedDiagrams} 张图表无法渲染，已保留代码` : ''}${look.fontFallback ? '；字体未能内嵌，已改用系统字体' : ''}`
      if (mode === 'html') {
        const name = await invoke<string | null>('export_html', { html })
        setStatus(name ? `已导出 ${name}${omitted}` : '已取消 HTML 导出，当前文档未改变')
      } else if (mode === 'pdf') {
        setStatus('正在导出 PDF…')
        const name = await invoke<string | null>('export_pdf', { html, title: frozen.title, paper: look.paper, pageSize: current.pageSize })
        setStatus(name ? `已导出 ${name}${omitted}` : '已取消 PDF 导出，当前文档未改变')
      } else {
        const printed = await invoke<boolean>('print_page', { html, title: frozen.title, pageSize: current.pageSize })
        setStatus(printed ? `已交给打印${omitted}` : '已取消打印')
      }
    } catch (error) {
      setStatus(errorText(error))
    } finally {
      if (snapshotId) await invoke('release_snapshot', { snapshotId }).catch(() => undefined)
      releaseBusy()
    }
  }

  /** `forPage`: the snapshot also carries what only an exported page shows, the files raw HTML `<img>` and SVG images point at. */
  async function captureSnapshot(textOnly: boolean, forPage = false): Promise<string> {
    const instance = adapter.current
    if (document.mode === 'visual' && (!instance || toolbar.composing)) throw new Error('EDITOR_NOT_READY')
    const revision = sessionRef.current.revision
    const markdown = document.mode === 'visual'
      ? composeVisualMarkdown(document.prepared.analysis, instance!.getPersistableMarkdown())
      : flushSourceText().sourceText
    let assets: PendingAsset[] = []
    let diskAssets: { url: string; relative: string }[] = []
    let pageImages: { url: string; relative: string }[] = []
    if (!textOnly) {
      const held: PendingAsset[] = document.mode === 'visual' ? await instance!.pendingAssets() : Array.from(document.recoveredAssets, ([url, asset]) => ({ url, ...asset }))
      ;({ assets, diskAssets } = snapshotResources(await imageUrlsInAsync(markdown), new Map(held.map((asset) => [asset.url, asset])), Boolean(document.token)))
      if (forPage && document.token) {
        // A Markdown export copies only PNG, JPEG, GIF and WebP; a page also shows SVG files and raw HTML images.
        const isSvg = (asset: { relative: string }) => /\.svg$/i.test(asset.relative)
        pageImages = diskAssets.filter(isSvg)
        diskAssets = diskAssets.filter((asset) => !isSvg(asset))
        const known = new Set(diskAssets.map((asset) => asset.url))
        for (const file of await htmlImageFilesInAsync(markdown)) {
          if (!known.has(file.url)) { known.add(file.url); pageImages.push(file) }
        }
      }
    }
    return invoke<string>('create_snapshot', { markdown, title: document.name, assets: await stageAssets(assets), diskAssets, pageImages, token: document.token || null, generation: document.id, revision })
  }

  async function exportSnapshotMD(textOnly: boolean) {
    if (busyRef.current) { noteBusy(); return }
    if (document.kind !== 'markdown') { setStatus(document.kind === 'pdf' ? errorText('READ_ONLY') : '这类文档不是 Markdown；可以用“另存为”存成 Markdown。'); return }
    if (!desktop || (!textOnly && document.mode === 'source-protected')) return
    takeBusy()
    let snapshotId: string | null = null
    try {
      snapshotId = await captureSnapshot(textOnly)
      const output = await invoke<{ name: string; sha256: string; assets: { path: string; sha256: string }[] } | null>('export_snapshot_md', { snapshotId, textOnly })
      setStatus(output ? `已导出 ${output.name} · ${output.assets.length} 张图片 · SHA-256 ${output.sha256.slice(0, 12)}…` : '已取消 MD 导出，当前文档未改变')
    } catch (error) { setStatus(errorText(error)) }
    finally {
      if (snapshotId) await invoke('release_snapshot', { snapshotId }).catch(() => undefined)
      releaseBusy()
    }
  }

  /** `fromContextMenu`: chosen in the body's right-click menu, which leaves focus where it was. */
  function runFormatAction(action: string, fromContextMenu = false) {
    const editor = adapter.current
    if (documentRef.current.mode !== 'visual' || !editor || !(fromContextMenu || editor.hasEditorFocus())) return
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
    // ⌘0 is "actual size" for the pinch too.
    if (action === 'zoom-reset') resetPinchZoom()
    if (isZoomAction(action)) { updateSettings((current) => ({ editorFontSize: zoomedFontSize(current.editorFontSize, action) })); return }
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
    if (action === 'export-pdf') void exportPage('pdf')
    if (action === 'print') void exportPage('print')
    if (action === 'toggle-reading') setReading(!documentRef.current.reading)
    if (action === 'view-toolbar') updateSettings((current) => ({ showFileToolbar: !current.showFileToolbar }))
    if (action === 'view-sidebar') updateSettings((current) => ({ showSidebar: !current.showSidebar }))
    if (action === 'view-outline') updateSettings((current) => ({ showOutline: !current.showOutline }))
    if (action === 'preferences') openSettings()
    if (action === 'recover-drafts') {
      setDraftsOpen(true)
      refreshDrafts()
    }
    if (action === 'new-window') void invoke('create_workspace_window', { transfer: null }).catch((error: unknown) => setStatus(errorText(error)))
    if (action === 'close-tab') void closeTabs([activeTabKeyRef.current])
  }

  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
  onKeyDownRef.current = (event: KeyboardEvent) => {
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
        setSettingsOpen(false)
        setDraftsOpen(false)
        setDiskDiff(null)
        closeDetailsMenus(null)
      }
  }
  // Subscribed once; the handler above is replaced on every render and always sees the current state (T93).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onKeyDownRef.current(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
    let took = false
    try {
      if (kind === 'folder') {
        const chosen = await invoke<WorkspaceRoot | null>('choose_recent_workspace', { id })
        if (chosen) await activateWorkspace(chosen)
        return
      }
      const opened = await invoke<OpenResult | null>('choose_recent_file', { id })
      if (!opened) return
      candidateToken = opened.token
      while (busyRef.current) await new Promise((resolve) => window.setTimeout(resolve, 100))
      takeBusy()
      took = true
      setStatus(`正在打开 ${opened.name}…`)
      await showOpened(opened)
      candidateToken = null
    } catch (error) { await releaseCandidate(candidateToken); setStatus(errorText(error)) }
    finally { if (took) releaseBusy() }
  }

  function openFind() {
    setFindOpen(true)
    if (documentRef.current.mode === 'source-protected' && documentRef.current.kind !== 'pdf') setSourceView(true)
  }

  function closeFind() {
    cancelQueuedFind()
    setFindCapped(false)
    setFindOpen(false)
    adapter.current?.find('')
    if (documentRef.current.kind === 'pdf') void pdfView.current?.find('', findOptionsRef.current)
    // A text or source file being read returns from its source to the reading page.
    else if (documentRef.current.kind !== 'markdown' && documentRef.current.reading) setSourceView(false)
    setFindCount(NO_MATCHES)
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

  /** Typing searches after a short pause, so a fast typist does not search for every prefix of the word (T94). */
  function queueFind(query: string) {
    window.clearTimeout(queuedFind.current.timer)
    queuedFind.current = { query, timer: window.setTimeout(flushQueuedFind, FIND_INPUT_DELAY_MS) }
  }

  function cancelQueuedFind() {
    window.clearTimeout(queuedFind.current.timer)
    queuedFind.current.query = null
  }

  /** Anything that acts on the matches runs the pending search first, so it never acts on the previous query's. */
  function flushQueuedFind() {
    const { query } = queuedFind.current
    if (query !== null) runFind(query)
  }

  /** The matches the source editor lists. Replacing everything searches again without the limit. */
  function sourceMatches(text: string, query: string): FindMatch[] {
    const matches = findInText(text, query, sourceFindOptions(text), SOURCE_MATCH_LIMIT + 1)
    setFindCapped(matches.length > SOURCE_MATCH_LIMIT)
    return matches.length > SOURCE_MATCH_LIMIT ? matches.slice(0, SOURCE_MATCH_LIMIT) : matches
  }

  const pdfFindSequence = useRef(0)
  function runFind(query: string) {
    cancelQueuedFind()
    if (documentRef.current.mode === 'visual' || documentRef.current.kind === 'pdf') setFindCapped(false)
    if (documentRef.current.kind === 'pdf') {
      // The text of a PDF is read page by page, so the count arrives a little later.
      const sequence = ++pdfFindSequence.current
      setFindRegexBlocked(false)
      void pdfView.current?.find(query, findOptionsRef.current).then((count) => { if (sequence === pdfFindSequence.current) setFindCount(count) }, () => undefined)
      return
    }
    if (documentRef.current.mode === 'visual') { setFindRegexBlocked(false); setFindCount(adapter.current?.find(query, findOptionsRef.current) ?? NO_MATCHES); return }
    const text = sourceEditor.current?.value ?? documentRef.current.sourceText
    setFindRegexBlocked(exceedsVisualLimit(text))
    sourceFind.current = { matches: sourceMatches(text, query), index: 0 }
    setFindCount({ current: 0, total: sourceFind.current.matches.length })
    revealSourceMatch()
  }

  /** The user can type in the source editor while the find bar is open, so stored offsets go stale. */
  function refreshSourceMatches() {
    const text = sourceEditor.current?.value ?? documentRef.current.sourceText
    const matches = sourceMatches(text, findQuery)
    sourceFind.current = { matches, index: Math.min(sourceFind.current.index, Math.max(0, matches.length - 1)) }
  }

  /** Goes to the match that stepping forward `index` times from the first would reach, without the steps in between (T94). */
  function findGoTo(index: number) {
    flushQueuedFind()
    if (documentRef.current.kind === 'pdf') { for (let step = 0; step < index; step++) findStep(1); return }
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.findAt(index) ?? NO_MATCHES); return }
    refreshSourceMatches()
    const { matches } = sourceFind.current
    if (matches.length === 0) return
    sourceFind.current.index = index % matches.length
    setFindCount({ current: sourceFind.current.index, total: matches.length })
    revealSourceMatch()
  }

  function findStep(direction: 1 | -1) {
    flushQueuedFind()
    if (documentRef.current.kind === 'pdf') { setFindCount(pdfView.current?.findStep(direction) ?? NO_MATCHES); return }
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.findStep(direction) ?? NO_MATCHES); return }
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
  findGoToRef.current = findGoTo

  function replaceInSource(ranges: FindMatch[]) {
    const element = sourceEditor.current
    if (!element) return
    element.replaceRanges(ranges.map((range) => ({ from: range.from, to: range.to, insert: replacementFor(range, replaceText) })))
    updateSession(editSession(sessionRef.current))
    runFind(findQuery)
  }

  function replaceOne() {
    if (documentRef.current.reading || documentRef.current.kind === 'pdf') { setStatus(errorText('READING_MODE')); return }
    flushQueuedFind()
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.replaceCurrent(replaceText) ?? NO_MATCHES); return }
    refreshSourceMatches()
    const match = sourceFind.current.matches[sourceFind.current.index]
    if (match) replaceInSource([match])
  }

  function replaceEvery() {
    if (documentRef.current.reading || documentRef.current.kind === 'pdf') { setStatus(errorText('READING_MODE')); return }
    flushQueuedFind()
    if (documentRef.current.mode === 'visual') { setFindCount(adapter.current?.replaceAll(replaceText) ?? NO_MATCHES); return }
    // Every match, not only the listed ones.
    const text = sourceEditor.current?.value ?? documentRef.current.sourceText
    replaceInSource(findInText(text, findQuery, sourceFindOptions(text)))
  }

  const linkOpenRef = useRef<(href: string) => void>(() => undefined)
  linkOpenRef.current = (href) => {
    const safe = safeLinkHref(href)
    if (!safe) { setStatus('链接地址无效或使用了不允许的协议'); return }
    if (isExternalHref(safe)) { void invoke('open_external', { url: safe }).catch((error: unknown) => setStatus(errorText(error))); return }
    openSiblingDocument(safe)
  }

  function openSiblingDocument(href: string) {
    if (!documentRef.current.entryToken) return
    let name: string
    try { name = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/^\.\//, '') } catch { return }
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || kindOfName(name) !== 'markdown') return
    const siblings = Object.values(tree).find((state) => state.entries.some((entry) => entry.token === documentRef.current.entryToken))?.entries
    const sibling = siblings?.find((entry) => !entry.directory && entry.name === name)
    if (sibling) void openWorkspaceEntry(sibling.token)
  }

  // Right-click menus (T105). The menu is described here, shown natively by Rust, and the chosen id comes
  // back as `context-action`; `contextTarget` remembers what the menu was opened on.
  const rightClickSelection = useRef<string | null>(null)
  function showContextMenu(target: ContextTarget, items: MenuEntry[]) {
    if (!desktop || items.length === 0) return
    contextTarget.current = target
    void invoke('show_context_menu', { items }).catch((error: unknown) => setStatus(errorText(error)))
  }

  function tabDocument(key: string): DocumentState | null {
    if (key === activeTabKeyRef.current) return documentRef.current
    return tabsRef.current.find((tab) => tab.key === key)?.document ?? null
  }

  function openBodyMenu(event: MouseEvent<HTMLElement>) {
    if (!desktop) return
    const element = event.target as HTMLElement
    const area = element.closest<HTMLElement>('.editor-host, .markdown-preview, .source-editor, .pdf-view')
    if (!area) return
    event.preventDefault()
    const current = documentRef.current
    // A code block in the visual editor is its own CodeMirror view: it is offered what a source editor is.
    const inCode = area.classList.contains('editor-host') && Boolean(element.closest('.cm-editor'))
    const view: BodyView = area.classList.contains('editor-host') ? (inCode ? 'source' : 'visual') : area.classList.contains('pdf-view') ? 'pdf' : area.classList.contains('source-editor') ? 'source' : 'preview'
    let text = ''
    const visualReadonly = view === 'visual' && (!adapter.current || adapter.current.isReadonly())
    if (view === 'visual' && !visualReadonly) { if (adapter.current?.prepareContextMenu(event.clientX, event.clientY)) text = adapter.current.plainText().selected ?? '' }
    else if (view === 'source' && !inCode && sourceEditor.current) {
      const editor = sourceEditor.current
      if (editor.prepareContextMenu(event.clientX, event.clientY)) text = editor.value.slice(editor.selectionStart, editor.selectionEnd)
    } else {
      // WebKit selects the word under a right click before this event. Only a selection the user made counts:
      // one that was there at the mouse press and is unchanged now. The editors above read their own state, which
      // has not taken in WebKit's word yet.
      const before = rightClickSelection.current
      const now = window.getSelection()?.toString() ?? ''
      if (before && now === before) text = now
      else if (now && !inCode) window.getSelection()?.removeAllRanges()
    }
    rightClickSelection.current = null
    const link = element.closest('a[href]')?.getAttribute('href') ?? null
    const editable = !current.reading && current.kind !== 'pdf' && (view === 'visual' ? !visualReadonly : view === 'source')
    showContextMenu({ area: 'body', tabKey: activeTabKeyRef.current, view, link, text }, bodyMenu({
      view, kind: current.kind, editable, selection: text.trim().length > 0, link, saved: Boolean(current.token),
      ai: ai.config.enabled && !inCode, folders: workspacesRef.current.length > 0,
    }))
  }

  function openTabMenu(key: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    const index = tabsRef.current.findIndex((tab) => tab.key === key)
    const note = tabDocument(key)
    if (index < 0 || !note) return
    showContextMenu({ area: 'tab', tabKey: key }, tabMenuItems({ index, count: tabsRef.current.length, saved: Boolean(note.token), active: key === activeTabKeyRef.current, kind: note.kind }))
  }

  function openEntryMenu(entry: WorkspaceEntry, parentToken: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedEntry({ ...entry, parentToken })
    setSelectedDirectory(entry.directory ? entry.token : parentToken)
    showContextMenu({ area: 'entry', entry: { ...entry, parentToken } }, entryMenu({ directory: entry.directory, root: false, roots: workspacesRef.current.length }))
  }

  function openRootMenu(token: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedEntry(null)
    setSelectedDirectory(token)
    showContextMenu({ area: 'root', token }, entryMenu({ directory: true, root: true, roots: workspacesRef.current.length }))
  }

  function writeClipboard(text: string) {
    return invoke('write_clipboard_text', { text }).then(() => setStatus(text.length > 60 ? `已拷贝 ${text.length} 个字符` : '已拷贝'))
  }

  /** The document or sidebar entry a file action is about, as the argument Rust resolves to a path. */
  function fileTarget(target: ContextTarget): { documentToken: string } | { entryToken: string } | null {
    if (target.area === 'entry') return { entryToken: target.entry.token }
    if (target.area === 'root') return { entryToken: target.token }
    const token = tabDocument(target.tabKey)?.token
    return token ? { documentToken: token } : null
  }

  function renameOpenDocument(token: string, entryToken: string | undefined, name: string) {
    updateTabs(tabsRef.current.map((tab) => tab.document.token === token ? { ...tab, document: { ...tab.document, name } } : tab))
    if (documentRef.current.token === token) setDocument((current) => ({ ...current, name }))
    if (entryToken) setTree((old) => Object.fromEntries(Object.entries(old).map(([key, state]) => [key, { ...state, entries: state.entries.map((entry) => entry.token === entryToken ? { ...entry, name } : entry) }])))
  }

  async function confirmDocumentRename() {
    const pending = documentRename
    const note = pending ? tabDocument(pending.tabKey) : null
    const name = pending?.name.trim() ?? ''
    if (!note?.token || !name) return
    if (name === note.name) { setDocumentRename(null); return }
    try {
      const renamed = await invoke<string>('rename_document', { token: note.token, newName: name })
      renameOpenDocument(note.token, note.entryToken, renamed)
      setDocumentRename(null)
      setStatus(`已重命名为 ${renamed}`)
    } catch (error) { setStatus(errorText(error)) }
  }

  /** Moves an open document's file to the Trash and closes its tab; unsaved edits go with it after a warning. */
  async function trashDocument(key: string) {
    const note = tabDocument(key)
    if (!note?.token) return
    if (busyRef.current || closingTabsRef.current) { noteBusy(); return }
    const active = key === activeTabKeyRef.current
    const session = active ? sessionRef.current : tabsRef.current.find((tab) => tab.key === key)?.session
    const dirty = session ? isDirty(session) : false
    const question = translateWith(dirty ? '将“{name}”移到废纸篓？未保存的修改会一并丢弃。' : '将“{name}”移到废纸篓？', settingsRef.current.language, { name: note.name })
    if (!window.confirm(question)) return
    try { await invoke('trash_document', { token: note.token }) }
    catch (error) { setStatus(errorText(error)); return }
    if (active) updateSession(discardChanges(sessionRef.current))
    else updateTabs(tabsRef.current.map((tab) => tab.key === key ? { ...tab, session: discardChanges(tab.session) } : tab))
    if (note.entryToken) setTree((old) => Object.fromEntries(Object.entries(old).map(([dir, state]) => [dir, { ...state, entries: state.entries.filter((entry) => entry.token !== note.entryToken) }])))
    // The file is gone either way; the draft is kept until the tab has really closed.
    if (!await closeTabs([key])) { setStatus(`已移到废纸篓：${note.name}；标签页未能关闭`); return }
    await discardDraft(note.draftId).catch(() => undefined)
    setStatus(`已移到废纸篓：${note.name}`)
  }

  async function runContextAction(id: string, clipboardText: string | null) {
    const target = contextTarget.current
    if (!target) return
    const editor = adapter.current
    const body = target.area === 'body' ? target : null
    const tabKey = target.area === 'body' || target.area === 'tab' ? target.tabKey : null
    const entry = target.area === 'entry' ? target.entry : null
    const directory = target.area === 'root' ? target.token : entry?.directory ? entry.token : null
    try {
      if (id.startsWith('ai-') && id !== 'ai-ask') {
        if (!ai.config.consented) { ai.toggleOpen(); return }
        ai.setOpen(true)
        await ai.runSelection(id.slice(3) as AiSelectionAction)
        return
      }
      if (id.startsWith('format-') || id.startsWith('transform-')) {
        if (id === 'format-clear') editor?.runCommand('clearFormat')
        else runFormatAction(id, true)
        return
      }
      switch (id) {
        case 'paste-plain': if (clipboardText) { editor?.pastePlainText(clipboardText) } return
        case 'copy-markdown': { const markdown = editor?.selectionMarkdown() || body?.text; if (markdown) await writeClipboard(markdown); return }
        case 'copy-plain': if (body?.text) await writeClipboard(body.text); return
        case 'find-selection': {
          const query = body?.text.trim().split('\n', 1)[0] ?? ''
          setFindQuery(query)
          openFind()
          queueFind(query)
          return
        }
        case 'search-folder': {
          const query = body?.text.trim().split('\n', 1)[0].slice(0, 256) ?? ''
          updateSettings({ showSidebar: true })
          setSearchQuery(query)
          runWorkspaceSearch(query)
          return
        }
        case 'ai-ask': if (!ai.open) ai.toggleOpen(); return
        case 'insert-table': editor?.runTableCommand('insert', 3, 3); return
        case 'insert-rule': editor?.runCommand('rule'); return
        case 'open-link': if (body?.link) linkOpenRef.current(body.link); return
        case 'copy-link': if (body?.link) await writeClipboard(body.link); return
        case 'edit-link': runFormatAction('format-link', true); return
        case 'reveal': { const args = fileTarget(target); if (args) await invoke('reveal_in_finder', args); return }
        case 'copy-path': { const args = fileTarget(target); if (args) { await invoke('copy_file_path', args); setStatus('已拷贝文件路径') } return }
        case 'rename':
          if (entry) { setSelectedEntry(entry); setRenameName(entry.name); setNewEntryType(null); setRenaming(true) }
          else if (tabKey) { const note = tabDocument(tabKey); if (note?.token) setDocumentRename({ tabKey, name: note.name }) }
          return
        case 'trash': if (entry) await trashEntry(entry); else if (tabKey) await trashDocument(tabKey); return
        case 'close': case 'close-tab': if (tabKey) await closeTabs([tabKey]); return
        case 'close-others': if (tabKey) await closeTabs(tabsRef.current.filter((tab) => tab.key !== tabKey).map((tab) => tab.key)); return
        case 'close-right': if (tabKey) await closeTabs(tabsRef.current.slice(tabsRef.current.findIndex((tab) => tab.key === tabKey) + 1).map((tab) => tab.key)); return
        case 'close-all': await closeTabs(tabsRef.current.map((tab) => tab.key)); return
        case 'move-window': if (tabKey) await detachTab(tabKey); return
        case 'open-entry': if (entry && !entry.directory) await openWorkspaceEntry(entry.token); return
        case 'new-file': case 'new-folder':
          if (directory) { setSelectedDirectory(directory); setRenaming(false); setNewEntryName(t(id === 'new-file' ? '新文档.md' : '新目录')); setNewEntryType(id === 'new-file' ? 'file' : 'directory') }
          return
        case 'refresh': if (directory) await loadChildren(directory); return
        case 'close-folder': if (target.area === 'root') await closeWorkspace(target.token); return
        case 'close-all-folders': await closeWorkspace(); return
        default: runFileAction(id)
      }
    } catch (error) { setStatus(errorText(error)) }
  }

  const contextActionRef = useRef<(id: string, text: string | null) => void>(() => undefined)
  contextActionRef.current = (id, text) => { void runContextAction(id, text) }
  useEffect(() => {
    if (!desktop) return
    const stop = untilCleanup(getCurrentWindow().listen<{ id: string; text: string | null }>('context-action', (event) => contextActionRef.current(event.payload.id, event.payload.text)))
    // Elsewhere in the window WebKit's own menu (Reload, Inspect) has nothing for the user; text fields keep theirs.
    const suppress = (event: globalThis.MouseEvent) => { if (!(event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) event.preventDefault() }
    const press = (event: globalThis.MouseEvent) => { if (event.button === 2 || (event.button === 0 && event.ctrlKey)) rightClickSelection.current = window.getSelection()?.toString() ?? '' }
    window.addEventListener('contextmenu', suppress)
    window.addEventListener('mousedown', press, true)
    return () => { stop(); window.removeEventListener('contextmenu', suppress); window.removeEventListener('mousedown', press, true) }
  }, [desktop])

  const menuActionRef = useRef<(action: string) => void>(() => undefined)
  menuActionRef.current = runFileAction
  useEffect(() => {
    if (!desktop) return
    return untilCleanup(getCurrentWindow().listen<string>('menu-action', (event) => menuActionRef.current(event.payload)))
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
    // Tabs whose edits the user chose to discard. They are dropped only once the window really closes: when a later
    // tab stops the close (a failed save, Cancel), they keep their edits and drafts instead of looking saved.
    const discarded: { key: string; draftId: string | null; before: DocumentSession }[] = []
    let closed = false
    try {
      for (const { key, session: storedSession } of [...tabsRef.current]) {
        if (!isDirty(key === activeTabKeyRef.current ? sessionRef.current : storedSession)) continue
        if (!await focusTabForSave(key)) return
        const active = documentRef.current
        if (active.token && isDirty(sessionRef.current)) {
          if (!await saveDocumentRef.current()) {
            // A file that was deleted, changed on disk or cannot take the text in its encoding would otherwise keep
            // the window from ever closing. Save As, or close without saving: the draft keeps the edits then.
            if (busyRef.current || !isDirty(sessionRef.current)) return
            let action: UnsavedAction
            try { action = await invoke<UnsavedAction>('choose_unsaved_action', { saveFailed: true }) }
            catch (error) { setStatus(errorText(error)); return }
            if (action === 'cancel') return
            if (action === 'save') { if (!await saveDocumentAsRef.current()) return }
            else {
              const before = sessionRef.current
              // Closing without the draft written would lose the edits outright, so a failed draft stops the close.
              try { await persistTabDraft(currentTabSnapshot(), liveEditorFor(documentRef.current), true) }
              catch (error) { setStatus(`草稿保存失败，窗口未关闭：${errorText(error)}`); return }
              draftScheduler.current?.cancel()
              autosaveScheduler.current?.cancel()
              updateSession(discardChanges(sessionRef.current))
              discarded.push({ key, draftId: null, before })
            }
          }
          await nextFrame()
        } else {
          const before = sessionRef.current
          if (!await canProceedRef.current(false)) return
          if (pendingDiscardDraftId.current) discarded.push({ key, draftId: pendingDiscardDraftId.current, before })
          pendingDiscardDraftId.current = null
        }
      }
      await draftWriteChain.current.catch(() => undefined)
      for (const { draftId } of discarded) if (draftId) await discardDraft(draftId).catch(() => undefined)
      await invoke('close_workspace_window')
      closed = true
    } finally {
      closingWindowRef.current = false
      if (!closed) for (const { key, before } of discarded) {
        if (key === activeTabKeyRef.current) updateSession(before)
        else updateTabs(tabsRef.current.map((tab) => tab.key === key ? { ...tab, session: before } : tab))
      }
    }
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
    if (busyRef.current || !await canProceed()) {
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
    if (busyRef.current) { noteBusy(); return }
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
    updateSession(withGeneration(sessionRef.current, id))
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
      if (event.metaKey || !isExternalHref(href)) linkOpenRef.current(href)
      return
    }
    let id: string
    try { id = decodeURIComponent(href.slice(1)) } catch { return }
    const destination = window.document.getElementById(`user-content-${id}`)
    if (destination && previewRoot.current?.contains(destination)) destination.scrollIntoView({ block: 'start' })
  }

  /**
   * A link in an AI answer never navigates the webview: it takes the same safe path as a link in the preview,
   * and a jump to `#…` has no target there, so it does nothing.
   */
  function onAnswerClick(event: MouseEvent<HTMLElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    event.preventDefault()
    if (event.type !== 'click') return
    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#')) return
    if (event.metaKey || !isExternalHref(href)) linkOpenRef.current(href)
  }

  async function switchToVisual() {
    if (busyRef.current) { noteBusy(); return }
    if (document.mode !== 'source-protected' || document.kind !== 'markdown') return
    if (document.deferredVisual) setStatus('正在准备编辑器，大文档需要一些时间…')
    const document_ = flushSourceText()
    if (document_ !== document) { window.setTimeout(() => void switchToVisualRef.current(), 0); return }
    takeBusy()
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
      try { visual.markdown = await rewriteImageUrlsAsync(visual.markdown, recoveredReplacements) }
      catch {
        for (const url of visual.recoveredAssets.keys()) URL.revokeObjectURL(url)
        for (const url of visual.imageUrls.keys()) URL.revokeObjectURL(url)
        setStatus('图片引用无法安全恢复，请继续使用源码模式')
        return
      }
      carryScroll(visual.id, document.deferredVisual ? documentScroller() : null)
      updateSession(withGeneration(sessionRef.current, visual.id))
      setDocument({ ...visual, draftId: document.draftId, retiredTokens: document.retiredTokens, originalMarkdown: document.originalMarkdown, sampleId: document.sampleId })
      // The source view's images were copied to new addresses above; the old ones would leak with every switch.
      revokeDocumentUrls(document)
    } finally {
      releaseBusy()
    }
  }

  const switchToVisualRef = useRef(switchToVisual)
  switchToVisualRef.current = switchToVisual

  const persistenceLabel = isPdf ? '只读' : session.persistence === 'saving' ? '保存中' : session.persistence === 'failed' ? '保存失败' : session.persistence === 'conflict' ? '磁盘冲突' : dirty ? '未保存' : document.token ? '已保存' : '未保存到磁盘'

  /** While reading, a click on an image opens it large over a dimmed page. */
  function openImageFromClick(event: { target: EventTarget | null }) {
    if (!documentRef.current.reading) return
    // A diagram opens on its own, fitted to the window, where it can be zoomed: the page may have had to shrink it (T119).
    const diagram = event.target instanceof Element ? event.target.closest<HTMLElement>('.mermaid-preview:not(.mermaid-error), .mermaid-diagram') : null
    if (diagram?.closest('.editor-root') && diagram.querySelector('svg')) { setLightbox({ svg: diagram.innerHTML, alt: '', paper: style.paper }); return }
    const image = event.target instanceof HTMLImageElement ? event.target : null
    if (!image || !image.closest('.editor-root') || !image.currentSrc) return
    setLightbox({ src: image.currentSrc, alt: image.alt })
  }

  // The optional AI assistant (T70–T73). Its requests leave from Rust; this hook only passes the IPC along.
  const aiTransport = useMemo<AiTransport | null>(() => uiPreview ? previewAiTransport() : desktop ? tauriAiTransport() : null, [desktop])
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
    documentId: document.draftId,
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
  return useStableFunctions({ openBodyMenu, openTabMenu, openEntryMenu, openRootMenu, documentRename, setDocumentRename, confirmDocumentRename, updateSettings, activeEntryToken: document.entryToken, findCapped, queueFind, plain, isPdf, tableView, setTableView, pdfBridge, pdfPages: pdfPages?.id === document.id ? pdfPages.pages : null, selectedDirectory, previewPartial, ai, panel, setPanel, systemFonts, loadSystemFonts, pickStyle, toggleDayNight, latinLayout, style, sourceDark, reading, setReading, lightbox, setLightbox, openImageFromClick, findOptions, findRegexBlocked, setFindOptions, scheduleDerivedRefresh, wordCounts, openSearchHit, runWorkspaceSearch, searchQuery, searchState, setSearchQuery, goToOutlineItem, outlineItems, notice, setNotice, activeConflict, showDiskDiff, useDiskVersion, saveConflictCopyAs, refreshDrafts, diskDiff, setDiskDiff, findOpen, findQuery, setFindQuery, replaceText, setReplaceText, findCount, runFind, findStep, replaceOne, replaceEvery, closeFind, tablePicker, setTablePicker, activeTabKey, adapter, applyLink, busy, checkRoundTrip, chooseWorkspace, closeTabs, closeWorkspace, createEntry, desktop, detachTab, discardDraft, document, draftPreview, drafts, draftsOpen, editorHost, exportPage, exportSnapshotMD, flushSourceText, imageAltOpen, imageAltText, imageInput, imageInputAction, linkHref, linkOpen, loadChildren, newDocument, newEntryName, newEntryType, onPreviewClick, onAnswerClick, openDocument, openTablePickerFromToolbar, openWorkspaceEntry, persistenceLabel, previewDraft, previewHtml, previewPending, previewRoot, recoverDraft, renameEntry, moveEntry, renameName, renaming, reorderTabs, saveDocument, selectSample, selectedEntry, session, sessionRef, setDraftsOpen, setImageAltOpen, setImageAltText, setLinkHref, setLinkOpen, setNewEntryName, setNewEntryType, setRenameName, setRenaming, setSelectedDirectory, setSelectedEntry, setSettingsOpen, setSettingsTab, setSourceView, setStatus, settings, settingsOpen, settingsTab, sidebarOpen, sourceEditor, sourceView: sourceShown, status, switchTab, switchToSource, switchToVisual, t, tabDragRef, tabs, toggleDirectory, toolbar, trashEntry, tree, updateSession, workspaces }, STABLE_EXCEPT)
}

export type DocumentWorkspace = ReturnType<typeof useDocumentWorkspace>
