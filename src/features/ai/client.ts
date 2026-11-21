import type { ChatMessage } from './prompts'

/**
 * The IPC the assistant needs, passed in by the workspace hook: feature modules do not import Tauri
 * themselves. `ai_chat` resolves when the stream has ended; text arrives through `ai-stream` events.
 */
export type AiTransport = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>
}

/** `deepseek`, `openai`, the single `custom` slot of earlier versions, or the id of a provider the user added. */
export type AiProvider = string
/** The wire protocol of a provider: OpenAI's chat completions, which most services speak, or Anthropic's messages. */
export type AiApi = 'openai' | 'anthropic'
/**
 * `hasKey` is about the selected provider; `keys` says which providers have a key stored. The keys themselves stay in
 * Rust. `customProviders` are the ones the user added, by id, with the name shown for each; `api` is the selected
 * provider's protocol. Both are left out by a configuration that has neither.
 */
export type AiConfig = { enabled: boolean; consented: boolean; provider: AiProvider; baseUrl: string; model: string; api?: AiApi; hasKey: boolean; keys: Record<AiProvider, boolean>; customProviders?: Record<string, string> }
/** What `ai_add_provider` takes; ai.rs checks every field again. */
export type NewAiProvider = { id: string; name: string; baseUrl: string; model: string; api: AiApi }
export type AiStreamEvent = { requestId: string; kind: 'delta' | 'done' | 'error'; text?: string; code?: string }
export type AiChat = { requestId: string; done: Promise<string> }

export const disabledConfig: AiConfig = { enabled: false, consented: false, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: false, keys: { deepseek: false, openai: false, custom: false } }
export const providerLabels: Record<AiProvider, string> = { deepseek: 'DeepSeek', openai: 'OpenAI', custom: '自定义' }
/** The providers every configuration has; `providersOf` adds the user's own. */
export const providerIds = Object.keys(providerLabels) as AiProvider[]
/** A few common models per provider, offered as a starting point. Any model name the service accepts can be typed instead. */
export const suggestedModels: Record<AiProvider, readonly string[]> = { deepseek: ['deepseek-chat', 'deepseek-reasoner'], openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'], custom: [] }

/** Every provider of a configuration, the built-in ones first, each with the name to show. */
export function providersOf(config: AiConfig): { id: AiProvider; name: string; own: boolean }[] {
  return [...providerIds.map((id) => ({ id, name: providerLabels[id], own: false })), ...Object.entries(config.customProviders ?? {}).map(([id, name]) => ({ id, name, own: true }))]
}

/** The same shape `valid_provider_id` in ai.rs accepts: lower-case words joined by hyphens, not a built-in name. */
export function validProviderId(id: string): boolean {
  return id.length <= 32 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) && !providerIds.includes(id)
}

/** The same shape `valid_model` in ai.rs accepts. */
export function validModel(model: string): boolean {
  return /^[A-Za-z0-9._:/-]{1,100}$/.test(model)
}

/** Whether a provider has a key, also for a configuration from before keys were reported per provider. */
export function providerHasKey(config: AiConfig, provider: AiProvider): boolean {
  return config.keys?.[provider] ?? (provider === config.provider && config.hasKey)
}

/** The models to offer for a provider: its suggestions first, then what the service listed, without repeats. */
export function modelChoices(provider: AiProvider, fetched: readonly string[] = []): string[] {
  return [...new Set([...(suggestedModels[provider] ?? []), ...fetched])].filter(validModel)
}

function errorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error)
  return /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'AI_NETWORK'
}

function requestId(): string {
  return `r${Date.now().toString(36)}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
}

/** Routes stream events to the request they belong to and turns a streamed chat into a promise. */
export class AiClient {
  private readonly deltas = new Map<string, (text: string) => void>()

  constructor(private readonly transport: AiTransport) {}

  /** Starts listening for stream events; the returned function stops it. */
  listen(): Promise<() => void> {
    return this.transport.listen<AiStreamEvent>('ai-stream', (event) => {
      if (event.kind === 'delta' && typeof event.text === 'string') this.deltas.get(event.requestId)?.(event.text)
    })
  }

  /** Sends a chat. `onDelta` receives each piece of text; `done` resolves with the whole answer or rejects with an error code. */
  chat(messages: readonly ChatMessage[], onDelta: (text: string, whole: string) => void = () => undefined): AiChat {
    const id = requestId()
    let whole = ''
    this.deltas.set(id, (text) => { whole += text; onDelta(text, whole) })
    const done = this.transport.invoke<void>('ai_chat', { request: { requestId: id, messages } })
      // Events emitted just before the command returned may still be in the queue.
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
      .then(() => whole, (error: unknown) => { throw new Error(errorCode(error)) })
      .finally(() => { this.deltas.delete(id) })
    return { requestId: id, done }
  }

  /** Asks the selected provider which models it offers. Rejects with an error code. */
  listModels(): Promise<string[]> {
    return this.transport.invoke<unknown>('ai_list_models').then(
      (ids) => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && validModel(id)) : [],
      (error: unknown) => { throw new Error(errorCode(error)) },
    )
  }

  cancel(id: string): Promise<void> {
    return this.transport.invoke<void>('ai_cancel', { requestId: id }).catch(() => undefined)
  }
}
