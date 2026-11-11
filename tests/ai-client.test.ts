import { describe, expect, it } from 'vitest'
import { AiClient, disabledConfig, modelChoices, providerHasKey, suggestedModels, validModel, type AiStreamEvent, type AiTransport } from '../src/features/ai/client'
import type { ChatMessage } from '../src/features/ai/prompts'

type Call = { command: string; args?: Record<string, unknown> }
type Pending = { requestId: string; messages: ChatMessage[]; resolve: () => void; reject: (error: unknown) => void }

/** A transport whose `ai_chat` stays pending until the test settles it, and whose events the test emits. */
function fakeTransport() {
  const calls: Call[] = []
  const pending: Pending[] = []
  const handlers = new Map<string, Set<(payload: never) => void>>()
  let cancelFails = false
  let models: unknown = []
  const transport: AiTransport = {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      if (command === 'ai_chat') {
        const request = args!.request as { requestId: string; messages: ChatMessage[] }
        return new Promise<void>((resolve, reject) => { pending.push({ ...request, resolve, reject }) }) as Promise<T>
      }
      if (command === 'ai_cancel' && cancelFails) return Promise.reject(new Error('AI_INVALID_REQUEST'))
      if (command === 'ai_list_models') return models instanceof Promise ? models as Promise<T> : Promise.resolve(models as T)
      return Promise.resolve(undefined as T)
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      const set = handlers.get(event) ?? new Set()
      handlers.set(event, set)
      set.add(handler as (payload: never) => void)
      return () => { set.delete(handler as (payload: never) => void) }
    },
  }
  const emit = (payload: Partial<AiStreamEvent> & Record<string, unknown>) => handlers.get('ai-stream')?.forEach((handler) => handler(payload as never))
  const delta = (requestId: string, text: string) => emit({ requestId, kind: 'delta', text })
  return { transport, calls, pending, emit, delta, handlers, failCancel: () => { cancelFails = true }, setModels: (value: unknown) => { models = value } }
}

const messages: ChatMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'q' }]

async function started() {
  const fake = fakeTransport()
  const client = new AiClient(fake.transport)
  const stop = await client.listen()
  return { ...fake, client, stop }
}

