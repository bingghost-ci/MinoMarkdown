import { describe, expect, it } from 'vitest'
import { createDraftScheduler, type Timers } from '../src/features/document/draftScheduler'

function fakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; run: () => void }>()
  const timers: Timers = {
    now: () => now,
    set: (run, delay) => { pending.set(nextId, { at: now + delay, run }); return nextId++ },
    clear: (id) => { pending.delete(id) },
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...pending.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      pending.delete(due[0]); now = due[1].at; due[1].run()
    }
    now = end
  }
  return { timers, advance }
}

describe('draft scheduler', () => {
  it('waits for quiet before writing', () => {
    const { timers, advance } = fakeTimers()
    let runs = 0
    const scheduler = createDraftScheduler(() => { runs++ }, 1500, 10000, timers)
    scheduler.schedule(); advance(1000); scheduler.schedule(); advance(1000)
    expect(runs).toBe(0)
    advance(500)
    expect(runs).toBe(1)
  })

  it('writes within maxWait during continuous typing', () => {
    const { timers, advance } = fakeTimers()
    let runs = 0
    const scheduler = createDraftScheduler(() => { runs++ }, 1500, 10000, timers)
    for (let elapsed = 0; elapsed < 10000; elapsed += 500) { scheduler.schedule(); advance(500) }
    expect(runs).toBe(1)
  })

  it('cancel drops the pending write and resets maxWait', () => {
    const { timers, advance } = fakeTimers()
    let runs = 0
    const scheduler = createDraftScheduler(() => { runs++ }, 1500, 10000, timers)
    scheduler.schedule(); scheduler.cancel(); advance(20000)
    expect(runs).toBe(0)
  })
})
