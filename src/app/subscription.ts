/**
 * Keeps a Tauri subscription for the life of an effect. `listen` answers later, possibly after the effect has
 * ended; the cleanup this returns stops the subscription either way, so none is left behind.
 */
export function untilCleanup(subscription: Promise<() => void>): () => void {
  let canceled = false
  let stop: (() => void) | undefined
  void subscription.then((unlisten) => { if (canceled) unlisten(); else stop = unlisten })
  return () => { canceled = true; stop?.() }
}
