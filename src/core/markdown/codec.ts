import { analyzeMarkdown, type DocumentAnalysis } from './compatibility'
import { normalizeAdjacentStrong } from './cjkEmphasis'

export type PreparedMarkdown = {
  analysis: DocumentAnalysis
  editorMarkdown: string
}

export function prepareMarkdown(source: string): PreparedMarkdown {
  const analysis = analyzeMarkdown(new TextEncoder().encode(source))
  return { analysis, editorMarkdown: analysis.mode === 'visual' ? normalizeAdjacentStrong(analysis.body) : source }
}

export function composeVisualMarkdown(analysis: DocumentAnalysis, editorMarkdown: string): string {
  if (analysis.mode !== 'visual') throw new Error('UNSUPPORTED_SYNTAX')
  let body = editorMarkdown.replace(/\r\n/g, '\n')
  if (analysis.trailingNewline && body && !body.endsWith('\n')) body += '\n'
  if (!analysis.trailingNewline && body.endsWith('\n')) body = body.slice(0, -1)
  const normalized = analysis.frontMatter + body
  const withNewlines = analysis.newline === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized
  return (analysis.bom ? '\uFEFF' : '') + withNewlines
}
