import { describe, expect, it } from 'vitest'
import { applyRemoteSettings, settingsPatch } from '../src/app/settingsSync'

const base = { theme: 'light', windowWidth: 1000, windowHeight: 700, language: 'zh-CN' }

describe('settings sync', () => {
  it('patches only changed fields', () => {
    expect(settingsPatch(base, { ...base, windowWidth: 1200 })).toEqual({ windowWidth: 1200 })
    expect(settingsPatch(base, { ...base })).toBeNull()
  })

  it('takes remote values without adopting the other window size', () => {
    const remote = { ...base, theme: 'dark', windowWidth: 1600 }
    const result = applyRemoteSettings(base, base, remote)
    expect(result.current).toEqual({ ...base, theme: 'dark' })
    expect(settingsPatch(result.persisted, result.current)).toBeNull()
  })

  it('keeps an unsaved local edit and returns the same object when nothing applies', () => {
    const local = { ...base, theme: 'paper' }
    const kept = applyRemoteSettings(local, base, { ...base, theme: 'dark' })
    expect(kept.current.theme).toBe('paper')
    const same = applyRemoteSettings(base, base, { ...base, windowWidth: 1 })
    expect(same.current).toBe(base)
  })
})
