import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAppAsset } from '../src/features/export/appAssets'
import { bundledFaces } from '../src/features/reading/fontFaces'

const unreachable = async (): Promise<ArrayBuffer> => { throw new Error('ASSET_NOT_FOUND') }

describe('reading bundled fonts for export', () => {
  it('uses read_app_asset in built apps, even for development-style paths', async () => {
    const asked: string[] = []
    const command = async (path: string) => { asked.push(path); return new Uint8Array([1, 2]).buffer }
    expect(Array.from(await readAppAsset('/assets/a.woff2', command, false))).toEqual([1, 2])
    expect(Array.from(await readAppAsset('/node_modules/x/a.woff2', command, false))).toEqual([1, 2])
    expect(asked).toEqual(['/assets/a.woff2', '/node_modules/x/a.woff2'])
  })

  it('reads the served font itself under the development server', async () => {
    const face = bundledFaces.find((item) => item.url.startsWith('/node_modules/'))
    expect(face, 'development font URLs point into node_modules').toBeDefined()
    const bytes = await readAppAsset(face!.url, unreachable, true)
    expect(Array.from(bytes)).toEqual(Array.from(readFileSync(resolve(face!.url.slice(1)))))
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('wOF2')
  })

  it('reads a paper layer itself under the development server (T98)', async () => {
    const bytes = await readAppAsset('/src/assets/paper/kraft-grain.png', unreachable, true)
    expect(Array.from(bytes)).toEqual(Array.from(readFileSync(resolve('src/assets/paper/kraft-grain.png'))))
    expect(Array.from(bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47])
    await expect(readAppAsset('/src/assets/paper/../../main.tsx', unreachable, true)).rejects.toThrow('ASSET_NOT_FOUND')
    await expect(readAppAsset('/src/assets/icon.png', unreachable, true)).rejects.toThrow('ASSET_NOT_FOUND')
  })

  it('only takes the development path for WOFF2 files under node_modules', async () => {
    await expect(readAppAsset('/node_modules/x/evil.js', unreachable, true)).rejects.toThrow('ASSET_NOT_FOUND')
    await expect(readAppAsset('/src/main.tsx', unreachable, true)).rejects.toThrow('ASSET_NOT_FOUND')
  })
})
