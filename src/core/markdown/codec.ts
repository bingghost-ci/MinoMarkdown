import { analyzeMarkdown, type DocumentAnalysis } from './compatibility'
import { normalizeAdjacentStrong } from './cjkEmphasis'

/** What the app keeps of an analysis. The copies of the document and its syntax tree are dropped: they are large, the caller already holds the text, and nothing reads them afterwards (T92). */
export type PreparedAnalysis = Omit<DocumentAnalysis, 'source' | 'body' | 'serialized' | 'semantics'>

export type PreparedMarkdown = {
  analysis: PreparedAnalysis
  editorMarkdown: string
}

export function prepareMarkdown(source: string): PreparedMarkdown {
  const { source: _source, body, serialized: _serialized, semantics: _semantics, ...analysis } = analyzeMarkdown(new TextEncoder().encode(source))
  return { analysis, editorMarkdown: analysis.mode === 'visual' ? normalizeAdjacentStrong(body) : source }
}

export function composeVisualMarkdown(analysis: PreparedAnalysis, editorMarkdown: string): string {
  if (analysis.mode !== 'visual') throw new Error('UNSUPPORTED_SYNTAX')
  let body = editorMarkdown.replace(/\r\n/g, '\n')
  if (analysis.trailingNewline && body && !body.endsWith('\n')) body += '\n'
  if (!analysis.trailingNewline && body.endsWith('\n')) body = body.slice(0, -1)
  const normalized = analysis.frontMatter + body
  const withNewlines = analysis.newline === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized
  return (analysis.bom ? '\uFEFF' : '') + withNewlines
}
