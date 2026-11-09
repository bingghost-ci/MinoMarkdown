import { useEffect, useRef, type ReactNode } from 'react'

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/** Moves focus into a modal, keeps Tab inside it, and returns focus when it closes. */
export function FocusTrap({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = root.current
    element?.querySelector<HTMLElement>(focusable)?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !element) return
      const items = Array.from(element.querySelectorAll<HTMLElement>(focusable))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!element.contains(document.activeElement)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true); previous?.focus() }
  }, [])
  return <div ref={root} style={{ display: 'contents' }}>{children}</div>
}
