import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { pinchedZoom } from '../pinchZoom'

export type Lightbox = { src: string; alt: string } | { svg: string; alt: string; paper: string }

/**
 * An image or a diagram on its own, over the document (T119): it opens at its real size, so a wide diagram
 * that the page had to shrink can be read, and it can be pinched, scrolled about and dragged. A click that
 * was not a drag, or Escape, closes it.
 */
export function ZoomViewer({ lightbox, onClose, t }: { lightbox: Lightbox; onClose: () => void; t: (text: string) => string }) {
  const stage = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const view = useRef({ zoom: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [percent, setPercent] = useState(100)

  const place = (zoom: number, x: number, y: number) => {
    view.current = { zoom, x, y }
    if (content.current) content.current.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    setPercent(Math.round(zoom * 100))
  }
  /** Zooms about a point of the window, so what is under the pointer stays there. */
  const zoomAt = (next: number, clientX: number, clientY: number) => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return
    const { zoom, x, y } = view.current, px = clientX - box.left - box.width / 2, py = clientY - box.top - box.height / 2
    place(next, px - (px - x) * (next / zoom), py - (py - y) * (next / zoom))
  }
  const fit = () => {
    const box = stage.current?.getBoundingClientRect(), size = content.current?.firstElementChild?.getBoundingClientRect()
    if (!box || !size || !(size.width > 0)) return
    const natural = { width: size.width / view.current.zoom, height: size.height / view.current.zoom }
    place(Math.max(0.1, Math.min(4, (box.width - 64) / natural.width, (box.height - 96) / natural.height)), 0, 0)
  }

  useEffect(() => {
    const element = stage.current
    if (!element) return
    // An image larger than the window is fitted; a diagram is shown at its real size, where its text is the size the author sees.
    if ('src' in lightbox) fit(); else place(1, 0, 0)
    let start = 1
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey) zoomAt(Math.max(0.1, Math.min(8, pinchedZoom(view.current.zoom, Math.exp(-event.deltaY * 0.01)))), event.clientX, event.clientY)
      else place(view.current.zoom, view.current.x - event.deltaX, view.current.y - event.deltaY)
    }
    const onGestureStart = (event: Event) => { event.preventDefault(); start = view.current.zoom }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as Event & { scale: number; clientX: number; clientY: number }
      zoomAt(Math.max(0.1, Math.min(8, start * gesture.scale)), gesture.clientX, gesture.clientY)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('gesturestart', onGestureStart)
    element.addEventListener('gesturechange', onGestureChange)
    window.addEventListener('keydown', onKey, true)
    return () => {
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('gesturestart', onGestureStart)
      element.removeEventListener('gesturechange', onGestureChange)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [lightbox])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.zoom-viewer-bar')) return
    drag.current = { x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (!from) return
    const dx = event.clientX - from.x, dy = event.clientY - from.y
    if (!from.moved && Math.hypot(dx, dy) < 4) return
    drag.current = { x: event.clientX, y: event.clientY, moved: true }
    place(view.current.zoom, view.current.x + dx, view.current.y + dy)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = drag.current
    drag.current = null
    if (from && !from.moved && !(event.target as HTMLElement).closest('.zoom-viewer-bar')) onClose()
  }
  const step = (factor: number) => { const box = stage.current?.getBoundingClientRect(); if (box) zoomAt(Math.max(0.1, Math.min(8, view.current.zoom * factor)), box.left + box.width / 2, box.top + box.height / 2) }

  return <div ref={stage} className="zoom-viewer" role="dialog" aria-modal="true" aria-label={lightbox.alt || t('svg' in lightbox ? '查看图表' : '查看图片')} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
    <div ref={content} className="zoom-viewer-content">
      {'src' in lightbox
        ? <img src={lightbox.src} alt={lightbox.alt} draggable={false} />
        // The diagram's own markup, taken from the page, where it was sanitized before it was shown.
        : <div className="zoom-viewer-diagram" style={{ background: lightbox.paper }} dangerouslySetInnerHTML={{ __html: lightbox.svg }} />}
    </div>
    <div className="zoom-viewer-bar" role="toolbar" aria-label={t('缩放')}>
      <button type="button" aria-label={t('缩小')} onClick={() => step(1 / 1.25)}>−</button>
      <output>{percent}%</output>
      <button type="button" aria-label={t('放大')} onClick={() => step(1.25)}>+</button>
      <button type="button" onClick={() => place(1, 0, 0)}>{t('实际大小')}</button>
      <button type="button" onClick={fit}>{t('适合窗口')}</button>
      <button type="button" aria-label={t('关闭')} onClick={onClose}>×</button>
    </div>
  </div>
}
