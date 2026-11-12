export type Persistence = 'idle' | 'saving' | 'failed' | 'conflict'

export type DocumentSession = {
  generation: number
  revision: number
  savedRevision: number
  persistence: Persistence
  diskRevision: string | null
  errorCode: string | null
}

export type SaveTicket = { generation: number; revision: number; diskRevision: string | null }

export function createSession(generation: number, diskRevision: string | null = null): DocumentSession {
  return { generation, revision: 0, savedRevision: 0, persistence: 'idle', diskRevision, errorCode: null }
}

export function isDirty(session: DocumentSession): boolean {
  return session.revision !== session.savedRevision
}

export function editSession(session: DocumentSession): DocumentSession {
  return { ...session, revision: session.revision + 1, persistence: session.persistence === 'conflict' || session.persistence === 'saving' ? session.persistence : 'idle', errorCode: null }
}

export function beginSave(session: DocumentSession): { session: DocumentSession; ticket: SaveTicket } {
  if (session.persistence === 'saving') throw new Error('SAVE_IN_PROGRESS')
  return {
    session: { ...session, persistence: 'saving', errorCode: null },
    ticket: { generation: session.generation, revision: session.revision, diskRevision: session.diskRevision },
  }
}

export function saveSucceeded(session: DocumentSession, ticket: SaveTicket, diskRevision: string): DocumentSession {
  if (session.generation !== ticket.generation) return session
  return {
    ...session,
    savedRevision: Math.max(session.savedRevision, ticket.revision),
    diskRevision,
    persistence: 'idle',
    errorCode: null,
  }
}

export function saveCanceled(session: DocumentSession, ticket: SaveTicket): DocumentSession {
  return session.generation === ticket.generation ? { ...session, persistence: 'idle' } : session
}

export function saveFailed(session: DocumentSession, ticket: SaveTicket, code: string): DocumentSession {
  if (session.generation !== ticket.generation) return session
  return { ...session, persistence: code === 'CONFLICT' ? 'conflict' : 'failed', errorCode: code }
}

/** The user chose to drop unsaved edits, as when the file is moved to the Trash (T105): nothing is dirty any more. */
export function discardChanges(session: DocumentSession): DocumentSession {
  if (session.persistence === 'saving') return session
  return { ...session, savedRevision: session.revision, persistence: 'idle', errorCode: null }
}

export function externalConflict(session: DocumentSession): DocumentSession {
  return { ...session, persistence: 'conflict', errorCode: 'CONFLICT' }
}

export function clearExternalConflict(session: DocumentSession): DocumentSession {
  return session.persistence === 'conflict' ? { ...session, persistence: 'idle', errorCode: null } : session
}
