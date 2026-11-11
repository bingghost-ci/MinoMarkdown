import { prepareMarkdown } from './codec'
import { renderMarkdownPreview } from '../../features/preview/renderMarkdownPreview'
import { renderExport, type ExportPageOptions, type ResolvedImage } from '../../features/export/renderHtml'
import { imageUrlsIn } from '../../features/export/snapshot'
import { mermaidSources } from './diagrams'
import { countWords } from '../../features/document/wordCount'
import { loadCodeParsers } from './highlight'

export type AnalysisRequest = { id: number; kind: 'prepare' | 'preview' | 'export' | 'image-urls' | 'mermaid-sources' | 'word-count'; source: string; assetKey?: string; title?: string; images?: Map<string, ResolvedImage>; diagrams?: Map<string, string>; page?: ExportPageOptions; captions?: boolean }

self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { id, kind, source, assetKey, title, images, diagrams, page, captions } = event.data
  try {
    if (kind === 'word-count') { self.postMessage({ id, result: countWords(source) }); return }
    if (kind === 'mermaid-sources') { self.postMessage({ id, result: mermaidSources(source) }); return }
    if (kind === 'image-urls') { self.postMessage({ id, result: imageUrlsIn(source) }); return }
    if (kind === 'export') { self.postMessage({ id, result: await renderExport(source, title ?? '', async (url) => images?.get(url) ?? null, diagrams, page) }); return }
    if (kind === 'preview') { self.postMessage({ id, result: renderMarkdownPreview(source, assetKey, captions ?? true, await loadCodeParsers(source)) }); return }
    const prepared = prepareMarkdown(source)
    // The AST snapshot is only used by round-trip checks and is expensive to copy between threads.
    self.postMessage({ id, result: { ...prepared, analysis: { ...prepared.analysis, semantics: undefined } } })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
