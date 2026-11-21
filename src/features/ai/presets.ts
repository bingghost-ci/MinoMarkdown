import type { AiApi } from './client'

/**
 * Services a provider can be added from with one choice: the address, the protocol and a model to start with are
 * filled in, and only the key is left to enter. Each becomes an ordinary provider of the user's own, so every field
 * can still be changed, and "获取模型列表" replaces the starting model with what the service really offers.
 * Loaded with the settings pages only.
 */
export type AiPreset = { id: string; name: string; baseUrl: string; api: AiApi; model: string; /** A service on this Mac, which needs no key. */ local?: boolean }

export const aiPresets: readonly AiPreset[] = [
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic', model: 'claude-sonnet-5-5' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai', model: 'openai/gpt-4o-mini' },
  { id: 'moonshot', name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai', model: 'moonshot-v1-8k' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai', model: 'glm-4-flash' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai', model: 'qwen-plus' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai', model: 'llama-3.3-70b-versatile' },
  { id: 'ollama', name: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', api: 'openai', model: 'llama3.2', local: true },
  { id: 'lm-studio', name: 'LM Studio（本机）', baseUrl: 'http://localhost:1234/v1', api: 'openai', model: 'local-model', local: true },
]

/** Where the address of each protocol ends, shown as the field's hint: the path after it is added by the app. */
export const baseUrlHints: Record<AiApi, string> = { openai: 'https://gateway.example/v1', anthropic: 'https://gateway.example' }
export const apiLabels: readonly (readonly [AiApi, string])[] = [['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic']]

/** An id for a new provider that is not taken: the wanted one, or it with a number after it. */
export function freeProviderId(wanted: string, taken: readonly string[]): string {
  if (!taken.includes(wanted)) return wanted
  for (let count = 2; ; count++) if (!taken.includes(`${wanted}-${count}`)) return `${wanted}-${count}`
}
