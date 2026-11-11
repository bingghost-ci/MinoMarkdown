// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAiAssistant, type AiAssistant, type AiAssistantInput, type AiSelection, type InsertPlacement } from '../src/app/aiAssistant'
import { previewAiTransport } from '../src/app/previewSample'
import { AiClient, type AiConfig, type AiProvider, type AiTransport } from '../src/features/ai/client'
import { aiErrorText, CONTEXT_BUDGET, MAX_SUMMARY_PARTS, presets, selectionActions, type ChatMessage } from '../src/features/ai/prompts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChatRequest = { requestId: string; messages: ChatMessage[] }
type Reply = string | string[] | { error: unknown } | 'pending'
type Call = { command: string; args?: Record<string, unknown> }

const enabled: AiConfig = { enabled: true, consented: true, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: true, keys: { deepseek: true, openai: false, custom: false } }

/**
 * Stands in for the Rust commands. Each `ai_chat` takes the next scripted reply: text is streamed as
 * deltas before the command returns, an error rejects, and `pending` waits for the test (or for
 * `ai_cancel`, which ends the stream with AI_CANCELLED as ai.rs does).
 */
function fakeBackend(initial: Partial<AiConfig> = {}) {
  let config: AiConfig = { ...enabled, ...initial }
  if (!initial.keys) config.keys = { ...config.keys, [config.provider]: config.hasKey }
  const models: (string[] | { error: unknown } | 'pending')[] = []
  const modelWaiting: { resolve: (ids: string[]) => void; reject: (error: unknown) => void }[] = []
  const calls: Call[] = []
  const chats: ChatRequest[] = []
  const replies: Reply[] = []
  const handlers = new Map<string, Set<(payload: never) => void>>()
  const waiting = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>()
  let failNext: string | null = null
  const emit = (event: string, payload: unknown) => handlers.get(event)?.forEach((handler) => handler(payload as never))
  const delta = (requestId: string, text: string) => emit('ai-stream', { requestId, kind: 'delta', text })
  const transport: AiTransport = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args })
      if (failNext && command !== 'ai_chat' && command !== 'ai_cancel' && command !== 'ai_get_config') { const code = failNext; failNext = null; throw code }
      if (command === 'ai_set_config') config = { ...config, ...(args!.patch as Partial<AiConfig>) }
      if (command === 'ai_set_key' || command === 'ai_clear_key') {
        const keys = { ...config.keys, [(args?.provider as AiProvider | undefined) ?? config.provider]: command === 'ai_set_key' }
        config = { ...config, keys, hasKey: keys[config.provider] }
      }
      if (command === 'ai_set_config') config = { ...config, hasKey: config.keys[config.provider] }
      if (command === 'ai_list_models') {
        const reply = models.length ? models.shift()! : ['deepseek-chat', 'deepseek-reasoner']
        if (reply === 'pending') return new Promise<string[]>((resolve, reject) => { modelWaiting.push({ resolve, reject }) }) as Promise<T>
        if (!Array.isArray(reply)) throw reply.error
        return reply as T
      }
      if (command === 'ai_cancel') { waiting.get(args!.requestId as string)?.reject('AI_CANCELLED'); return undefined as T }
      if (command === 'ai_chat') {
        const request = args!.request as ChatRequest
        chats.push(request)
        const reply = replies.length ? replies.shift()! : '好的。'
        if (reply === 'pending') return new Promise<void>((resolve, reject) => { waiting.set(request.requestId, { resolve, reject }) }).finally(() => waiting.delete(request.requestId)) as Promise<T>
        if (typeof reply === 'object' && !Array.isArray(reply)) throw reply.error
        for (const piece of Array.isArray(reply) ? reply : [reply]) delta(request.requestId, piece)
        return undefined as T
      }
      return config as T
    },
    async listen<T>(event: string, handler: (payload: T) => void) {
      const set = handlers.get(event) ?? new Set()
      handlers.set(event, set)
      set.add(handler as (payload: never) => void)
      return () => { set.delete(handler as (payload: never) => void) }
    },
  }
  return {
    transport, calls, chats, replies, handlers, emit, delta, models, modelWaiting,
    finish: (requestId: string) => waiting.get(requestId)?.resolve(),
    fail: (requestId: string, error: unknown) => waiting.get(requestId)?.reject(error),
    failNextCommand: (code: string) => { failNext = code },
    commands: (name: string) => calls.filter((call) => call.command === name),
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
/** Lets effects, the client's end-of-stream timer and the answer's rendering settle. */
const settle = () => act(async () => { for (let index = 0; index < 12; index++) await tick() })

let root: Root | null = null
let container: HTMLElement | null = null
function unmount() {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
}
afterEach(unmount)

type Harness = {
  ai: () => AiAssistant
  status: string[]
  inserted: [string, InsertPlacement][]
  rendered: string[]
  state: { document: { title: string; markdown: string }; headings: { level: number; text: string }[]; selection: AiSelection | null; insertError: Error | null; renderFails: boolean }
  rerender: (overrides: Partial<AiAssistantInput>) => void
}

async function mount(transport: AiTransport | null, overrides: Partial<AiAssistantInput> = {}): Promise<Harness> {
  const status: string[] = [], inserted: [string, InsertPlacement][] = [], rendered: string[] = []
  const state: Harness['state'] = { document: { title: '春日读书记', markdown: '# 春日读书记\n\n读书是一件安静的事。\n' }, headings: [{ level: 1, text: '春日读书记' }, { level: 2, text: '阅读的节奏' }, { level: 2, text: '数据与代码' }], selection: null, insertError: null, renderFails: false }
  let latest!: AiAssistant
  let props: AiAssistantInput = {
    transport, documentId: 1, language: 'zh-CN',
    getDocument: () => state.document,
    getHeadings: () => state.headings,
    getSelection: () => state.selection,
    renderMarkdown: async (markdown) => { rendered.push(markdown); if (state.renderFails) throw new Error('RENDER'); return `<p>${markdown}</p>` },
    insertMarkdown: (markdown, placement) => { if (state.insertError) throw state.insertError; inserted.push([markdown, placement]) },
    onStatus: (message) => { status.push(message) },
    ...overrides,
  }
  function Probe(input: AiAssistantInput) { latest = useAiAssistant(input); return null }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const render = () => act(() => { root!.render(createElement(Probe, props)) })
  render()
  await settle()
  return { ai: () => latest, status, inserted, rendered, state, rerender: (next) => { props = { ...props, ...next }; render() } }
}

const run = async (action: () => unknown) => { await act(async () => { await action() }); await settle() }
const roles = (messages: ChatMessage[]) => messages.map((message) => message.role)

describe('AI assistant', () => {
  it('reads the configuration when it starts and listens for stream and configuration events', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    expect(backend.calls).toEqual([{ command: 'ai_get_config', args: undefined }])
    expect([...backend.handlers.keys()].sort()).toEqual(['ai-config-changed', 'ai-stream'])
    expect(ai().available).toBe(true)
    expect(ai().config).toEqual(enabled)
    expect(ai().open).toBe(false)
    expect(ai().turns).toEqual([])
    expect(ai().busy).toBe(false)
    unmount()
    expect([...backend.handlers.values()].map((set) => set.size)).toEqual([0, 0])
  })

  it('is unavailable without a transport and then does nothing', async () => {
    const { ai, status } = await mount(null)
    expect(ai().available).toBe(false)
    expect(ai().config.enabled).toBe(false)
    await run(() => ai().ask('这篇讲了什么？'))
    await run(() => ai().runPreset('summary'))
    await run(() => ai().refreshSuggestions())
    await run(() => ai().setKey('sk-x'))
    act(() => ai().toggleOpen())
    expect(ai().turns).toEqual([])
    expect(ai().open).toBe(false)
    expect(status).toEqual([])
  })

  it('does not ask while AI is off, and says where to switch it on', async () => {
    const backend = fakeBackend({ enabled: false, consented: false })
    const { ai, status } = await mount(backend.transport)
    await run(() => ai().ask('这篇讲了什么？'))
    expect(status).toEqual([aiErrorText('AI_DISABLED')])
    expect(backend.chats).toEqual([])
    expect(ai().turns).toEqual([])
    expect(ai().consentOpen).toBe(false)
    act(() => ai().toggleOpen())
    expect(ai().open).toBe(false)
    await run(() => ai().runPreset('points'))
    await run(() => ai().refreshSuggestions())
    expect(backend.chats).toEqual([])
  })

  it('asks for consent before the first request and sends nothing until it is given', async () => {
    const backend = fakeBackend({ enabled: true, consented: false })
    const { ai, status } = await mount(backend.transport)
    await run(() => ai().ask('这篇讲了什么？'))
    expect(ai().consentOpen).toBe(true)
    expect(backend.chats).toEqual([])
    expect(ai().turns).toEqual([])
    expect(status).toEqual([])
    act(() => ai().setConsentOpen(false))
    act(() => ai().toggleOpen())
    expect(ai().consentOpen).toBe(true)
    expect(ai().open).toBe(false)
    await run(() => ai().refreshSuggestions())
    expect(backend.chats).toEqual([])
  })

  it('switches on through the consent notice and saves both flags when it is confirmed', async () => {
    const backend = fakeBackend({ enabled: false, consented: false })
    const { ai, status } = await mount(backend.transport)
    act(() => ai().setEnabled(true))
    expect(ai().consentOpen).toBe(true)
    expect(backend.commands('ai_set_config')).toEqual([])
    expect(ai().config.enabled).toBe(false)
    await run(() => ai().confirmConsent())
    expect(backend.commands('ai_set_config')).toEqual([{ command: 'ai_set_config', args: { patch: { enabled: true, consented: true } } }])
    expect(ai().consentOpen).toBe(false)
    expect(ai().config).toMatchObject({ enabled: true, consented: true })
    expect(status).toEqual([])
    // Switching off needs no notice.
    await run(() => ai().setEnabled(false))
    expect(backend.commands('ai_set_config')[1].args).toEqual({ patch: { enabled: false } })
    expect(ai().config.enabled).toBe(false)
    expect(ai().consentOpen).toBe(false)
  })

  it('keeps the consent notice open and reports the error when saving fails', async () => {
    const backend = fakeBackend({ enabled: false, consented: false })
    const { ai, status } = await mount(backend.transport)
    act(() => ai().setEnabled(true))
    backend.failNextCommand('AI_INVALID_CONFIG')
    await run(() => ai().confirmConsent())
    expect(ai().consentOpen).toBe(true)
    expect(ai().config.enabled).toBe(false)
    expect(status).toEqual([aiErrorText('AI_INVALID_CONFIG')])
  })

  it('saves the key and the service settings through their commands', async () => {
    const backend = fakeBackend({ hasKey: false })
    const { ai, status } = await mount(backend.transport)
    await run(async () => expect(await ai().setKey('sk-secret')).toBe(true))
    expect(backend.commands('ai_set_key')).toEqual([{ command: 'ai_set_key', args: { key: 'sk-secret' } }])
    expect(ai().config.hasKey).toBe(true)
    await run(() => ai().clearKey())
    expect(ai().config.hasKey).toBe(false)
    await run(() => ai().saveConfig({ provider: 'custom', baseUrl: 'https://llm.example.com/v1', model: 'm' }))
    expect(ai().config).toMatchObject({ provider: 'custom', baseUrl: 'https://llm.example.com/v1', model: 'm' })
    backend.failNextCommand('AI_KEYCHAIN')
    await run(async () => expect(await ai().setKey('sk-other')).toBe(false))
    expect(status).toEqual([aiErrorText('AI_KEYCHAIN')])
    // The key is never kept in the hook's state.
    expect(JSON.stringify(ai().config)).not.toContain('sk-')
  })

  it('saves and clears the key of any provider and reports the status of each', async () => {
    const backend = fakeBackend({ hasKey: false })
    const { ai } = await mount(backend.transport)
    expect(ai().config.keys).toEqual({ deepseek: false, openai: false, custom: false })
    // The key of a provider that is not selected: `hasKey` stays with the selected one.
    await run(async () => expect(await ai().setKey('sk-openai', 'openai')).toBe(true))
    expect(backend.commands('ai_set_key')).toEqual([{ command: 'ai_set_key', args: { key: 'sk-openai', provider: 'openai' } }])
    expect(ai().config).toMatchObject({ provider: 'deepseek', hasKey: false, keys: { deepseek: false, openai: true, custom: false } })
    await run(() => ai().setKey('sk-deepseek', 'deepseek'))
    expect(ai().config).toMatchObject({ hasKey: true, keys: { deepseek: true, openai: true, custom: false } })
    await run(() => ai().clearKey('openai'))
    expect(backend.commands('ai_clear_key')).toEqual([{ command: 'ai_clear_key', args: { provider: 'openai' } }])
    expect(ai().config).toMatchObject({ hasKey: true, keys: { deepseek: true, openai: false, custom: false } })
    // Without a provider the selected one is meant, and no provider is sent.
    await run(() => ai().clearKey())
    expect(backend.commands('ai_clear_key')[1]).toEqual({ command: 'ai_clear_key', args: undefined })
    expect(ai().config).toMatchObject({ hasKey: false, keys: { deepseek: false, openai: false, custom: false } })
    expect(JSON.stringify(ai().config)).not.toContain('sk-')
  })

  it('fetches the model list of the selected provider and shows that it is fetching', async () => {
    const backend = fakeBackend()
    const { ai, status } = await mount(backend.transport)
    expect(ai()).toMatchObject({ fetchedModels: null, modelsBusy: false, modelsError: null })
    backend.models.push('pending')
    let fetching!: Promise<boolean>
    await run(() => { fetching = ai().fetchModels() })
    expect(ai()).toMatchObject({ fetchedModels: null, modelsBusy: true, modelsError: null })
    // A second click while one request runs sends nothing.
    await run(async () => expect(await ai().fetchModels()).toBe(false))
    expect(backend.commands('ai_list_models')).toEqual([{ command: 'ai_list_models', args: undefined }])
    backend.modelWaiting[0].resolve(['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'])
    await run(async () => expect(await fetching).toBe(true))
    expect(ai()).toMatchObject({ fetchedModels: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'], modelsBusy: false, modelsError: null })
    // Fetching a list is not a question: no chat is sent and nothing is reported in the status bar.
    expect(backend.chats).toEqual([])
    expect(status).toEqual([])
  })

  it('reports a failed model list as a readable error and clears it on the next attempt', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    backend.models.push({ error: 'AI_HTTP_401' }, { error: new Error('socket hang up') }, ['deepseek-chat'])
    await run(async () => expect(await ai().fetchModels()).toBe(false))
    expect(ai()).toMatchObject({ fetchedModels: null, modelsBusy: false, modelsError: aiErrorText('AI_HTTP_401') })
    await run(() => ai().fetchModels())
    expect(ai().modelsError).toBe(aiErrorText('AI_NETWORK'))
    await run(() => ai().fetchModels())
    expect(ai()).toMatchObject({ fetchedModels: ['deepseek-chat'], modelsError: null })
  })

  it('keeps a fetched list and its error with the provider they came from', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    await run(() => ai().fetchModels())
    expect(ai().fetchedModels).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    await run(() => ai().saveConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }))
    expect(ai().fetchedModels).toBeNull()
    backend.models.push({ error: 'AI_NO_KEY' })
    await run(() => ai().fetchModels())
    expect(ai().modelsError).toBe(aiErrorText('AI_NO_KEY'))
    await run(() => ai().saveConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }))
    expect(ai().modelsError).toBeNull()
  })

  it('saves a model that is picked or typed, whether or not it is a suggestion', async () => {
    const backend = fakeBackend()
    const { ai, status } = await mount(backend.transport)
    await run(async () => expect(await ai().pickModel('deepseek-reasoner')).toBe(true))
    expect(backend.commands('ai_set_config')).toEqual([{ command: 'ai_set_config', args: { patch: { model: 'deepseek-reasoner' } } }])
    expect(ai().config.model).toBe('deepseek-reasoner')
    await run(() => ai().pickModel('  my-org/fine-tuned_v2.1:latest '))
    expect(ai().config.model).toBe('my-org/fine-tuned_v2.1:latest')
    // The model already in use and an empty name send nothing.
    await run(async () => expect(await ai().pickModel('my-org/fine-tuned_v2.1:latest')).toBe(true))
    await run(async () => expect(await ai().pickModel('   ')).toBe(false))
    expect(backend.commands('ai_set_config')).toHaveLength(2)
    // A name the backend refuses is reported and the model stays.
    backend.failNextCommand('AI_INVALID_CONFIG')
    await run(async () => expect(await ai().pickModel('has space')).toBe(false))
    expect(ai().config.model).toBe('my-org/fine-tuned_v2.1:latest')
    expect(status).toEqual([aiErrorText('AI_INVALID_CONFIG')])
  })

  it('shows the question and streams the answer, then renders it', async () => {
    const backend = fakeBackend()
    const { ai, rendered } = await mount(backend.transport)
    backend.replies.push('pending')
    let asking!: Promise<void>
    act(() => { asking = ai().ask('  这篇讲了什么？ ') as Promise<void> })
    await settle()
    expect(ai().busy).toBe(true)
    expect(ai().turns.map((turn) => [turn.role, turn.text, turn.status])).toEqual([['user', '这篇讲了什么？', 'done'], ['assistant', '', 'streaming']])
    const { requestId, messages } = backend.chats[0]
    expect(roles(messages)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messages[0].content).toContain('《春日读书记》')
    expect(messages[1].content).toBe('<document>\n# 春日读书记\n\n读书是一件安静的事。\n\n</document>')
    expect(messages[3].content).toBe('这篇讲了什么？')
    act(() => backend.delta(requestId, '讲的是'))
    expect(ai().turns[1]).toMatchObject({ text: '讲的是', status: 'streaming' })
    act(() => { backend.delta('another-request', '✗'); backend.delta(requestId, '**读书**。') })
    expect(ai().turns[1]).toMatchObject({ text: '讲的是**读书**。', status: 'streaming' })
    expect(ai().turns[1].html).toBeUndefined()
    // A second question waits for the first.
    await run(() => ai().ask('另一个问题'))
    expect(backend.chats.length).toBe(1)
    expect(ai().turns.length).toBe(2)
    act(() => backend.finish(requestId))
    await act(async () => { await asking })
    await settle()
    expect(ai().busy).toBe(false)
    expect(ai().turns[1]).toMatchObject({ role: 'assistant', text: '讲的是**读书**。', status: 'done', html: '<p>讲的是**读书**。</p>' })
    expect(ai().turns[1].note).toBeUndefined()
    expect(ai().turns[1].error).toBeUndefined()
    expect(rendered).toEqual(['讲的是**读书**。'])
    expect(new Set(ai().turns.map((turn) => turn.id)).size).toBe(2)
  })

  it('sends the finished turns of the conversation with the next question', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    backend.replies.push(['第一个', '回答'], { error: 'AI_HTTP_500' }, '第三个回答')
    await run(() => ai().ask('第一个问题'))
    await run(() => ai().ask('第二个问题'))
    await run(() => ai().ask('第三个问题'))
    expect(ai().turns.map((turn) => turn.status)).toEqual(['done', 'done', 'done', 'error', 'done', 'done'])
    // A failed answer is left out together with its question, so roles keep alternating.
    expect(backend.chats[2].messages.slice(3)).toEqual([
      { role: 'user', content: '第一个问题' }, { role: 'assistant', content: '第一个回答' }, { role: 'user', content: '第三个问题' },
    ])
    expect(backend.chats[1].messages.slice(3)).toEqual([{ role: 'user', content: '第一个问题' }, { role: 'assistant', content: '第一个回答' }, { role: 'user', content: '第二个问题' }])
  })

  it('ignores an empty question', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    await run(() => ai().ask('   \n'))
    expect(backend.chats).toEqual([])
    expect(ai().turns).toEqual([])
  })

  it('turns an error code into an error turn with its message, keeping what had arrived', async () => {
    for (const [thrown, code] of [['AI_HTTP_401', 'AI_HTTP_401'], ['AI_NO_KEY', 'AI_NO_KEY'], [new Error('AI_BUSY'), 'AI_BUSY'], ['connection reset by peer', 'AI_NETWORK'], ['AI_HTTP_503', 'AI_HTTP_503']] as [unknown, string][]) {
      const backend = fakeBackend()
      const { ai, rendered, status } = await mount(backend.transport)
      backend.replies.push('pending')
      let asking!: Promise<void>
      act(() => { asking = ai().ask('问题') as Promise<void> })
      await settle()
      act(() => backend.delta(backend.chats[0].requestId, '已经收到的部分'))
      // The command fails after part of the answer has arrived.
      act(() => { backend.emit('ai-stream', { requestId: backend.chats[0].requestId, kind: 'error', code }) })
      await act(async () => { backend.fail(backend.chats[0].requestId, thrown); await asking })
      await settle()
      expect(ai().turns[1], code).toMatchObject({ role: 'assistant', status: 'error', error: aiErrorText(code), text: '已经收到的部分' })
      expect(ai().turns[1].html).toBeUndefined()
      expect(ai().busy).toBe(false)
      expect(rendered).toEqual([])
      expect(status).toEqual([])
      // The assistant can be used again.
      await run(() => ai().ask('再问一次'))
      expect(ai().turns.at(-1)).toMatchObject({ status: 'done', text: '好的。' })
      unmount()
    }
  })

  it('stops a running answer: cancels the request and marks the turn as cancelled', async () => {
    const backend = fakeBackend()
    const { ai, rendered } = await mount(backend.transport)
    backend.replies.push('pending')
    let asking!: Promise<void>
    act(() => { asking = ai().ask('问题') as Promise<void> })
    await settle()
    const { requestId } = backend.chats[0]
    act(() => backend.delta(requestId, '写到一半'))
    await act(async () => { await ai().stop(); await asking })
    await settle()
    expect(backend.commands('ai_cancel')).toEqual([{ command: 'ai_cancel', args: { requestId } }])
    expect(ai().turns[1]).toMatchObject({ status: 'cancelled', text: '写到一半' })
    expect(ai().turns[1].error).toBeUndefined()
    expect(ai().busy).toBe(false)
    expect(rendered).toEqual([])
    // Stopping with nothing running does nothing.
    await run(() => ai().stop())
    expect(backend.commands('ai_cancel').length).toBe(1)
    // A cancelled exchange is not part of the history of the next question.
    await run(() => ai().ask('下一个问题'))
    expect(backend.chats[1].messages.slice(3)).toEqual([{ role: 'user', content: '下一个问题' }])
  })

  it('reports how much of a long document was left out of a question', async () => {
    const backend = fakeBackend()
    const { ai, state } = await mount(backend.transport)
    state.document = { title: '长文', markdown: Array.from({ length: 500 }, (_, index) => `第 ${index} 段。${'读书是一件安静的事。'.repeat(10)}`).join('\n\n') }
    expect(state.document.markdown.length).toBeGreaterThan(CONTEXT_BUDGET)
    await run(() => ai().ask('讲了什么？'))
    expect(backend.chats.length).toBe(1)
    const sent = backend.chats[0].messages[1].content
    expect(sent.length).toBeLessThan(CONTEXT_BUDGET + 200)
    const omitted = /此处省略 (\d+) 字/.exec(sent)![1]
    expect(ai().turns[1].note).toBe(`文档较长，中间约 ${omitted} 字没有发送。`)
    // The other presets work the same way: one request, cut to the budget.
    await run(() => ai().runPreset('points'))
    expect(backend.chats.length).toBe(2)
    expect(ai().turns[2]).toMatchObject({ role: 'user', text: '要点' })
    expect(backend.chats[1].messages.at(-1)!.content).toBe(presets[1].prompt['zh-CN'])
  })

  it('runs a preset as a question shown by its label', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    backend.replies.push('这是摘要。')
    await run(() => ai().runPreset('summary'))
    expect(backend.chats.length).toBe(1)
    expect(backend.chats[0].messages.at(-1)).toEqual({ role: 'user', content: presets[0].prompt['zh-CN'] })
    expect(ai().turns.map((turn) => [turn.role, turn.text, turn.status])).toEqual([['user', '全文摘要', 'done'], ['assistant', '这是摘要。', 'done']])
    expect(ai().turns[1].note).toBeUndefined()
    await run(() => ai().runPreset('nonsense' as 'summary'))
    expect(backend.chats.length).toBe(1)
  })

  it('summarizes a long document part by part, then combines the notes in a final request', async () => {
    const backend = fakeBackend()
    const { ai, state } = await mount(backend.transport)
    state.document = { title: '长文', markdown: Array.from({ length: 800 }, (_, index) => `第 ${index} 段。${'读书是一件安静的事。'.repeat(10)}`).join('\n\n') }
    const parts = Math.ceil(state.document.markdown.length / CONTEXT_BUDGET)
    expect(parts).toBe(3)
    backend.replies.push('要点一', '要点二', '要点三', ['这是', '全文摘要。'])
    await run(() => ai().runPreset('summary'))
    expect(backend.chats.length).toBe(parts + 1)
    for (const [index, chat] of backend.chats.slice(0, parts).entries()) {
      expect(roles(chat.messages)).toEqual(['system', 'user'])
      expect(chat.messages[1].content.startsWith('<document-part>\n')).toBe(true)
      expect(chat.messages[1].content).toContain(`这是文档的第 ${index + 1} 部分，共 ${parts} 部分。`)
      expect(chat.messages[1].content.length).toBeLessThan(CONTEXT_BUDGET + 200)
    }
    expect(backend.chats[0].messages[1].content).toContain('第 0 段。')
    expect(backend.chats[parts - 1].messages[1].content).toContain('第 799 段。')
    const final = backend.chats[parts].messages
    expect(roles(final)).toEqual(['system', 'user'])
    expect(final[1].content.startsWith('<document-notes>\n第 1 部分\n要点一\n\n第 2 部分\n要点二\n\n第 3 部分\n要点三\n</document-notes>')).toBe(true)
    expect(final[1].content.endsWith(presets[0].prompt['zh-CN'])).toBe(true)
    expect(new Set(backend.chats.map((chat) => chat.requestId)).size).toBe(parts + 1)
    // Only the final answer is shown; the notes on each part are not.
    expect(ai().turns.map((turn) => [turn.role, turn.text, turn.status])).toEqual([['user', '全文摘要', 'done'], ['assistant', '这是全文摘要。', 'done']])
    expect(ai().turns[1].note).toBe(`文档较长，已分 ${parts} 部分阅读后汇总。`)
    expect(ai().turns[1].progress).toBeUndefined()
    expect(ai().turns[1].html).toBe('<p>这是全文摘要。</p>')
  })

  it('shows which part is being read, and says what a very long document left out', async () => {
    const backend = fakeBackend()
    const { ai, state } = await mount(backend.transport)
    state.document = { title: '长文', markdown: Array.from({ length: 2400 }, (_, index) => `第 ${index} 段。${'读书是一件安静的事。'.repeat(10)}`).join('\n\n') }
    backend.replies.push('要点', 'pending')
    let running!: Promise<void>
    act(() => { running = ai().runPreset('summary') as Promise<void> })
    await settle()
    expect(ai().turns[1]).toMatchObject({ status: 'streaming', text: '', progress: `正在阅读第 2 / ${MAX_SUMMARY_PARTS} 部分…` })
    act(() => backend.delta(backend.chats[1].requestId, '要点'))
    // Notes on a part are not shown as the answer.
    expect(ai().turns[1].text).toBe('')
    backend.replies.push('要点', '要点', '要点', '要点', 'pending')
    act(() => backend.finish(backend.chats[1].requestId))
    await settle()
    expect(backend.chats.length).toBe(MAX_SUMMARY_PARTS + 1)
    expect(ai().turns[1].progress).toBe('正在汇总…')
    act(() => backend.delta(backend.chats[MAX_SUMMARY_PARTS].requestId, '摘要'))
    expect(ai().turns[1]).toMatchObject({ text: '摘要', status: 'streaming' })
    expect(ai().turns[1].progress).toBeUndefined()
    act(() => backend.finish(backend.chats[MAX_SUMMARY_PARTS].requestId))
    await act(async () => { await running })
    await settle()
    const note = /^文档过长，分 6 部分阅读，末尾约 (\d+) 字没有发送。$/.exec(ai().turns[1].note ?? '')
    expect(note, ai().turns[1].note).not.toBeNull()
    expect(Number(note![1])).toBeGreaterThan(state.document.markdown.length - CONTEXT_BUDGET * MAX_SUMMARY_PARTS - 1)
    expect(ai().turns[1].status).toBe('done')
  })

  it('stops a segmented summary between its parts', async () => {
    const backend = fakeBackend()
    const { ai, state } = await mount(backend.transport)
    state.document = { title: '长文', markdown: Array.from({ length: 800 }, (_, index) => `第 ${index} 段。${'读书是一件安静的事。'.repeat(10)}`).join('\n\n') }
    backend.replies.push('要点一', 'pending')
    let running!: Promise<void>
    act(() => { running = ai().runPreset('summary') as Promise<void> })
    await settle()
    expect(backend.chats.length).toBe(2)
    await act(async () => { await ai().stop(); await running })
    await settle()
    expect(backend.commands('ai_cancel')).toEqual([{ command: 'ai_cancel', args: { requestId: backend.chats[1].requestId } }])
    expect(backend.chats.length).toBe(2)
    expect(ai().turns[1]).toMatchObject({ status: 'cancelled', text: '' })
    expect(ai().turns[1].progress).toBeUndefined()
    expect(ai().busy).toBe(false)
  })

  it('runs a selection action on the selected text and marks the answer as insertable', async () => {
    const backend = fakeBackend()
    const { ai, state, status } = await mount(backend.transport)
    await run(() => ai().runSelection('explain'))
    expect(status).toEqual(['请先在文档中选中一段文字。'])
    state.selection = { selection: '   ', before: '', after: '' }
    await run(() => ai().runSelection('explain'))
    expect(status.length).toBe(2)
    state.selection = { selection: '字'.repeat(CONTEXT_BUDGET + 1), before: '', after: '' }
    await run(() => ai().runSelection('rewrite'))
    expect(status[2]).toBe(`选中的文字超过 ${CONTEXT_BUDGET} 字，请缩小选区。`)
    expect(backend.chats).toEqual([])
    state.selection = { selection: '读书是一件\n安静的事。', before: '前文', after: '后文' }
    backend.replies.push('Reading is a quiet thing.')
    await run(() => ai().runSelection('translate'))
    expect(backend.chats.length).toBe(1)
    expect(roles(backend.chats[0].messages)).toEqual(['system', 'user'])
    expect(backend.chats[0].messages[1].content).toBe(`${selectionActions[1].prompt['zh-CN']}\n\n<before>\n前文\n</before>\n<after>\n后文\n</after>\n\n<selection>\n读书是一件\n安静的事。\n</selection>`)
    expect(ai().turns.map((turn) => [turn.role, turn.text, turn.selectionAction])).toEqual([['user', '翻译：读书是一件 安静的事。', undefined], ['assistant', 'Reading is a quiet thing.', 'translate']])
    expect(ai().canReplace('translate')).toBe(true)
    expect(ai().canReplace('explain')).toBe(false)
    state.selection = { selection: '长'.repeat(200), before: '', after: '' }
    await run(() => ai().runSelection('explain'))
    expect(ai().turns[2].text).toBe(`解释：${'长'.repeat(60)}…`)
  })

  it('inserts an answer as sanitized Markdown and reports the result', async () => {
    const backend = fakeBackend()
    const { ai, inserted, status, state } = await mount(backend.transport)
    backend.replies.push('**译文**\n\n\n\n![图](https://example.com/a.png)<script>alert(1)</script> 结束 <b>粗</b>\n')
    state.selection = { selection: '原文', before: '', after: '' }
    await run(() => ai().runSelection('rewrite'))
    const answer = ai().turns[1]
    act(() => ai().insertAnswer(answer, 'replace'))
    expect(inserted).toEqual([['**译文**\n\n图alert(1) 结束 粗', 'replace']])
    expect(status).toEqual(['已用回答替换选中的文字，可撤销'])
    act(() => ai().insertAnswer(answer, 'after'))
    expect(inserted[1]).toEqual(['**译文**\n\n图alert(1) 结束 粗', 'after'])
    expect(status[1]).toBe('已把回答插入文档，可撤销')
    for (const [, markdown] of inserted) expect(markdown).not.toMatch(/<|!\[|https?:/)
    // Reading mode refuses the change; the hook says how to start editing.
    state.insertError = new Error('READING_MODE')
    act(() => ai().insertAnswer(answer, 'replace'))
    expect(status[2]).toBe('阅读模式下不能修改文档，按 ⌘⇧R 开始编辑。')
    state.insertError = new Error('EDITOR_NOT_READY')
    act(() => ai().insertAnswer(answer, 'after'))
    expect(status[3]).toBe('当前无法插入，请先把光标放到文档中。')
    expect(inserted.length).toBe(2)
    // Nothing is inserted for an answer that is empty once sanitized.
    state.insertError = null
    act(() => ai().insertAnswer({ ...answer, text: ' <br>\n![](x.png) ' }, 'after'))
    expect(inserted.length).toBe(2)
    expect(status.length).toBe(4)
  })

  it('opens the drawer only for an enabled assistant, and closes it when AI is switched off elsewhere', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    act(() => ai().toggleOpen())
    expect(ai().open).toBe(true)
    act(() => ai().toggleOpen())
    expect(ai().open).toBe(false)
    act(() => ai().toggleOpen())
    expect(ai().open).toBe(true)
    // Another window changes a setting that leaves AI on: the drawer stays.
    act(() => backend.emit('ai-config-changed', { ...enabled, model: 'deepseek-reasoner' }))
    expect(ai().open).toBe(true)
    expect(ai().config.model).toBe('deepseek-reasoner')
    act(() => backend.emit('ai-config-changed', { ...enabled, enabled: false }))
    expect(ai().config.enabled).toBe(false)
    expect(ai().open).toBe(false)
    act(() => ai().toggleOpen())
    expect(ai().open).toBe(false)
  })

  it('stops a running request when AI is switched off', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport)
    backend.replies.push('pending')
    let asking!: Promise<void>
    act(() => { asking = ai().ask('问题') as Promise<void> })
    await settle()
    act(() => backend.emit('ai-config-changed', { ...enabled, enabled: false }))
    await act(async () => { await asking })
    await settle()
    expect(backend.commands('ai_cancel')).toEqual([{ command: 'ai_cancel', args: { requestId: backend.chats[0].requestId } }])
    expect(ai().turns[1].status).toBe('cancelled')
    expect(ai().busy).toBe(false)
  })

  it('offers questions from the headings while the empty drawer is open, then the model\'s own', async () => {
    const backend = fakeBackend()
    const { ai, status } = await mount(backend.transport)
    expect(ai().suggestions).toEqual([])
    act(() => ai().toggleOpen())
    expect(ai().suggestions).toEqual(['“阅读的节奏”这一节讲了什么？', '“数据与代码”这一节讲了什么？', '“春日读书记”这一节讲了什么？'])
    backend.replies.push('1. 这篇文档的主题是什么？\n2. 作者怎样安排阅读的节奏？\n3. 文中的代码统计了什么？\n4. 多出来的问题不要')
    await run(() => ai().refreshSuggestions())
    expect(backend.chats.length).toBe(1)
    expect(backend.chats[0].messages.at(-1)!.content).toContain('三个')
    expect(ai().suggestions).toEqual(['这篇文档的主题是什么？', '作者怎样安排阅读的节奏？', '文中的代码统计了什么？'])
    expect(ai().turns).toEqual([])
    expect(ai().busy).toBe(false)
    // A failed refresh keeps the questions and reports the error.
    backend.replies.push({ error: 'AI_HTTP_429' })
    await run(() => ai().refreshSuggestions())
    expect(status).toEqual([aiErrorText('AI_HTTP_429')])
    expect(ai().suggestions.length).toBe(3)
    // An unusable reply changes nothing.
    backend.replies.push('好')
    await run(() => ai().refreshSuggestions())
    expect(ai().suggestions[0]).toBe('这篇文档的主题是什么？')
    await run(() => ai().ask('问题'))
    expect(ai().suggestions).toEqual([])
  })

  it('keeps one conversation per document and clears only the current one', async () => {
    const backend = fakeBackend()
    const { ai, rerender } = await mount(backend.transport)
    await run(() => ai().ask('文档一的问题'))
    expect(ai().turns.length).toBe(2)
    rerender({ documentId: 2 })
    expect(ai().turns).toEqual([])
    await run(() => ai().ask('文档二的问题'))
    // The other document's conversation does not travel with this one's question.
    expect(backend.chats[1].messages.slice(3)).toEqual([{ role: 'user', content: '文档二的问题' }])
    expect(ai().turns[0].text).toBe('文档二的问题')
    act(() => ai().clear())
    expect(ai().turns).toEqual([])
    rerender({ documentId: 1 })
    expect(ai().turns.map((turn) => turn.text)).toEqual(['文档一的问题', '好的。'])
    // Listeners are not set up again when only the document changes.
    expect(backend.commands('ai_get_config').length).toBe(1)
    expect(backend.handlers.get('ai-stream')!.size).toBe(1)
  })

  it('finishes an answer in the document it was asked in after the user switches to another', async () => {
    const backend = fakeBackend()
    const { ai, rerender } = await mount(backend.transport)
    backend.replies.push('pending')
    let asking!: Promise<void>
    act(() => { asking = ai().ask('文档一的问题') as Promise<void> })
    await settle()
    rerender({ documentId: 2 })
    act(() => backend.delta(backend.chats[0].requestId, '文档一的回答'))
    expect(ai().turns).toEqual([])
    act(() => backend.finish(backend.chats[0].requestId))
    await act(async () => { await asking })
    await settle()
    expect(ai().turns).toEqual([])
    rerender({ documentId: 1 })
    expect(ai().turns[1]).toMatchObject({ text: '文档一的回答', status: 'done', html: '<p>文档一的回答</p>' })
  })

  it('answers in the language of the interface settings', async () => {
    const backend = fakeBackend()
    const { ai } = await mount(backend.transport, { language: 'en-US' })
    await run(() => ai().runPreset('points'))
    expect(backend.chats[0].messages[0].content).toContain('Reply in English')
    expect(backend.chats[0].messages.at(-1)!.content).toBe(presets[1].prompt['en-US'])
    act(() => ai().clear())
    act(() => ai().toggleOpen())
    expect(ai().suggestions[0]).toBe('What does “阅读的节奏” say?')
  })

  it('shows the plain text when an answer cannot be rendered', async () => {
    const backend = fakeBackend()
    const { ai, state } = await mount(backend.transport)
    state.renderFails = true
    await run(() => ai().ask('问题'))
    expect(ai().turns[1]).toMatchObject({ status: 'done', text: '好的。' })
    expect(ai().turns[1].html).toBeUndefined()
  })
})

