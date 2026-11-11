import { statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundledFaces, facesForText, fontFaceCss, KAI_FAMILY, SERIF_FAMILY } from '../src/features/reading/fonts'

const fileOnDisk = (file: string) => join('node_modules/@fontsource', file.startsWith('lxgw') ? 'lxgw-wenkai' : 'noto-serif-sc', 'files', file)

describe('bundled fonts', () => {
  it('bundles Noto Serif SC 400 and 700 subsets and LXGW WenKai 500 and 700, all WOFF2', () => {
    const serif = bundledFaces.filter((face) => face.family === SERIF_FAMILY)
    const kai = bundledFaces.filter((face) => face.family === KAI_FAMILY)
    expect(new Set(serif.map((face) => face.weight))).toEqual(new Set(['400', '700']))
    expect(serif.length).toBe(202)
    expect(serif.every((face) => face.ranges && face.ranges.length > 0)).toBe(true)
    expect(kai.map((face) => face.file)).toEqual(['lxgw-wenkai-latin-500-normal.woff2', 'lxgw-wenkai-latin-700-normal.woff2'])
    expect(bundledFaces.every((face) => face.file.endsWith('.woff2'))).toBe(true)
  })

  it('stays within the 32 MiB font budget', () => {
    const total = bundledFaces.reduce((sum, face) => sum + statSync(fileOnDisk(face.file)).size, 0)
    expect(total).toBeLessThanOrEqual(32 * 1024 * 1024)
  })

  it('declares blocking font display and only WOFF2 sources', () => {
    const css = fontFaceCss(bundledFaces)
    expect(css.match(/@font-face/g)?.length).toBe(bundledFaces.length)
    expect(css).not.toMatch(/font-display:\s*swap|format\('woff'\)/)
    expect(css).toContain('font-display:block')
  })

  it('picks only the subsets that cover characters of the text', () => {
    const picked = facesForText('阅读 Reading', new Set([SERIF_FAMILY]))
    const files = picked.map((face) => face.file)
    expect(files).toContain('noto-serif-sc-116-400-normal.woff2')
    expect(files).toContain('noto-serif-sc-latin-400-normal.woff2')
    expect(files).toContain('noto-serif-sc-latin-700-normal.woff2')
    expect(files.some((file) => file.includes('cyrillic'))).toBe(false)
    expect(picked.length).toBeLessThan(12)
    expect(facesForText('', new Set([SERIF_FAMILY]))).toEqual([])
    expect(facesForText('阅读', new Set(['Georgia']))).toEqual([])
    // WenKai has no subsets, so any text needs the whole file.
    expect(facesForText('a', new Set([KAI_FAMILY])).length).toBe(2)
  })
})
