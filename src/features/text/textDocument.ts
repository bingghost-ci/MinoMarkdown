import type { OutlineItem } from '../outline/outline'

/**
 * Plain text as a reading page (T83). Nothing here parses Markdown: every character of the file is escaped
 * and shown as written, so `#`, `*` and `<` are just characters. The only structure added is paragraphs and
 * chapter headings, and the only tags produced are `div`, `section`, `p`, `br`, `h1` and `h2`.
 */

/** Long texts are cut into sections the browser can leave out of layout while they are off screen. */
export const CHUNK_BLOCKS = 80
export const CHUNKED_FROM_CHARS = 200_000
/** About the first dozen screens, shown while the whole text is prepared. */
export const TEXT_HEAD_CHARS = 48_000

const NUMERAL = '0-9０-９零〇一二两兩三四五六七八九十百千万萬壹贰貳叁參肆伍陆陸柒捌玖拾佰仟'
const chinese = new RegExp(`^第[${NUMERAL}]{1,9}([章回节節卷部篇集幕话話册冊])(?:$|[\\s　:：、.．·\\-—]|[^\\s　，。,；;！!？?]{1,30}$)`)
const special = /^(?:序章|序言|序幕|楔子|引子|引言|前言|后记|後記|尾声|尾聲|终章|終章|番外|外传|外傳|附录|附錄|简介|簡介|内容简介|內容簡介)(?:$|[\s　:：、.．·\-—（(])/
const english = /^(?:(chapter|part|book|volume|section)\s+(?:\d{1,4}|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b|prologue\b|epilogue\b|preface\b|introduction$|foreword\b|afterword\b)/i

/**
 * Whether a line is a chapter title: 1 for a volume or part, 2 for a chapter, null for ordinary text.
 * A title is short and does not end like a sentence, so "第一章的内容是这样的。" stays a paragraph.
 */
export function chapterLevel(line: string): 1 | 2 | null {
  const text = line.trim().replace(/^[　\s]+|[　\s]+$/g, '')
  if (text.length === 0 || text.length > 40 || /[。，,；;]$/.test(text)) return null
  const numbered = chinese.exec(text)
  if (numbered) return '卷部篇集册冊'.includes(numbered[1]) ? 1 : 2
  if (special.test(text)) return 2
  const named = english.exec(text)
  if (named) return named[1] && /^(part|book|volume)$/i.test(named[1]) ? 1 : 2
  return null
}

/** Text as HTML text or an attribute value. Shared with the source-file renderer. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === '"' ? '&quot;' : '&#39;')
}

function linesOf(text: string): string[] {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n|\r/)
}

/**
 * Text wrapped by hand at a fixed width has paragraphs of several short lines with blank lines between
 * them; there the blank lines mark the paragraphs. Otherwise each line is a paragraph of its own, which is
 * how novels and notes saved as text are usually written.
 */
export function isHardWrapped(lines: readonly string[]): boolean {
  let filled = 0
  let long = 0
  let blocks = 0
  let multiLine = 0
  let run = 0
  const close = () => { if (run > 0) { blocks++; if (run > 1) multiLine++ } run = 0 }
  for (const line of lines) {
    if (line.trim() === '') { close(); continue }
    filled++
    run++
    if (line.length > 100) long++
  }
  close()
  return filled >= 4 && long * 20 <= filled && blocks >= 2 && multiLine * 2 >= blocks
}

type Block = { tag: 'p' | 'h1' | 'h2'; html: string; indented: boolean }

function blocksOf(text: string): Block[] {
  const lines = linesOf(text)
  const blocks: Block[] = []
  const heading = (line: string): boolean => {
    const level = chapterLevel(line)
    if (level === null) return false
    blocks.push({ tag: level === 1 ? 'h1' : 'h2', html: escapeHtml(line.trim().replace(/^[　\s]+|[　\s]+$/g, '')), indented: false })
    return true
  }
  if (isHardWrapped(lines)) {
    let paragraph: string[] = []
    const close = () => { if (paragraph.length) blocks.push({ tag: 'p', html: paragraph.map(escapeHtml).join('<br>'), indented: false }); paragraph = [] }
    for (const line of lines) {
      if (line.trim() === '') { close(); continue }
      if (paragraph.length === 0 && heading(line)) continue
      paragraph.push(line.replace(/\s+$/, ''))
    }
    close()
    return blocks
  }
  for (const line of lines) {
    if (line.trim() === '' || heading(line)) continue
    const body = line.replace(/^[ \t　]+/, '').replace(/\s+$/, '')
    if (body) blocks.push({ tag: 'p', html: escapeHtml(body), indented: body.length !== line.replace(/\s+$/, '').length })
  }
  return blocks
}

/** The reading page for a text file. `chunked` is decided by length unless given. */
export function renderTextHtml(text: string, chunked = text.length >= CHUNKED_FROM_CHARS): string {
  const blocks = blocksOf(text).map((block) => block.tag === 'p' ? `<p${block.indented ? ' class="in"' : ''}>${block.html}</p>` : `<${block.tag}>${block.html}</${block.tag}>`)
  if (!chunked) return `<div class="mino-text">${blocks.join('')}</div>`
  const sections: string[] = []
  for (let index = 0; index < blocks.length; index += CHUNK_BLOCKS) sections.push(`<section>${blocks.slice(index, index + CHUNK_BLOCKS).join('')}</section>`)
  return `<div class="mino-text mino-text-long">${sections.join('')}</div>`
}

/**
 * The opening of a long text, cut at a line break, for a first page while the whole is prepared. Null when
 * the text is too short for that to help.
 */
export function textHead(text: string, limit = TEXT_HEAD_CHARS): string | null {
  if (text.length < limit * 2) return null
  const cut = text.lastIndexOf('\n', limit)
  return cut > limit / 4 ? text.slice(0, cut) : null
}

/** Chapter titles with their offsets in the text, for the outline while the source editor is shown. */
export function textOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let offset = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const pattern = /\r\n|\n|\r/g
  for (;;) {
    const found = pattern.exec(text)
    const end = found ? found.index : text.length
    if (end >= offset) {
      const line = text.slice(offset, end)
      const level = line.length <= 120 ? chapterLevel(line) : null
      if (level !== null) items.push({ level, text: line.trim().replace(/^[　\s]+|[　\s]+$/g, ''), target: offset })
    }
    if (!found) break
    offset = found.index + found[0].length
  }
  return items
}
