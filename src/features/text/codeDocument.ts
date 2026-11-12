import type { Language } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { syntaxClassHighlighter } from '../../core/markdown/syntaxRoles'
import { parseDelimited, type ParsedTable } from './delimited'
import { escapeHtml } from './textDocument'

/**
 * Source and data files as a reading page (T85). The file's text is escaped character by character and only
 * wrapped in spans whose class is a fixed token name, so an `.html` or `.svg` file is shown, never run.
 */

/** Past this size a file is shown without colors; parsing it would hold up the page. */
export const CODE_HIGHLIGHT_LIMIT = 500_000

type Token = { from: number; to: number; classes: string }

function tokensOf(text: string, parser: Language['parser']): Token[] {
  const tokens: Token[] = []
  highlightTree(parser.parse(text), syntaxClassHighlighter, (from, to, classes) => { if (/^[\w -]+$/.test(classes)) tokens.push({ from, to, classes }) })
  return tokens
}

/**
 * One `span.l` per line, numbered by a CSS counter so that copying the text does not copy the numbers.
 * A token that runs over several lines (a block comment, a multi-line string) is closed and reopened at
 * each line break, which keeps every line a complete element.
 */
export function renderCodeHtml(text: string, parser?: Language['parser'] | null): string {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const tokens = parser && source.length <= CODE_HIGHLIGHT_LIMIT ? tokensOf(source, parser) : []
  const lines: string[] = []
  let line = ''
  let position = 0
  const emit = (to: number, classes: string | null) => {
    while (position < to) {
      const hit = source.slice(position, to).search(/\r\n|\n|\r/)
      const end = hit === -1 ? to : position + hit
      if (end > position) line += classes ? `<span class="${classes}">${escapeHtml(source.slice(position, end))}</span>` : escapeHtml(source.slice(position, end))
      if (hit === -1) { position = to; return }
      lines.push(line)
      line = ''
      position = end + (source[end] === '\r' && source[end + 1] === '\n' ? 2 : 1)
    }
  }
  for (const token of tokens) {
    if (token.from < position) continue
    emit(token.from, null)
    emit(token.to, token.classes)
  }
  emit(source.length, null)
  // A final line break ends the last line; it does not start an empty one.
  if (line !== '' || lines.length === 0 || !/[\r\n]$/.test(source)) lines.push(line)
  const digits = String(lines.length).length
  // The line break sits inside its line, so the lines can be blocks and copied text still has its breaks.
  return `<div class="mino-code" style="--line-digits:${digits}"><pre><code>${lines.map((content) => `<span class="l">${content}\n</span>`).join('')}</code></pre></div>`
}

/** A CSV or TSV file as a table: the first row is the header. Cells are text only. */
export function renderTableHtml(table: ParsedTable): string {
  if (table.rows.length === 0) return '<div class="mino-table-file"><p class="mino-table-note">∅</p></div>'
  const cell = (tag: 'th' | 'td', row: string[]) => Array.from({ length: table.columns }, (_, index) => `<${tag}>${escapeHtml(row[index] ?? '')}</${tag}>`).join('')
  const [head, ...body] = table.rows
  const note = table.total > table.rows.length ? `<p class="mino-table-note" data-shown="${table.rows.length}" data-total="${table.total}">${table.rows.length} / ${table.total}</p>` : ''
  return `<div class="mino-table-file">${note}<table><thead><tr>${cell('th', head)}</tr></thead><tbody>${body.map((row) => `<tr>${cell('td', row)}</tr>`).join('')}</tbody></table></div>`
}

export function renderDelimitedHtml(text: string, delimiter: ',' | '\t'): string {
  return renderTableHtml(parseDelimited(text, delimiter))
}
