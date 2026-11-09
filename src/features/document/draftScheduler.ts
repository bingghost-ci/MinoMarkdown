export type Timers = {
  now: () => number
  set: (run: () => void, delay: number) => number
  clear: (id: number) => void
}

const browserTimers: Timers = {
  now: () => performance.now(),
  set: (run, delay) => window.setTimeout(run, delay),
  clear: (id) => window.clearTimeout(id),
}

export type DraftScheduler = { schedule: () => void; cancel: () => void }

/** Runs after `delay` of quiet, but never later than `maxWait` after the first unsaved change. */
export function createDraftScheduler(run: () => void, delay: number, maxWait: number, timers: Timers = browserTimers): DraftScheduler {
  let timer: number | null = null
  let firstScheduledAt: number | null = null
  const cancel = () => {
    if (timer !== null) timers.clear(timer)
    timer = null
    firstScheduledAt = null
  }
  return {
    cancel,
    schedule() {
      const now = timers.now()
      firstScheduledAt ??= now
      if (timer !== null) timers.clear(timer)
      const remaining = Math.max(0, firstScheduledAt + maxWait - now)
      timer = timers.set(() => { cancel(); run() }, Math.min(delay, remaining))
    },
  }
}
