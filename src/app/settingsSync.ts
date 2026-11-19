const windowOwnedKeys = new Set(['windowWidth', 'windowHeight'])

/** Settings are plain values; the few that are objects (the custom code colors) are compared by content, since a broadcast always brings a new object. */
function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))
}

/** The fields changed since the last value known to be persisted, or null when nothing changed. */
export function settingsPatch<T extends object>(persisted: T, current: T): Partial<T> | null {
  const patch: Partial<T> = {}
  let changed = false
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (!same(current[key], persisted[key])) { patch[key] = current[key]; changed = true }
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
    if (same(current[key], persisted[key]) && !same(current[key], remote[key])) { nextCurrent[key] = remote[key]; changed = true }
  }
  return { current: changed ? nextCurrent : current, persisted: nextPersisted }
}
