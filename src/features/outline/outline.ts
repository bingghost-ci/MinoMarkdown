import type { Node as ProseNode } from '@milkdown/kit/prose/model'

/** `target` is a ProseMirror position, a source offset, or a preview heading index, depending on the view. */
export type OutlineItem = { level: number; text: string; target: number }

export function outlineFromDoc(doc: ProseNode): OutlineItem[] {
  const items: OutlineItem[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) items.push({ level: node.attrs.level as number, text: node.textContent.trim(), target: pos })
    return !node.isTextblock
  })
  return items
}

const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/
const setextUnderline = /^ {0,3}(=+|-+)[ \t]*$/

/** A line scan rather than a Markdown parse, so it stays cheap on multi-megabyte source documents. */
export function outlineFromSource(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let offset = source.startsWith('﻿') ? 1 : 0
  const lines = source.slice(offset).split('\n')
  let index = 0
  if (/^---\r?$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)\r?$/.test(line))
    if (close > 0) { for (; index <= close; index++) offset += lines[index].length + 1 }
  }
  let open: { marker: string; length: number } | null = null
  let previous: { text: string; offset: number } | null = null
  for (; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, '')
    const start = offset
    offset += lines[index].length + 1
    const fenceMatch = fence.exec(line)
    if (open) {
      if (fenceMatch && fenceMatch[1][0] === open.marker && fenceMatch[1].length >= open.length && !fenceMatch[2].trim()) open = null
      continue
    }
    if (fenceMatch && !(fenceMatch[1][0] === '`' && fenceMatch[2].includes('`'))) { open = { marker: fenceMatch[1][0], length: fenceMatch[1].length }; previous = null; continue }
    const heading = atxHeading.exec(line)
    if (heading) {
      const text = (heading[2] ?? '').trim()
      if (text) items.push({ level: heading[1].length, text, target: start })
      previous = null
      continue
    }
    const underline = setextUnderline.exec(line)
    if (underline && previous) { items.push({ level: underline[1][0] === '=' ? 1 : 2, text: previous.text, target: previous.offset }); previous = null; continue }
    const plain = line.trim() && !/^ {4}|^\t|^ {0,3}(?:>|[-*+][ \t]|\d+[.)][ \t])/.test(line)
    previous = plain ? { text: line.trim(), offset: start } : null
  }
  return items
}
