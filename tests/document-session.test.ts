import { describe, expect, it } from 'vitest'
import { beginSave, createSession, editSession, externalConflict, isDirty, saveFailed, saveSucceeded } from '../src/features/document/session'

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
})
