import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Message = { id: number; kind: string; source: string }

/** A worker that records what it is sent and answers only when the test says so. */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onmessageerror: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: Message[] = []
  terminated = false
  constructor() { FakeWorker.instances.push(this) }
  postMessage(message: Message) { this.sent.push(message) }
  terminate() { this.terminated = true }
  reply(data: unknown) { this.onmessage?.({ data }) }
}

const large = 'x'.repeat(5000)

beforeEach(() => {
  FakeWorker.instances = []
  vi.resetModules()
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('analysis worker client', () => {
  it('fails waiting jobs when a reply cannot be read', async () => {
    const client = await import('../src/core/markdown/analysisClient')
    const job = client.mermaidSourcesAsync(large)
    FakeWorker.instances[0].onmessageerror?.()
    await expect(job).rejects.toThrow('WORKER_MESSAGE_ERROR')
  })

  it('does not run a failed job again on the main thread', async () => {
    const client = await import('../src/core/markdown/analysisClient')
    const job = client.prepareMarkdownAsync(large)
    const [message] = FakeWorker.instances[0].sent
    FakeWorker.instances[0].reply({ id: message.id, error: 'PARSE_BOOM' })
    await expect(job).rejects.toThrow('PARSE_BOOM')
  })

  it('falls back to the main thread when the worker is gone', async () => {
    const client = await import('../src/core/markdown/analysisClient')
    const job = client.prepareMarkdownAsync(large)
    FakeWorker.instances[0].onerror?.()
    expect((await job).analysis.mode).toBe('visual')
  })

  it('times a stuck job out, replaces the worker and sends the other jobs again', async () => {
    vi.useFakeTimers()
    const client = await import('../src/core/markdown/analysisClient')
    const stuck = client.mermaidSourcesAsync(large)
    const stuckResult = expect(stuck).rejects.toThrow('WORKER_TIMEOUT')
    await vi.advanceTimersByTimeAsync(client.WORKER_JOB_TIMEOUT_MS / 2)
    const queued = client.mermaidSourcesAsync('```mermaid\ngraph TD\n```\n')
    await vi.advanceTimersByTimeAsync(client.WORKER_JOB_TIMEOUT_MS / 2)
    await stuckResult
    expect(FakeWorker.instances[0].terminated).toBe(true)
    // The queued job went to a new worker and is answered there.
    await vi.advanceTimersByTimeAsync(0)
    const fresh = FakeWorker.instances[1]
    expect(fresh.sent).toHaveLength(1)
    fresh.reply({ id: fresh.sent[0].id, result: ['graph TD'] })
    await expect(queued).resolves.toEqual(['graph TD'])
  })
})
