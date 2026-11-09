import { prepareMarkdown } from './codec'
import { renderMarkdownPreview } from '../../features/preview/renderMarkdownPreview'

export type AnalysisRequest = { id: number; kind: 'prepare' | 'preview'; source: string; assetKey?: string }

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, kind, source, assetKey } = event.data
  try {
    if (kind === 'preview') { self.postMessage({ id, result: renderMarkdownPreview(source, assetKey) }); return }
    const prepared = prepareMarkdown(source)
    // The AST snapshot is only used by round-trip checks and is expensive to copy between threads.
    self.postMessage({ id, result: { ...prepared, analysis: { ...prepared.analysis, semantics: undefined } } })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
