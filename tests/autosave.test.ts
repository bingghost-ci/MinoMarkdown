import { describe, expect, it } from 'vitest'
import { applyRemoteSettings } from '../src/app/settingsSync'
import { autosaveDecision, type AutosaveState } from '../src/features/document/autosave'
import { beginSave, createSession, editSession, isDirty, saveSucceeded } from '../src/features/document/session'

const ready: AutosaveState = { enabled: true, hasFile: true, dirty: true, persistence: 'idle', stopped: false, conflict: false, busy: false, composing: false, ready: true }

describe('autosave decisions', () => {
  it('saves a ready, dirty document that has a file', () => { expect(autosaveDecision(ready)).toBe('save') })

  it.each([
    ['turned off', { enabled: false }],
    ['untitled', { hasFile: false }],
    ['clean', { dirty: false }],
    ['stopped after a failure', { stopped: true }],
    ['changed on disk', { conflict: true }],
    ['in conflict', { persistence: 'conflict' as const }],
  ])('skips a document that is %s', (_name, change) => { expect(autosaveDecision({ ...ready, ...change })).toBe('skip') })

  it.each([
    ['composing with an IME', { composing: true }],
    ['busy', { busy: true }],
    ['not ready', { ready: false }],
    ['already saving', { persistence: 'saving' as const }],
  ])('waits while %s', (_name, change) => { expect(autosaveDecision({ ...ready, ...change })).toBe('wait') })

  it('never saves over a conflict even when otherwise busy', () => {
    expect(autosaveDecision({ ...ready, conflict: true, busy: true })).toBe('skip')
  })
})

describe('edits made during an autosave', () => {
  it('stay dirty after the save finishes', () => {
    const edited = editSession(createSession(1, 'disk'))
    const { session: saving, ticket } = beginSave(edited)
    const finished = saveSucceeded(editSession(saving), ticket, 'new-disk')
    expect(isDirty(finished)).toBe(true)
  })
})

describe('autosave settings across windows', () => {
  it('apply from another window when this one has no local change', () => {
    const base = { autoSave: false, autoSaveSeconds: 30 }
    const { current } = applyRemoteSettings(base, base, { autoSave: true, autoSaveSeconds: 60 })
    expect(current).toEqual({ autoSave: true, autoSaveSeconds: 60 })
  })
})
