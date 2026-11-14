import { prepareMarkdown, type PreparedMarkdown } from './codec'
import type { AnalysisRequest } from './analysis.worker'
import type { ExportPageOptions, RenderedExport, ResolvedImage } from '../../features/export/renderHtml'
import { countWords, WORD_COUNT_SYNC_LIMIT_CHARS } from '../../features/document/wordCount'
import { hydrateMarkdown, type HydratedMarkdown } from '../../features/document/hydrate'
// These three are part of the app shell already, so importing them lazily would split nothing off.
import { imageUrlsIn, rewriteImageUrls } from '../../features/export/snapshot'
import { renderTextHtml } from '../../features/text/textDocument'
import { mermaidSources } from './diagrams'

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const SYNC_LIMIT_CHARS = 4096
/**
 * The longest one job may take. A 20 MiB export with formulas stays well under it; a worker that has not
 * answered by then is stuck, so it is replaced and the job fails instead of waiting forever.
 */
export const WORKER_JOB_TIMEOUT_MS = 120_000
let worker: Worker | null | undefined
let nextId = 1
const pending = new Map<number, Pending>()

function settle(id: number): Pending | undefined {
  const job = pending.get(id)
  if (!job) return undefined
  pending.delete(id)
  clearTimeout(job.timer)
  return job
}

function rejectAll(message: string): void {
  for (const id of [...pending.keys()]) settle(id)?.reject(new Error(message))
}

function analysisWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    const created = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const job = settle(event.data.id)
      if (!job) return
      if (event.data.error === undefined) job.resolve(event.data.result as never)
      else job.reject(new Error(event.data.error))
    }
    // A reply that cannot be read carries no id, so every job still waiting is failed rather than left hanging.
    created.onmessageerror = () => rejectAll('WORKER_MESSAGE_ERROR')
    created.onerror = () => {
      if (worker === created) worker = null
      rejectAll('WORKER_UNAVAILABLE')
    }
    worker = created
  } catch { worker = null }
  return worker
}

/** Stops a worker that stopped answering. The next job starts a fresh one; the jobs it held are sent again. */
function restartWorker(stuck: Worker): void {
  if (worker !== stuck) return
  stuck.terminate()
  worker = undefined
  rejectAll('WORKER_RESTARTED')
}

function run<T>(kind: AnalysisRequest['kind'], source: string, assetKey?: string, extra: Pick<AnalysisRequest, 'title' | 'images' | 'diagrams' | 'page' | 'captions' | 'name' | 'delimiter' | 'replacements'> = {}): Promise<T> {
  const target = analysisWorker()
  if (!target) return Promise.reject(new Error('WORKER_UNAVAILABLE'))
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const job = settle(id)
      if (!job) return
      job.reject(new Error('WORKER_TIMEOUT'))
      restartWorker(target)
    }, WORKER_JOB_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (value: never) => void, reject, timer })
    try { target.postMessage({ id, kind, source, assetKey, ...extra }) }
    catch (error) { settle(id); reject(error instanceof Error ? error : new Error(String(error))) }
  })
}

/**
 * Only a missing worker falls back to the main thread; a real error, or a job that timed out, reaches the
 * caller, since running the same input on the main thread would fail the same way and freeze the window too.
 * Jobs a restarted worker dropped are sent once more.
 */
async function workerOr<T>(job: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await job() }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'WORKER_UNAVAILABLE') return fallback()
      if (message !== 'WORKER_RESTARTED' || attempt > 0) throw error
    }
  }
}

/** Off-thread for anything large enough to be felt; the main thread remains the fallback. */
export async function prepareMarkdownAsync(source: string): Promise<PreparedMarkdown> {
  if (source.length <= SYNC_LIMIT_CHARS) return prepareMarkdown(source)
  return workerOr(() => run<PreparedMarkdown>('prepare', source), async () => prepareMarkdown(source))
}

/** `prepareMarkdownAsync` plus the rewriting of local image references, which costs a parse of its own (T92). */
export async function hydrateMarkdownAsync(source: string, assetKey: string): Promise<HydratedMarkdown> {
  if (source.length <= SYNC_LIMIT_CHARS) return hydrateMarkdown(source, assetKey)
  return workerOr(() => run<HydratedMarkdown>('hydrate', source, assetKey), async () => hydrateMarkdown(source, assetKey))
}

/** `rewriteImageUrls` off the main thread. An unsafe reference still throws `INVALID_ASSET`. */
export async function rewriteImageUrlsAsync(markdown: string, replacements: ReadonlyMap<string, string>): Promise<string> {
  if (replacements.size === 0) return markdown
  if (markdown.length <= SYNC_LIMIT_CHARS) return rewriteImageUrls(markdown, replacements)
  return workerOr(() => run<string>('rewrite-images', markdown, undefined, { replacements: new Map(replacements) }), async () => rewriteImageUrls(markdown, replacements))
}

export function renderPreviewAsync(source: string, assetKey?: string, captions = true): Promise<string> {
  return workerOr(
    () => run<string>('preview', source, assetKey, { captions }),
    async () => (await import('../../features/preview/renderMarkdownPreview')).renderMarkdownPreview(source, assetKey, captions, undefined, await (await import('./renderMath')).loadMathRenderer(source)),
  )
}

/** The reading page of a text file (T83): escaped text with paragraphs and chapter headings, never Markdown. */
export function renderTextPreviewAsync(source: string): Promise<string> {
  return workerOr(() => run<string>('text-preview', source), async () => renderTextHtml(source))
}

/** The reading page of a source or data file (T85): highlighted lines, or a table when `delimiter` is given. */
export function renderCodePreviewAsync(source: string, name: string, delimiter: ',' | '\t' | null = null): Promise<string> {
  return workerOr(() => run<string>('code-preview', source, undefined, { name, delimiter: delimiter ?? undefined }), async () => {
    const { CODE_HIGHLIGHT_LIMIT, renderCodeHtml, renderDelimitedHtml } = await import('../../features/text/codeDocument')
    if (delimiter) return renderDelimitedHtml(source, delimiter)
    return renderCodeHtml(source, source.length <= CODE_HIGHLIGHT_LIMIT ? await (await import('./highlight')).loadFileParser(name) : null)
  })
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
