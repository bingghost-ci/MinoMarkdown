import { useRef } from 'react'

/**
 * A drag handle on the inner edge of a side pane. While dragging, the pane's width is set on the element
 * directly, so the editor is not re-rendered on every pointer move; the width is saved once on release.
 * Arrow keys change the width in steps, and a double click restores the default.
 */
export function PaneResizer({ edge, width, min, max, fallback, label, onCommit }: { edge: 'left' | 'right'; width: number; min: number; max: number; fallback: number; label: string; onCommit: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number; pane: HTMLElement; latest: number } | null>(null)
  const clamp = (value: number) => Math.round(Math.min(max, Math.min(Math.max(min, value), window.innerWidth - 360)))
  return <div className="pane-resizer" data-edge={edge} role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
    onPointerDown={(event) => {
      const pane = event.currentTarget.parentElement
      if (!pane || event.button !== 0) return
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* A pointer that cannot be captured still drags while it stays over the handle. */ }
      drag.current = { x: event.clientX, width: pane.getBoundingClientRect().width, pane, latest: width }
      event.currentTarget.dataset.dragging = 'true'
    }}
    onPointerMove={(event) => {
      const current = drag.current
      if (!current) return
      const delta = event.clientX - current.x
      current.latest = clamp(current.width + (edge === 'right' ? delta : -delta))
      current.pane.style.width = `${current.latest}px`
    }}
    onPointerUp={(event) => {
      const current = drag.current
      drag.current = null
      delete event.currentTarget.dataset.dragging
      if (current && current.latest !== width) onCommit(current.latest)
    }}
    onPointerCancel={(event) => { const current = drag.current; drag.current = null; delete event.currentTarget.dataset.dragging; if (current) current.pane.style.width = `${width}px` }}
    onDoubleClick={() => onCommit(fallback)}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const grow = (event.key === 'ArrowRight') === (edge === 'right')
      onCommit(clamp(width + (grow ? 16 : -16)))
    }} />
}