describe('AI client', () => {
  it('sends the messages with a request ID through ai_chat', async () => {
    const { client, calls, pending } = await started()
    const chat = client.chat(messages)
    expect(calls).toEqual([{ command: 'ai_chat', args: { request: { requestId: chat.requestId, messages } } }])
    pending[0].resolve()
    await expect(chat.done).resolves.toBe('')
  })

  it('accumulates the deltas of its request in order and ignores other requests', async () => {
    const { client, pending, delta, emit } = await started()
    const seen: [string, string][] = []
    const chat = client.chat(messages, (piece, whole) => seen.push([piece, whole]))
    delta(chat.requestId, '春')
    delta('someone-else', '✗')
    delta(chat.requestId, '日')
    delta(`${chat.requestId}x`, '✗')
    delta(chat.requestId, '')
    delta(chat.requestId, '读书')
    // Only text deltas carry text: `done` and `error` events, and malformed deltas, add nothing.
    emit({ requestId: chat.requestId, kind: 'done' })
    emit({ requestId: chat.requestId, kind: 'error', code: 'AI_NETWORK', text: '✗' })
    emit({ requestId: chat.requestId, kind: 'delta' })
    emit({ requestId: chat.requestId, kind: 'delta', text: 42 as unknown as string })
    expect(seen).toEqual([['春', '春'], ['日', '春日'], ['', '春日'], ['读书', '春日读书']])
    pending[0].resolve()
    await expect(chat.done).resolves.toBe('春日读书')
  })

  it('resolves with the whole text only after the command has returned', async () => {
    const { client, pending, delta } = await started()
    const chat = client.chat(messages)
    let settled = false
    void chat.done.then(() => { settled = true }, () => { settled = true })
    delta(chat.requestId, 'a')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(settled).toBe(false)
    pending[0].resolve()
    // An event that was emitted just before the command returned is still delivered.
    queueMicrotask(() => delta(chat.requestId, 'b'))
    await expect(chat.done).resolves.toBe('ab')
    expect(settled).toBe(true)
  })

  it('keeps concurrent chats apart', async () => {
    const { client, pending, delta } = await started()
    const first = client.chat(messages), second = client.chat(messages)
    delta(second.requestId, '二')
    delta(first.requestId, '一')
    delta(second.requestId, '贰')
    pending[1].resolve()
    await expect(second.done).resolves.toBe('二贰')
    delta(first.requestId, '壹')
    pending[0].resolve()
    await expect(first.done).resolves.toBe('一壹')
  })

  it('rejects with the bare error code of the command', async () => {
    for (const [thrown, code] of [
      ['AI_HTTP_401', 'AI_HTTP_401'], [new Error('AI_BUSY'), 'AI_BUSY'], ['AI_CANCELLED', 'AI_CANCELLED'], ['AI_NO_KEY', 'AI_NO_KEY'],
      // Anything that is not a code is a transport failure.
      ['error sending request for url (https://api.example.com/v1)', 'AI_NETWORK'], [new Error('Failed to fetch'), 'AI_NETWORK'], ['', 'AI_NETWORK'], ['ai_http_401', 'AI_NETWORK'], ['A', 'AI_NETWORK'], [`A${'B'.repeat(40)}`, 'AI_NETWORK'],
      ['AI_BUSY\nAI_BUSY', 'AI_NETWORK'], [undefined, 'AI_NETWORK'], [null, 'AI_NETWORK'], [{ code: 'AI_BUSY' }, 'AI_NETWORK'],
    ] as [unknown, string][]) {
      const { client, pending, delta } = await started()
      const chat = client.chat(messages)
      delta(chat.requestId, 'partial')
      pending[0].reject(thrown)
      const error = await chat.done.then(() => null, (reason: unknown) => reason)
      expect(error, String(thrown)).toBeInstanceOf(Error)
      expect((error as Error).message, String(thrown)).toBe(code)
    }
  })

  it('cancels through ai_cancel and never throws', async () => {
    const { client, calls, pending, failCancel } = await started()
    const chat = client.chat(messages)
    await expect(client.cancel(chat.requestId)).resolves.toBeUndefined()
    expect(calls[1]).toEqual({ command: 'ai_cancel', args: { requestId: chat.requestId } })
    failCancel()
    await expect(client.cancel(chat.requestId)).resolves.toBeUndefined()
    await expect(client.cancel('never-started')).resolves.toBeUndefined()
    expect(calls.filter((call) => call.command === 'ai_cancel').length).toBe(3)
    // Cancelling does not settle the chat by itself: the command's own result does.
    pending[0].reject('AI_CANCELLED')
    await expect(chat.done).rejects.toThrow('AI_CANCELLED')
  })

  it('never throws from cancel when the transport itself is gone', async () => {
    const client = new AiClient({ invoke: () => Promise.reject(new Error('window closed')), listen: async () => () => undefined })
    await expect(client.cancel('r1')).resolves.toBeUndefined()
    await expect(client.chat(messages).done).rejects.toThrow('AI_NETWORK')
  })

  it('makes request IDs that the Rust side accepts and that never repeat', async () => {
    const { client, pending } = await started()
    const ids = Array.from({ length: 300 }, () => client.chat(messages).requestId)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(new Set(ids).size).toBe(ids.length)
    const other = new AiClient(fakeTransport().transport)
    expect(ids).not.toContain(other.chat(messages).requestId)
    pending.forEach((chat) => chat.resolve())
  })

  it('forgets a request once it has ended, so a late delta does nothing', async () => {
    const { client, pending, delta } = await started()
    const seen: string[] = []
    const chat = client.chat(messages, (piece) => seen.push(piece))
    delta(chat.requestId, 'a')
    pending[0].resolve()
    await expect(chat.done).resolves.toBe('a')
    delta(chat.requestId, 'late')
    expect(seen).toEqual(['a'])
    await expect(chat.done).resolves.toBe('a')
    const failed = client.chat(messages, (piece) => seen.push(piece))
    pending[1].reject('AI_NETWORK')
    await expect(failed.done).rejects.toThrow('AI_NETWORK')
    delta(failed.requestId, 'late')
    expect(seen).toEqual(['a'])
  })

  it('listens on ai-stream until stopped', async () => {
    const { client, pending, delta, handlers, stop } = await started()
    expect([...handlers.keys()]).toEqual(['ai-stream'])
    expect(handlers.get('ai-stream')!.size).toBe(1)
    const chat = client.chat(messages)
    delta(chat.requestId, 'a')
    stop()
    expect(handlers.get('ai-stream')!.size).toBe(0)
    delta(chat.requestId, 'b')
    pending[0].resolve()
    await expect(chat.done).resolves.toBe('a')
  })

  it('lists the models of the selected provider through ai_list_models, sending nothing else', async () => {
    const fake = fakeTransport()
    const client = new AiClient(fake.transport)
    fake.setModels(['deepseek-chat', 'deepseek-reasoner'])
    await expect(client.listModels()).resolves.toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(fake.calls).toEqual([{ command: 'ai_list_models', args: undefined }])
    // Anything that is not a model id is dropped, and a reply that is not a list is an empty one.
    fake.setModels(['gpt-4o', 7, null, 'has space', '', 'org/model_v1.2:free', { id: 'x' }])
    await expect(client.listModels()).resolves.toEqual(['gpt-4o', 'org/model_v1.2:free'])
    fake.setModels({ data: [] })
    await expect(client.listModels()).resolves.toEqual([])
  })

  it('rejects a failed model list with the bare error code', async () => {
    for (const [thrown, code] of [['AI_NO_KEY', 'AI_NO_KEY'], [new Error('AI_HTTP_401'), 'AI_HTTP_401'], ['AI_BAD_RESPONSE', 'AI_BAD_RESPONSE'], ['connection reset by peer', 'AI_NETWORK'], [undefined, 'AI_NETWORK']] as [unknown, string][]) {
      const fake = fakeTransport()
      const rejected = Promise.reject(thrown)
      rejected.catch(() => undefined)
      fake.setModels(rejected)
      const error = await new AiClient(fake.transport).listModels().then(() => null, (reason: unknown) => reason)
      expect(error, String(thrown)).toBeInstanceOf(Error)
      expect((error as Error).message, String(thrown)).toBe(code)
    }
  })

  it('offers a short list of suggestions per provider and accepts any model id', () => {
    expect(suggestedModels).toEqual({ deepseek: ['deepseek-chat', 'deepseek-reasoner'], openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'], custom: [] })
    expect(modelChoices('deepseek')).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    // Suggestions come first; what the service listed follows without repeats.
    expect(modelChoices('openai', ['gpt-4.1', 'gpt-5', 'gpt-4o', 'o4-mini', 'gpt-5'])).toEqual(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5', 'o4-mini'])
    expect(modelChoices('custom', ['qwen2.5:7b', 'bad id'])).toEqual(['qwen2.5:7b'])
    for (const model of ['deepseek-chat', 'gpt-4o-mini', 'qwen2.5:7b', 'org/model_v1.2', 'ft:gpt-4o:org/custom', 'm'.repeat(100)]) expect(validModel(model), model).toBe(true)
    for (const model of ['', 'gpt 4', '模型', 'a"b', 'a\n', 'm'.repeat(101)]) expect(validModel(model), model).toBe(false)
  })

  it('reads the key status of each provider', () => {
    const config = { ...disabledConfig, provider: 'openai' as const, hasKey: true, keys: { deepseek: false, openai: true, custom: true } }
    expect([providerHasKey(config, 'deepseek'), providerHasKey(config, 'openai'), providerHasKey(config, 'custom')]).toEqual([false, true, true])
    // A configuration without the per-provider status only knows about the selected provider.
    const old = { ...config, keys: undefined } as unknown as typeof config
    expect([providerHasKey(old, 'deepseek'), providerHasKey(old, 'openai'), providerHasKey(old, 'custom')]).toEqual([false, true, false])
  })

  it('starts disabled, without consent or a key, on an https address', () => {
    expect(disabledConfig).toMatchObject({ enabled: false, consented: false, hasKey: false, keys: { deepseek: false, openai: false, custom: false } })
    expect(disabledConfig.baseUrl).toMatch(/^https:\/\//)
  })
})
