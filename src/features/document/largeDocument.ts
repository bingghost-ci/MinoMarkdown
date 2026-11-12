import type { PreparedAnalysis } from '../../core/markdown/codec'

/**
 * Opening a large document (T77). Reading the file is quick; analyzing it for visual editing and building
 * the editor's DOM is what takes seconds on a long document with many tables and code blocks. A large
 * document that opens in reading mode is therefore shown through the sanitized preview first, its opening
 * pages before the rest, and is analyzed and loaded into the editor only when the user starts editing.
 */
export const QUICK_READ_CHARS = 200_000
/** About the first dozen screens. */
export const HEAD_CHARS = 48_000

export function opensForQuickReading(source: string, opensInReading: boolean): boolean {
  return opensInReading && source.length >= QUICK_READ_CHARS
}

/**
 * Stands in for the analysis until the user edits: the document is shown and saved as its unchanged source,
 * as a source-protected document is, so nothing can be altered before the real analysis has run.
 */
export function quickReadAnalysis(source: string): PreparedAnalysis {
  return { mode: 'source-protected', issues: [], frontMatter: '', bom: false, newline: 'LF', trailingNewline: source.endsWith('\n') }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * The opening part of a long document, for a first preview while the whole is rendered: cut before the last
 * heading within `limit` characters that is outside a code fence, or at the last blank line outside one.
 * Null when the document is too short for this to help or no safe cut exists.
 */
export function previewHead(source: string, limit = HEAD_CHARS): string | null {
  if (source.length < limit * 2) return null
  let fence: { mark: string; length: number } | null = null
  let heading = -1
  let blank = -1
  let start = 0
  while (start < limit) {
    let end = source.indexOf('\n', start)
    if (end === -1) end = source.length
    const line = source.slice(start, source.charCodeAt(end - 1) === 13 ? end - 1 : end)
    const marker = FENCE.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence.mark && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null
    } else if (marker) {
      fence = { mark: marker[1][0], length: marker[1].length }
    } else if (start > 0 && /^#{1,6}(\s|$)/.test(line)) {
      heading = start
    } else if (start > 0 && line.trim() === '') {
      blank = start
    }
    start = end + 1
  }
  const cut = heading > limit / 4 ? heading : Math.max(heading, blank)
  return cut > 0 ? source.slice(0, cut) : null
}
