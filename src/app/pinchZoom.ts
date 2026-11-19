import { useEffect, type RefObject } from 'react'

/**
 * Zooming the reading page with two fingers on the trackpad (T119). The page is scaled with CSS `zoom`, so
 * text, images and diagrams grow together and the page scrolls both ways once it is wider than the window.
 * It is a way of looking, not a setting: it belongs to the window, is not saved, and ⌘0 or a click on the
 * badge puts it back.
 *
 * A pinch arrives as WebKit's `gesturechange`, or as a wheel event with the control key in other engines.
 * Nothing here goes through React state: a pinch fires many times a second.
 */
export const MIN_PINCH_ZOOM = 0.6
export const MAX_PINCH_ZOOM = 3
const SNAP = 0.04

/** The zoom a pinch asks for: kept within bounds, and exactly 1 when it comes close, so "actual size" is easy to find again. */
export function pinchedZoom(from: number, factor: number): number {
  const zoom = Math.max(MIN_PINCH_ZOOM, Math.min(MAX_PINCH_ZOOM, from * factor))
  return Math.abs(zoom - 1) < SNAP ? 1 : Math.round(zoom * 1000) / 1000
}

type GestureEvent = Event & { scale: number; clientX: number; clientY: number }
const panels = new Set<{ reset: () => void }>()
/** Puts every reading page of this window back to actual size. */
export function resetPinchZoom(): void { for (const panel of panels) panel.reset() }

/** Lets the reading page under `panel` be pinched; the zoom is the `--pinch-zoom` variable the style sheet reads. */
export function usePinchZoom(panel: RefObject<HTMLElement | null>, label: (percent: number) => string): void {
  useEffect(() => {
    const element = panel.current
    if (!element) return
    let zoom = 1, start = 1, hide: number | undefined
    const badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'pinch-zoom-badge'
    badge.hidden = true
    element.append(badge)
    const reading = () => element.dataset.reading === 'true'
    const apply = (next: number, x: number, y: number) => {
      if (next === zoom) return
      const scroller = element.querySelector<HTMLElement>('.editor-root')
      const ratio = next / zoom
      zoom = next
      if (zoom === 1) element.style.removeProperty('--pinch-zoom'); else element.style.setProperty('--pinch-zoom', String(zoom))
      // What was under the fingers stays under them.
      if (scroller) {
        const box = scroller.getBoundingClientRect(), px = x - box.left, py = y - box.top
        scroller.scrollLeft = (scroller.scrollLeft + px) * ratio - px
        scroller.scrollTop = (scroller.scrollTop + py) * ratio - py
      }
      badge.textContent = label(Math.round(zoom * 100))
      badge.hidden = false
      window.clearTimeout(hide)
      if (zoom === 1) hide = window.setTimeout(() => { badge.hidden = true }, 900)
    }
    const onGestureStart = (event: Event) => { if (!reading()) return; event.preventDefault(); start = zoom }
    const onGestureChange = (event: Event) => {
      if (!reading()) return
      event.preventDefault()
      const gesture = event as GestureEvent
      apply(pinchedZoom(start, gesture.scale), gesture.clientX, gesture.clientY)
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !reading()) return
      event.preventDefault()
      apply(pinchedZoom(zoom, Math.exp(-event.deltaY * 0.01)), event.clientX, event.clientY)
    }
    const handle = { reset: () => { const box = element.getBoundingClientRect(); apply(1, box.left + box.width / 2, box.top) } }
    panels.add(handle)
    badge.addEventListener('click', handle.reset)
    element.addEventListener('gesturestart', onGestureStart)
    element.addEventListener('gesturechange', onGestureChange)
    element.addEventListener('gestureend', onGestureStart)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      panels.delete(handle)
      window.clearTimeout(hide)
      badge.remove()
      element.style.removeProperty('--pinch-zoom')
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
      element.removeEventListener('gestureend', onGestureStart)
      element.removeEventListener('wheel', onWheel)
    }
  }, [])
}
