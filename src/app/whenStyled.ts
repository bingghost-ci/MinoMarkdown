/** How long a window that is still hidden waits for a frame before it goes on without one. */
const HIDDEN_FRAME_WAIT_MS = 40

/**
 * Runs `action` once the page has had the chance to draw with the styles just applied. A window that has not been
 * shown yet gets no animation frames from WebKit, so waiting for frames alone would hold it until the 4 s fallback
 * in `windows.rs` showed it; the timer ends the wait there. Whichever comes first runs `action`, once.
 */
export function whenStyled(action: () => void): void {
  let done = false
  const run = () => { if (!done) { done = true; action() } }
  requestAnimationFrame(() => requestAnimationFrame(run))
  window.setTimeout(run, HIDDEN_FRAME_WAIT_MS)
}
