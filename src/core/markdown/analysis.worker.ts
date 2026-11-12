import { prepareMarkdown } from './codec'
import { renderMarkdownPreview } from '../../features/preview/renderMarkdownPreview'
import { renderExport, type ExportPageOptions, type ResolvedImage } from '../../features/export/renderHtml'
import { imageUrlsIn, rewriteImageUrls } from '../../features/export/snapshot'
import { hydrateMarkdown } from '../../features/document/hydrate'
import { mermaidSources } from './diagrams'
import { countWords } from '../../features/document/wordCount'
import { loadCodeParsers, loadFileParser } from './highlight'
import { loadMathRenderer } from './renderMath'
import { renderTextHtml } from '../../features/text/textDocument'
import { CODE_HIGHLIGHT_LIMIT, renderCodeHtml, renderDelimitedHtml } from '../../features/text/codeDocument'

export type AnalysisRequest = { id: number; kind: 'prepare' | 'hydrate' | 'rewrite-images' | 'preview' | 'export' | 'image-urls' | 'mermaid-sources' | 'word-count' | 'text-preview' | 'code-preview'; source: string; /** The file name of a source file, which selects its language. */ name?: string; /** A CSV or TSV file shown as a table. */ delimiter?: ',' | '\t'; assetKey?: string; title?: string; images?: Map<string, ResolvedImage>; diagrams?: Map<string, string>; page?: ExportPageOptions; captions?: boolean; /** Old image URL to new, for `rewrite-images`. */ replacements?: Map<string, string> }

self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { id, kind, source, assetKey, title, images, diagrams, page, captions, name, delimiter, replacements } = event.data
  try {
    if (kind === 'text-preview') { self.postMessage({ id, result: renderTextHtml(source) }); return }
    if (kind === 'code-preview') { self.postMessage({ id, result: delimiter ? renderDelimitedHtml(source, delimiter) : renderCodeHtml(source, source.length <= CODE_HIGHLIGHT_LIMIT && name ? await loadFileParser(name) : null) }); return }
    if (kind === 'word-count') { self.postMessage({ id, result: countWords(source) }); return }
    if (kind === 'mermaid-sources') { self.postMessage({ id, result: mermaidSources(source) }); return }
    if (kind === 'image-urls') { self.postMessage({ id, result: imageUrlsIn(source) }); return }
    if (kind === 'export') { self.postMessage({ id, result: await renderExport(source, title ?? '', async (url) => images?.get(url) ?? null, diagrams, page) }); return }
    if (kind === 'preview') { self.postMessage({ id, result: renderMarkdownPreview(source, assetKey, captions ?? true, await loadCodeParsers(source), await loadMathRenderer(source)) }); return }
    if (kind === 'hydrate') { self.postMessage({ id, result: hydrateMarkdown(source, assetKey ?? '') }); return }
    if (kind === 'rewrite-images') { self.postMessage({ id, result: rewriteImageUrls(source, replacements ?? new Map()) }); return }
    self.postMessage({ id, result: prepareMarkdown(source) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
