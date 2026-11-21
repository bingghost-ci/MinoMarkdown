import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { disabledConfig, modelChoices, providerHasKey, providerIds, providersOf, validModel, validProviderId, type AiConfig } from '../src/features/ai/client'
import { aiPresets, apiLabels, baseUrlHints, freeProviderId } from '../src/features/ai/presets'
import { aiErrorText } from '../src/features/ai/prompts'

describe('providers of the user’s own', () => {
  const config: AiConfig = { ...disabledConfig, provider: 'my-gateway', api: 'anthropic', keys: { deepseek: false, openai: true, custom: false, 'my-gateway': true }, customProviders: { 'my-gateway': '公司网关', claude: 'Claude' } }

  it('lists the built-in providers first, then the user’s, each with its name', () => {
    expect(providersOf(disabledConfig).map((provider) => provider.id)).toEqual(['deepseek', 'openai', 'custom'])
    expect(providersOf(config)).toEqual([
      { id: 'deepseek', name: 'DeepSeek', own: false }, { id: 'openai', name: 'OpenAI', own: false }, { id: 'custom', name: '自定义', own: false },
      { id: 'my-gateway', name: '公司网关', own: true }, { id: 'claude', name: 'Claude', own: true },
    ])
    expect(providerHasKey(config, 'my-gateway')).toBe(true)
    expect(providerHasKey(config, 'claude')).toBe(false)
    // A provider without suggestions of its own offers what the service listed.
    expect(modelChoices('my-gateway', ['m-1', 'bad id'])).toEqual(['m-1'])
  })

  it('accepts the ids ai.rs accepts', () => {
    for (const id of ['a', 'my-gateway', 'p9', 'lm-studio', 'a'.repeat(32)]) expect(validProviderId(id), id).toBe(true)
    for (const id of ['openai', 'custom', 'deepseek', 'My-Gateway', '9lives', 'a--b', '-a', 'a-', '', 'has space', 'a'.repeat(33)]) expect(validProviderId(id), id).toBe(false)
    // The same reserved names and the same two protocols as the Rust side.
    const rust = readFileSync('src-tauri/src/ai.rs', 'utf8')
    expect(rust).toContain(`const BUILT_IN: [&str; 3] = [${providerIds.map((id) => `"${id}"`).join(', ')}];`)
    expect(rust).toContain(`matches!(api, ${apiLabels.map(([api]) => `"${api}"`).join(' | ')})`)
  })

  it('offers presets that the configuration would accept as they are', () => {
    expect(new Set(aiPresets.map((preset) => preset.id)).size).toBe(aiPresets.length)
    for (const preset of aiPresets) {
      expect(validProviderId(preset.id), preset.id).toBe(true)
      expect(validModel(preset.model), preset.id).toBe(true)
      expect(preset.name.trim().length, preset.id).toBeGreaterThan(0)
      expect(preset.name.length, preset.id).toBeLessThanOrEqual(40)
      const url = new URL(preset.baseUrl)
      // https everywhere; http only for a service on this Mac, as ai.rs requires.
      expect(url.protocol === 'https:' || (preset.local === true && url.protocol === 'http:' && url.hostname === 'localhost'), preset.id).toBe(true)
      expect(url.search + url.hash + url.username).toBe('')
      expect(Object.keys(baseUrlHints)).toContain(preset.api)
    }
    expect(aiPresets.filter((preset) => preset.api === 'anthropic').map((preset) => preset.id)).toEqual(['anthropic'])
  })

  it('finds a free id for a preset added twice', () => {
    expect(freeProviderId('ollama', ['deepseek', 'openai', 'custom'])).toBe('ollama')
    expect(freeProviderId('ollama', ['ollama'])).toBe('ollama-2')
    expect(freeProviderId('ollama', ['ollama', 'ollama-2'])).toBe('ollama-3')
    expect(validProviderId(freeProviderId('lm-studio', ['lm-studio']))).toBe(true)
  })

  it('has a message for each new error code', () => {
    for (const code of ['AI_PROVIDER_EXISTS', 'AI_TOO_MANY_PROVIDERS', 'AI_INVALID_KEY']) expect(aiErrorText(code)).not.toBe(aiErrorText('AI_SOMETHING_UNKNOWN'))
  })
})
