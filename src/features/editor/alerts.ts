import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { alertMarker, type AlertType } from '../../core/markdown/alerts'

/** An alert block quote in the editor: where it is, where its `[!TYPE]` marker is, and its type. */
type FoundAlert = { quote: number; end: number; marker: number; markerEnd: number; type: AlertType }

/**
 * Alert blocks in the editor (T121), drawn with decorations only, so the document is never changed. The quote
 * becomes the tinted card and its `[!TYPE]` marker turns into the card's title; while the caret is on the marker,
 * the marker shows as typed, so it can be edited or removed like any other text.
 */
export function findAlerts(doc: ProseNode): FoundAlert[] {
  const found: FoundAlert[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false
    if (node.type.name !== 'blockquote') return true
    const first = node.firstChild
    const lead = first?.isTextblock ? first.firstChild : null
    const marker = lead?.isText ? alertMarker(lead.text ?? '') : null
    // Two levels in: the quote's opening and its paragraph's opening.
    if (marker) found.push({ quote: pos, end: pos + node.nodeSize, marker: pos + 2, markerEnd: pos + 2 + marker.length, type: marker.type })
    return true
  })
  return found
}

function decorations(state: EditorState, alerts: readonly FoundAlert[]): DecorationSet {
  if (alerts.length === 0) return DecorationSet.empty
  const head = state.selection.head
  const items: Decoration[] = []
  for (const alert of alerts) {
    items.push(Decoration.node(alert.quote, alert.end, { class: `mino-alert mino-alert-${alert.type}` }))
    const editing = head >= alert.marker && head <= alert.markerEnd
    items.push(Decoration.inline(alert.marker, alert.markerEnd, { class: editing ? 'mino-alert-marker is-editing' : 'mino-alert-marker' }))
  }
  return DecorationSet.create(state.doc, items)
}

/** Whether a transaction changed anything inside a block quote, or added or removed one. */
function touchesQuote(tr: Transaction): boolean {
  let touched = false
  const inQuote = (doc: ProseNode, from: number, to: number) => {
    const start = doc.resolve(Math.min(from, doc.content.size))
    for (let depth = start.depth; depth > 0; depth--) if (start.node(depth).type.name === 'blockquote') return true
    let found = false
    doc.nodesBetween(from, Math.min(to, doc.content.size), (node) => { if (node.type.name === 'blockquote') found = true; return !found && !node.isTextblock })
    return found
  }
  tr.mapping.maps.forEach((map, step) => {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => { touched ||= inQuote(tr.docs[step], oldStart, oldEnd) || inQuote(tr.docs[step + 1] ?? tr.doc, newStart, newEnd) })
  })
  return touched
}

const key = new PluginKey<FoundAlert[]>('mino-alerts')

export const alertsPlugin = new Plugin<FoundAlert[]>({
  key,
  state: {
    init: (_, state) => findAlerts(state.doc),
    // Typing outside block quotes only moves the alerts found before, as with the number columns (T96).
    apply: (tr, previous) => {
      if (!tr.docChanged) return previous
      if (touchesQuote(tr)) return findAlerts(tr.doc)
      return previous.map((alert) => ({ ...alert, quote: tr.mapping.map(alert.quote), end: tr.mapping.map(alert.end), marker: tr.mapping.map(alert.marker), markerEnd: tr.mapping.map(alert.markerEnd) }))
    },
  },
  props: { decorations: (state) => decorations(state, key.getState(state) ?? []) },
})
