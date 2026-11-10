import type { Persistence } from './session'

export type AutosaveState = {
  enabled: boolean
  hasFile: boolean
  dirty: boolean
  persistence: Persistence
  stopped: boolean
  conflict: boolean
  busy: boolean
  composing: boolean
  ready: boolean
}

/** `wait` means try again later; `skip` means there is nothing autosave may do until the state changes. */
export function autosaveDecision(state: AutosaveState): 'save' | 'wait' | 'skip' {
  if (!state.enabled || !state.hasFile || !state.dirty || state.stopped || state.conflict || state.persistence === 'conflict') return 'skip'
  if (state.busy || state.composing || !state.ready || state.persistence === 'saving') return 'wait'
  return 'save'
}
