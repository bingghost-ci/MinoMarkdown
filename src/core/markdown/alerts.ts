import type { Element, Node, Root, Text } from './hast'

/**
 * GitHub's alert blocks (T121): a block quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`
 * or `[!CAUTION]`. The Markdown stays a block quote, so other readers still show it; Mino draws it as a tinted card
 * with an icon and a title. Nothing here changes the document.
 */
export const alertTypes = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertType = (typeof alertTypes)[number]

/** The marker at the very start of a block quote's first paragraph, and the rest of that line (GitHub ignores it). */
export const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?=\n|$)/i

/** The alert a block quote's first text begins with, and the marker's length; null when it is a plain quote. */
export function alertMarker(text: string): { type: AlertType; length: number } | null {
  const match = ALERT_MARKER.exec(text)
  return match ? { type: match[1].toLowerCase() as AlertType, length: match[0].length } : null
}

/** The title shown in place of the marker, by the language of the document. */
export const alertTitles: Record<AlertType, { zh: string; en: string }> = {
  note: { zh: '说明', en: 'Note' },
  tip: { zh: '提示', en: 'Tip' },
  important: { zh: '重要', en: 'Important' },
  warning: { zh: '注意', en: 'Warning' },
  caution: { zh: '警告', en: 'Caution' },
}

/**
 * Turns alert block quotes into `<div class="mino-alert mino-alert-…">` with an empty title paragraph, whose
 * icon and words come from CSS (by the document's `lang`). It runs after sanitizing and only removes the marker
 * text and adds class names, so no markup from the document gets through.
 */
export function rehypeAlerts() {
  return (tree: Root) => {
    const visit = (parent: Root | Element) => {
      for (const child of parent.children) {
        if (child.type !== 'element') continue
        const element = child as Element
        visit(element)
        if (element.tagName !== 'blockquote') continue
        const type = takeMarker(element)
        if (!type) continue
        element.tagName = 'div'
        element.properties = { ...element.properties, className: ['mino-alert', `mino-alert-${type}`] }
        const title: Element = { type: 'element', tagName: 'p', properties: { className: ['mino-alert-title'] }, children: [] }
        element.children.unshift(title as Node)
      }
    }
    visit(tree)
  }
}

/** Removes the marker from the first paragraph and returns its type; a paragraph left empty goes too. */
function takeMarker(quote: Element): AlertType | null {
  const index = quote.children.findIndex((child) => !(child.type === 'text' && (child as Text).value.trim() === ''))
  const first = quote.children[index] as Element | undefined
  if (first?.type !== 'element' || first.tagName !== 'p') return null
  const lead = first.children[0] as Text | undefined
  if (lead?.type !== 'text') return null
  const found = alertMarker(lead.value)
  if (!found) return null
  const rest = lead.value.slice(found.length).replace(/^\n/, '')
  if (rest) lead.value = rest
  else first.children.shift()
  // A line break right after the marker (two spaces or a backslash) would leave an empty first line.
  if ((first.children[0] as Element | undefined)?.tagName === 'br') first.children.shift()
  const remaining = first.children.filter((child) => !(child.type === 'text' && (child as Text).value.trim() === ''))
  if (remaining.length === 0) quote.children.splice(index, 1)
  return found.type
}
