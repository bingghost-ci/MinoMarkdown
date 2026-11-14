import { describe, expect, it } from 'vitest'
import { beginSave, createSession, discardChanges, editSession, externalConflict, isDirty, saveFailed, saveSucceeded, withGeneration } from '../src/features/document/session'

describe('document session saves', () => {
  it('keeps later edits dirty when an earlier save returns', () => {
    const first = editSession(createSession(1, 'disk-a'))
    const { session: saving, ticket } = beginSave(first)
    const editedAgain = editSession(saving)
    const completed = saveSucceeded(editedAgain, ticket, 'disk-b')
    expect(completed.savedRevision).toBe(1)
    expect(completed.revision).toBe(2)
    expect(isDirty(completed)).toBe(true)
  })

  it('ignores a late result from the previous document generation', () => {
    const { ticket } = beginSave(editSession(createSession(1)))
    const current = editSession(createSession(2))
    expect(saveSucceeded(current, ticket, 'old-disk')).toEqual(current)
    expect(saveFailed(current, ticket, 'CONFLICT')).toEqual(current)
  })

  it('distinguishes failed and conflicted saves', () => {
    const { session, ticket } = beginSave(editSession(createSession(3)))
    expect(saveFailed(session, ticket, 'IO_ERROR').persistence).toBe('failed')
    expect(saveFailed(session, ticket, 'CONFLICT').persistence).toBe('conflict')
  })

  it('retains dirty content when the disk changes', () => {
    const dirty = editSession(createSession(4, 'base'))
    const conflict = externalConflict(dirty)
    expect(conflict.persistence).toBe('conflict')
    expect(conflict.revision).toBe(dirty.revision)
    expect(isDirty(conflict)).toBe(true)
  })

  it('does not carry a running save into a new generation, so the next save can begin', () => {
    const { session: saving, ticket } = beginSave(editSession(createSession(5, 'disk')))
    const moved = withGeneration(saving, 6)
    expect(moved).toMatchObject({ generation: 6, persistence: 'idle', revision: 1, savedRevision: 0, diskRevision: 'disk' })
    // The old save's answer is ignored, and a new save starts instead of throwing SAVE_IN_PROGRESS.
    expect(saveSucceeded(moved, ticket, 'disk-b')).toEqual(moved)
    expect(() => beginSave(moved)).not.toThrow()
    expect(withGeneration(externalConflict(moved), 7).persistence).toBe('conflict')
  })

  it('leaves nothing dirty after the user discards, so no draft is written for it again', () => {
    const discarded = discardChanges(editSession(editSession(createSession(8))))
    expect(isDirty(discarded)).toBe(false)
    expect(discarded.revision).toBe(2)
  })
})
