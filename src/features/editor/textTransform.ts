import type { Mark } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'

export type TextTransform = 'upper' | 'lower' | 'title' | 'cjkSpacing' | 'fullPunct' | 'halfPunct'

const toFull: Record<string, string> = { ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；', '(': '（', ')': '）', '[': '【', ']': '】' }
const toHalf: Record<string, string> = { '，': ',', '。': '.', '？': '?', '！': '!', '：': ':', '；': ';', '（': '(', '）': ')', '【': '[', '】': ']', '“': '"', '”': '"', '‘': "'", '’': "'", '、': ',' }
const cjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u
const latin = /^[A-Za-z0-9]$/
const wordChar = /^[\p{L}\p{N}']$/u

/** 3.14, 1,000, 12:30, example.com, https:// and ... keep their ASCII punctuation. */
function isPartOfToken(previous: string, character: string, next: string): boolean {
  if (!'.,:'.includes(character)) return false
  if (latin.test(previous) && latin.test(next)) return true
  if (character === ':' && next === '/') return true
  return character === '.' && (previous === '.' || next === '.')
}

/** Rewrites contiguous text pieces. Context carries across pieces, since marks can split a word. */
export function transformRun(pieces: string[], kind: Exclude<TextTransform, 'cjkSpacing'>): string[] {
  let previous = ''
  let quoteOpen = false
  return pieces.map((piece, pieceIndex) => {
    const characters = Array.from(piece)
    return characters.map((character, index) => {
      const next = characters[index + 1] ?? Array.from(pieces.slice(pieceIndex + 1).join(''))[0] ?? ''
      let output = character
      if (kind === 'upper') output = character.toUpperCase()
      else if (kind === 'lower') output = character.toLowerCase()
      else if (kind === 'title') output = wordChar.test(previous) ? character.toLowerCase() : character.toUpperCase()
      else if (kind === 'halfPunct') output = toHalf[character] ?? character
      else if (character === '"') { output = quoteOpen ? '”' : '“'; quoteOpen = !quoteOpen }
      else if (toFull[character] && !isPartOfToken(previous, character, next)) output = toFull[character]
      previous = character
      return output
    }).join('')
  })
}

/** UTF-16 offsets where a space belongs between CJK and Latin text. Text already spaced yields none. */
export function cjkSpacingOffsets(text: string): number[] {
  const offsets: number[] = []
  let previous = ''
  let offset = 0
  for (const character of text) {
    if (previous && ((cjk.test(previous) && latin.test(character)) || (latin.test(previous) && cjk.test(character)))) offsets.push(offset)
    previous = character
    offset += character.length
  }
  return offsets
}

type Piece = { from: number; to: number; text: string; marks: readonly Mark[] }

/** Selected text grouped into runs. Code, formulas and other atoms split runs and are left alone. */
function selectedRuns(state: EditorState): Piece[][] {
  const { from, to } = state.selection
  const runs: Piece[][] = []
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    let run: Piece[] = []
    const flush = () => { if (run.length) runs.push(run); run = [] }
    node.forEach((child, offset) => {
      const start = position + 1 + offset
      const end = start + child.nodeSize
      if (end <= from || start >= to || !child.isText || child.marks.some((mark) => mark.type.spec.code)) { flush(); return }
      const pieceFrom = Math.max(start, from)
      const pieceTo = Math.min(end, to)
      run.push({ from: pieceFrom, to: pieceTo, text: (child.text ?? '').slice(pieceFrom - start, pieceTo - start), marks: child.marks })
    })
    flush()
    return false
  })
  return runs
}

function applySpacing(state: EditorState, tr: Transaction, run: Piece[]): void {
  const start = run[0].from
  const pieceAt = (position: number) => run.find((piece) => position >= piece.from && position < piece.to)
  for (const offset of cjkSpacingOffsets(run.map((piece) => piece.text).join('')).reverse()) {
    const position = start + offset
    const left = pieceAt(position - 1)?.marks ?? []
    const right = pieceAt(position)?.marks ?? []
    // A space just inside `**` would stop the delimiter from closing, so it takes only marks on both sides.
    tr.insert(position, state.schema.text(' ', left.filter((mark) => mark.isInSet(right))))
  }
}

function applyRewrite(state: EditorState, tr: Transaction, run: Piece[], kind: Exclude<TextTransform, 'cjkSpacing'>): void {
  const output = transformRun(run.map((piece) => piece.text), kind)
  run.map((piece, index) => ({ piece, text: output[index] })).reverse().forEach(({ piece, text }) => {
    if (text !== piece.text) tr.replaceWith(piece.from, piece.to, state.schema.text(text, piece.marks))
  })
}

/** One undoable change to the selected text, or null when it would change nothing. */
export function textTransformTransaction(state: EditorState, kind: TextTransform): Transaction | null {
  const { selection } = state
  if (selection.empty) return null
  const tr = state.tr
  for (const run of selectedRuns(state).reverse()) {
    if (kind === 'cjkSpacing') applySpacing(state, tr, run)
    else applyRewrite(state, tr, run, kind)
  }
  if (!tr.docChanged) return null
  if (selection instanceof TextSelection) tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(selection.anchor), tr.mapping.map(selection.head)))
  return closeHistory(tr)
}
