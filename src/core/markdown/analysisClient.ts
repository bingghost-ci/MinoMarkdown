import { prepareMarkdown, type PreparedMarkdown } from './codec'

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

function run<T>(kind: 'prepare' | 'preview', source: string, assetKey?: string): Promise<T> {
  const target = analysisWorker()
  if (!target) return Promise.reject(new Error('WORKER_UNAVAILABLE'))
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject })
    target.postMessage({ id, kind, source, assetKey })
  })
}

/** Off-thread for anything large enough to be felt; the main thread remains the fallback. */
export async function prepareMarkdownAsync(source: string): Promise<PreparedMarkdown> {
  if (source.length <= SYNC_LIMIT_CHARS) return prepareMarkdown(source)
  try { return await run<PreparedMarkdown>('prepare', source) }
  catch { return prepareMarkdown(source) }
}

export async function renderPreviewAsync(source: string, assetKey?: string): Promise<string> {
  try { return await run<string>('preview', source, assetKey) }
  catch { return (await import('../../features/preview/renderMarkdownPreview')).renderMarkdownPreview(source, assetKey) }
}
