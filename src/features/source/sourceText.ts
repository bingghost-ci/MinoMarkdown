import { Text } from '@codemirror/state'

export type LineEndings = { eol: '\n' | '\r\n' | '\r'; mixed: boolean }

/** A file with one newline style is edited as clean lines. Mixed files keep each `\r` as a character. */
export function detectLineEndings(text: string): LineEndings {
  if (!text.includes('\r')) return { eol: '\n', mixed: false }
  let crlf = 0
  let lf = 0
  let cr = 0
  for (const [ending] of text.matchAll(/\r\n|\r|\n/g)) {
    if (ending === '\r\n') crlf++
    else if (ending === '\n') lf++
    else cr++
  }
  if (Number(crlf > 0) + Number(lf > 0) + Number(cr > 0) > 1) return { eol: '\n', mixed: true }
  return { eol: crlf > 0 ? '\r\n' : '\r', mixed: false }
}

export function sourceDoc(text: string, endings: LineEndings): Text {
  return Text.of(text.split(endings.mixed ? '\n' : /\r\n?|\n/))
}

export function sourceValue(doc: Text, endings: LineEndings): string {
  return doc.sliceString(0, doc.length, endings.eol)
}

/** CodeMirror counts a line break as one position, while callers hold offsets into the saved string. */
export function positionToOffset(doc: Text, position: number, endings: LineEndings): number {
  const extra = endings.eol.length - 1
  return extra === 0 ? position : position + (doc.lineAt(position).number - 1) * extra
}

export function offsetToPosition(doc: Text, offset: number, endings: LineEndings): number {
  const extra = endings.eol.length - 1
  if (extra === 0) return Math.min(offset, doc.length)
  let low = 1
  let high = doc.lines
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (doc.line(middle).from + (middle - 1) * extra <= offset) low = middle
    else high = middle - 1
  }
  const line = doc.line(low)
  return Math.min(line.from + offset - (line.from + (low - 1) * extra), line.to)
}
