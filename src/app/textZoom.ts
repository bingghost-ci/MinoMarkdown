export const MIN_EDITOR_FONT_SIZE = 13
export const MAX_EDITOR_FONT_SIZE = 22
/** The size a new installation starts with and "reset zoom" returns to. `settings.rs` has the same default. */
export const DEFAULT_EDITOR_FONT_SIZE = 15

export type ZoomAction = 'zoom-in' | 'zoom-out' | 'zoom-reset'

export function isZoomAction(action: string): action is ZoomAction {
  return action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset'
}

export function zoomedFontSize(size: number, action: ZoomAction): number {
  if (action === 'zoom-reset') return DEFAULT_EDITOR_FONT_SIZE
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, size + (action === 'zoom-in' ? 1 : -1)))
}
