import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_FONT_SIZE, isZoomAction, MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE, zoomedFontSize } from '../src/app/textZoom'

describe('text zoom', () => {
  it('steps by one size', () => {
    expect(zoomedFontSize(15, 'zoom-in')).toBe(16)
    expect(zoomedFontSize(15, 'zoom-out')).toBe(14)
  })

  it('stops at the limits accepted by the settings file', () => {
    expect(zoomedFontSize(MAX_EDITOR_FONT_SIZE, 'zoom-in')).toBe(22)
    expect(zoomedFontSize(MIN_EDITOR_FONT_SIZE, 'zoom-out')).toBe(13)
  })

  it('resets to the default size', () => {
    expect(zoomedFontSize(22, 'zoom-reset')).toBe(DEFAULT_EDITOR_FONT_SIZE)
    expect(DEFAULT_EDITOR_FONT_SIZE).toBe(15)
  })

  it('recognizes only zoom menu actions', () => {
    expect(isZoomAction('zoom-reset')).toBe(true)
    expect(isZoomAction('find')).toBe(false)
  })
})
