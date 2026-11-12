import { prepareMarkdown, type PreparedMarkdown } from './codec'
import type { AnalysisRequest } from './analysis.worker'
import type { ExportPageOptions, RenderedExport, ResolvedImage } from '../../features/export/renderHtml'
import { countWords, WORD_COUNT_SYNC_LIMIT_CHARS } from '../../features/document/wordCount'
import { hydrateMarkdown, type HydratedMarkdown } from '../../features/document/hydrate'
// These three are part of the app shell already, so importing them lazily would split nothing off.
import { imageUrlsIn, rewriteImageUrls } from '../../features/export/snapshot'
import { renderTextHtml } from '../../features/text/textDocument'
import { mermaidSources } from './diagrams'

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void }

const SYNC_LIMIT_CHARS = 4096
let worker: Worker | null | undefined
let nextId = 1
const pending = new Map<number, Pending>()

function analysisWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const created = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const job = pending.get(event.data.id)
      if (!job) return
      pending.delete(event.data.id)
      if (event.data.error === undefined) job.resolve(event.data.result as never)
      else job.reject(new Error(event.data.error))
    }
    created.onerror = () => {
      worker = null
      for (const job of pending.values()) job.reject(new Error('WORKER_UNAVAILABLE'))
      pending.clear()
    }
    worker = created
  } catch { worker = null }
  return worker
}

function run<T>(kind: AnalysisRequest['kind'], source: string, assetKey?: string, extra: Pick<AnalysisRequest, 'title' | 'images' | 'diagrams' | 'page' | 'captions' | 'name' | 'delimiter' | 'replacements'> = {}): Promise<T> {
  const target = analysisWorker()
  if (!target) return Promise.reject(new Error('WORKER_UNAVAILABLE'))
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject })
    target.postMessage({ id, kind, source, assetKey, ...extra })
  })
}

/** Off-thread for anything large enough to be felt; the main thread remains the fallback. */
export async function prepareMarkdownAsync(source: string): Promise<PreparedMarkdown> {
  if (source.length <= SYNC_LIMIT_CHARS) return prepareMarkdown(source)
  try { return await run<PreparedMarkdown>('prepare', source) }
  catch { return prepareMarkdown(source) }
}

/** `prepareMarkdownAsync` plus the rewriting of local image references, which costs a parse of its own (T92). */
export async function hydrateMarkdownAsync(source: string, assetKey: string): Promise<HydratedMarkdown> {
  if (source.length <= SYNC_LIMIT_CHARS) return hydrateMarkdown(source, assetKey)
  try { return await run<HydratedMarkdown>('hydrate', source, assetKey) }
  catch { return hydrateMarkdown(source, assetKey) }
}

/** `rewriteImageUrls` off the main thread. An unsafe reference still throws `INVALID_ASSET`. */
export async function rewriteImageUrlsAsync(markdown: string, replacements: ReadonlyMap<string, string>): Promise<string> {
  if (replacements.size === 0) return markdown
  if (markdown.length <= SYNC_LIMIT_CHARS) return rewriteImageUrls(markdown, replacements)
  return workerOr(() => run<string>('rewrite-images', markdown, undefined, { replacements: new Map(replacements) }), async () => rewriteImageUrls(markdown, replacements))
}

export async function renderPreviewAsync(source: string, assetKey?: string, captions = true): Promise<string> {
  try { return await run<string>('preview', source, assetKey, { captions }) }
  catch { return (await import('../../features/preview/renderMarkdownPreview')).renderMarkdownPreview(source, assetKey, captions, undefined, await (await import('./renderMath')).loadMathRenderer(source)) }
}

/** The reading page of a text file (T83): escaped text with paragraphs and chapter headings, never Markdown. */
export async function renderTextPreviewAsync(source: string): Promise<string> {
  try { return await run<string>('text-preview', source) }
  catch { return renderTextHtml(source) }
}

/** The reading page of a source or data file (T85): highlighted lines, or a table when `delimiter` is given. */
export async function renderCodePreviewAsync(source: string, name: string, delimiter: ',' | '\t' | null = null): Promise<string> {
  try { return await run<string>('code-preview', source, undefined, { name, delimiter: delimiter ?? undefined }) }
  catch {
    const { CODE_HIGHLIGHT_LIMIT, renderCodeHtml, renderDelimitedHtml } = await import('../../features/text/codeDocument')
    if (delimiter) return renderDelimitedHtml(source, delimiter)
    return renderCodeHtml(source, source.length <= CODE_HIGHLIGHT_LIMIT ? await (await import('./highlight')).loadFileParser(name) : null)
  }
}

/** Only a missing worker falls back to the main thread; a real render error must reach the caller. */
async function workerOr<T>(job: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try { return await job() }
  catch (error) {
    if (error instanceof Error && error.message === 'WORKER_UNAVAILABLE') return fallback()
    throw error
  }
}

/** Source-protected documents can reach 20 MiB, so export rendering stays off the main thread. */
export function renderExportAsync(markdown: string, title: string, images: Map<string, ResolvedImage>, diagrams: Map<string, string>, page: ExportPageOptions = {}): Promise<RenderedExport> {
  return workerOr(
    () => run<RenderedExport>('export', markdown, undefined, { title, images, diagrams, page }),
    async () => (await import('../../features/export/renderHtml')).renderExport(markdown, title, async (url) => images.get(url) ?? null, diagrams, page),
  )
}

export async function imageUrlsInAsync(markdown: string): Promise<string[]> {
  // Every Markdown image contains this marker, so most documents need no round trip at all.
  if (!markdown.includes('![')) return []
  return workerOr(
    () => run<string[]>('image-urls', markdown),
    async () => imageUrlsIn(markdown),
  )
}

export function mermaidSourcesAsync(markdown: string): Promise<string[]> {
  return workerOr(
    () => run<string[]>('mermaid-sources', markdown),
    async () => mermaidSources(markdown),
  )
}

export async function countWordsAsync(text: string): Promise<number> {
  if (text.length <= WORD_COUNT_SYNC_LIMIT_CHARS) return countWords(text)
  return workerOr(() => run<number>('word-count', text), async () => countWords(text))
}