describe('preview AI transport', () => {
  const location = (search: string) => window.history.replaceState({}, '', `${window.location.pathname}${search}`)
  afterEach(() => location(''))

  it('is off unless the preview asks for AI', async () => {
    location('?ui-preview=editor')
    await expect(previewAiTransport().invoke('ai_get_config')).resolves.toMatchObject({ enabled: false, consented: false, hasKey: false })
    location('?ui-preview=editor&ui-ai=1')
    await expect(previewAiTransport().invoke('ai_get_config')).resolves.toMatchObject({ enabled: true, consented: true, hasKey: true, baseUrl: 'https://api.deepseek.com/v1' })
  })

  it('keeps configuration changes in memory', async () => {
    location('?ui-ai=1')
    const transport = previewAiTransport()
    await expect(transport.invoke('ai_set_config', { patch: { model: 'm', enabled: false } })).resolves.toMatchObject({ model: 'm', enabled: false })
    await expect(transport.invoke('ai_clear_key')).resolves.toMatchObject({ hasKey: false })
    await expect(transport.invoke('ai_set_key', { key: 'sk-x' })).resolves.toMatchObject({ hasKey: true })
    const config = await transport.invoke('ai_get_config')
    expect(config).toMatchObject({ model: 'm', enabled: false, hasKey: true })
    expect(JSON.stringify(config)).not.toContain('sk-x')
    // Each provider has its own key, and its model comes back after a switch.
    await expect(transport.invoke('ai_set_key', { key: 'sk-y', provider: 'openai' })).resolves.toMatchObject({ hasKey: true, keys: { deepseek: true, openai: true, custom: false } })
    await expect(transport.invoke('ai_clear_key', { provider: 'deepseek' })).resolves.toMatchObject({ hasKey: false, keys: { deepseek: false, openai: true, custom: false } })
    await expect(transport.invoke('ai_set_config', { patch: { provider: 'openai' } })).resolves.toMatchObject({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasKey: true })
    await transport.invoke('ai_set_config', { patch: { model: 'gpt-4.1' } })
    await expect(transport.invoke('ai_set_config', { patch: { provider: 'deepseek' } })).resolves.toMatchObject({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'm', hasKey: false })
    await expect(transport.invoke('ai_set_config', { patch: { provider: 'openai' } })).resolves.toMatchObject({ model: 'gpt-4.1' })
    // Another preview transport starts from the URL again.
    await expect(previewAiTransport().invoke('ai_get_config')).resolves.toMatchObject({ model: 'deepseek-chat', enabled: true })
  })

  it('lists canned models for the selected provider, and refuses as the backend would', async () => {
    location('?ui-ai=1')
    const transport = previewAiTransport()
    await expect(transport.invoke('ai_list_models')).resolves.toEqual(['deepseek-chat', 'deepseek-reasoner'])
    await expect(transport.invoke('ai_set_config', { patch: { provider: 'openai' } })).resolves.toMatchObject({ hasKey: false })
    await expect(transport.invoke('ai_list_models')).rejects.toBe('AI_NO_KEY')
    await transport.invoke('ai_set_key', { key: 'sk-x' })
    await expect(transport.invoke('ai_list_models')).resolves.toContain('gpt-4o')
    location('')
    await expect(previewAiTransport().invoke('ai_list_models')).rejects.toBe('AI_DISABLED')
    // The hook shows the list and the error the same way as with the real backend.
    location('?ui-ai=1')
    const { ai } = await mount(previewAiTransport())
    await run(() => ai().fetchModels())
    expect(ai().fetchedModels).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    await run(() => ai().saveConfig({ provider: 'openai' }))
    await run(() => ai().fetchModels())
    expect(ai().modelsError).toBe(aiErrorText('AI_NO_KEY'))
  })

  it('streams the same canned answer for every chat, in pieces, to stream listeners only', async () => {
    location('?ui-ai=1')
    const transport = previewAiTransport()
    const other: unknown[] = []
    const stopOther = await transport.listen('ai-config-changed', (payload) => other.push(payload))
    const client = new AiClient(transport)
    const stop = await client.listen()
    const pieces: string[] = []
    const first = await client.chat([{ role: 'user', content: '问题' }], (piece) => pieces.push(piece)).done
    expect(first).toContain('如何舒服地读长文')
    expect(pieces.length).toBeGreaterThan(5)
    expect(pieces.every((piece) => piece.length > 0 && piece.length <= 12)).toBe(true)
    expect(pieces.join('')).toBe(first)
    await expect(client.chat([{ role: 'user', content: '另一个问题' }]).done).resolves.toBe(first)
    expect(other).toEqual([])
    await client.cancel('r1')
    stop()
    stopOther()
    await expect(client.chat([{ role: 'user', content: '问题' }]).done).resolves.toBe('')
  })

  it('drives the assistant hook end to end', async () => {
    location('?ui-ai=1')
    const { ai } = await mount(previewAiTransport())
    expect(ai().config).toMatchObject({ enabled: true, consented: true })
    await run(() => ai().ask('这篇讲了什么？'))
    expect(ai().turns[1].status).toBe('done')
    expect(ai().turns[1].text).toContain('阅读模式收起编辑控件')
    expect(ai().turns[1].html).toBe(`<p>${ai().turns[1].text}</p>`)
  })
})
