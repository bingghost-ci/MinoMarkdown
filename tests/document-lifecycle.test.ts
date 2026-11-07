import { describe, expect, it, vi } from 'vitest'
import { mayLeaveDocument } from '../src/features/document/lifecycle'

describe('unsaved document lifecycle', () => {
  it('keeps the document open when save is canceled or fails', async () => {
    expect(await mayLeaveDocument('save', async () => false)).toBe(false)
    expect(await mayLeaveDocument('cancel', async () => true)).toBe(false)
  })

  it('only discards after an explicit discard decision', async () => {
    const save = vi.fn(async () => true)
    expect(await mayLeaveDocument('discard', save)).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })
})
