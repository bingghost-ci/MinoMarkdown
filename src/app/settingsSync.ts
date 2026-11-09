const windowOwnedKeys = new Set(['windowWidth', 'windowHeight'])

/** The fields changed since the last value known to be persisted, or null when nothing changed. */
export function settingsPatch<T extends object>(persisted: T, current: T): Partial<T> | null {
  const patch: Partial<T> = {}
  let changed = false
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (current[key] !== persisted[key]) { patch[key] = current[key]; changed = true }
  }
  return changed ? patch : null
}

/** Merges settings broadcast by another window. Window size stays per-window and unsaved local edits win. */
export function applyRemoteSettings<T extends object>(current: T, persisted: T, remote: T): { current: T; persisted: T } {
  const nextCurrent = { ...current }
  const nextPersisted = { ...persisted }
  let changed = false
  for (const key of Object.keys(remote) as (keyof T)[]) {
    if (windowOwnedKeys.has(key as string)) continue
    nextPersisted[key] = remote[key]
    if (current[key] === persisted[key] && current[key] !== remote[key]) { nextCurrent[key] = remote[key]; changed = true }
  }
  return { current: changed ? nextCurrent : current, persisted: nextPersisted }
}
