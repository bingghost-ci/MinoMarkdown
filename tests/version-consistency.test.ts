import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** The version is written in five files (CLAUDE.md); a release with them out of step would report two versions. */
describe('version', () => {
  it('is the same in all five files that record it', () => {
    const packageJson = JSON.parse(read('package.json')).version as string
    const lock = JSON.parse(read('package-lock.json'))
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json')).version as string
    const cargo = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]
    const cargoLock = /\[\[package\]\]\nname = "mino-markdown"\nversion = "([^"]+)"/.exec(read('src-tauri/Cargo.lock'))?.[1]
    const name = JSON.parse(read('package.json')).name as string
    expect(packageJson).toMatch(/^\d+\.\d+\.\d+/)
    expect([lock.version, lock.packages[''].version, tauri, cargo, cargoLock]).toEqual(Array(5).fill(packageJson))
    expect(lock.name).toBe(name)
  })
})
