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

  // The custom code colors are an object, and a broadcast always brings a new one (T113).
  it('compares object settings by content, so an echo of the same colors changes nothing', () => {
    const colors = { day: { variable: '#112233' }, night: {} }
    const base = { codeCustomColors: colors, theme: 'white' }
    expect(settingsPatch(base, { ...base, codeCustomColors: { day: { variable: '#112233' }, night: {} } })).toBeNull()
    expect(settingsPatch(base, { ...base, codeCustomColors: { day: { variable: '#445566' }, night: {} } })).toEqual({ codeCustomColors: { day: { variable: '#445566' }, night: {} } })
    const echoed = applyRemoteSettings(base, base, { codeCustomColors: { day: { variable: '#112233' }, night: {} }, theme: 'white' })
    expect(echoed.current).toBe(base)
    const remote = applyRemoteSettings(base, base, { codeCustomColors: { day: { variable: '#445566' }, night: {} }, theme: 'white' })
    expect(remote.current.codeCustomColors).toEqual({ day: { variable: '#445566' }, night: {} })
    // A local change not yet saved wins over a broadcast.
    const local = { ...base, codeCustomColors: { day: { variable: '#778899' }, night: {} } }
    expect(applyRemoteSettings(local, base, { codeCustomColors: { day: { variable: '#445566' }, night: {} }, theme: 'white' }).current).toBe(local)
  })
})
