import { describe, expect, it } from 'vitest'
import { contrast, toHex } from '../src/features/reading/color'
import { readingStyle } from '../src/features/reading/styles'
// The generator is plain Node; the tests read the committed tiles with its decoder.
import { decodePng, encodePng, readTexture, renderTexture, textureSpecs } from '../scripts/generate-paper-textures.mjs'

type Spec = { id: string; paper: string }
const specs = textureSpecs as Spec[]
const KiB = 1024

/** Luminance (0–255) of the tile drawn over its page color, as the browser composites it. */
function composite(spec: Spec) {
  const { width, height, rgba } = decodePng(readTexture(spec.id)) as { width: number; height: number; rgba: Uint8Array }
  const n = parseInt(spec.paper.slice(1), 16)
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const luma = new Float64Array(width * height)
  const colors: string[] = []
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255
    const c = [0, 1, 2].map((k) => base[k] * (1 - a) + rgba[i * 4 + k] * a) as [number, number, number]
    luma[i] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    colors.push(toHex(c))
  }
  return { width, height, luma, colors }
}

const mean = (values: ArrayLike<number>) => Array.from(values).reduce((sum, value) => sum + value, 0) / values.length
const std = (values: ArrayLike<number>) => { const m = mean(values); return Math.sqrt(mean(Array.from(values, (value) => (value - m) ** 2))) }

describe('paper textures', () => {
  it('has one tile per textured style, drawn for that style\'s page color', () => {
    for (const spec of specs) expect(readingStyle(spec.id).texture, spec.id).toBe(spec.id)
    for (const spec of specs) expect(readingStyle(spec.id).paper, spec.id).toBe(spec.paper)
  })

  it('matches a fresh build of the generator, so the committed tiles are reproducible', () => {
    for (const spec of specs) {
      const { width, height, rgba } = renderTexture(spec)
      expect(Buffer.compare(encodePng(width, height, rgba), readTexture(spec.id)), spec.id).toBe(0)
    }
  })

  it('stays within the size budget: 150 KiB per tile and 1 MiB in all', () => {
    const sizes = specs.map((spec) => readTexture(spec.id).length)
    for (const [i, size] of sizes.entries()) expect(size, specs[i].id).toBeLessThanOrEqual(150 * KiB)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(1024 * KiB)
  })

  it('tiles without seams: the wrap-around edge differs no more than neighboring pixels do', () => {
    for (const spec of specs) {
      const { width, height, luma } = composite(spec)
      let seam = 0, inner = 0
      for (let y = 0; y < height; y++) { seam += Math.abs(luma[y * width] - luma[y * width + width - 1]); inner += Math.abs(luma[y * width + 100] - luma[y * width + 101]) }
      for (let x = 0; x < width; x++) { seam += Math.abs(luma[x] - luma[(height - 1) * width + x]); inner += Math.abs(luma[100 * width + x] - luma[101 * width + x]) }
      expect(seam / inner, spec.id).toBeLessThan(1.5)
    }
  })

  it('stays clean: fine grain only, and no blotches at 32 px or larger', () => {
    for (const spec of specs) {
      const { width, height, luma } = composite(spec)
      expect(std(luma), `${spec.id} grain`).toBeLessThanOrEqual(3)
      for (const block of [32, 64]) {
        const means: number[] = []
        for (let by = 0; by < height; by += block) for (let bx = 0; bx < width; bx += block) {
          let sum = 0
          for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) sum += luma[y * width + x]
          means.push(sum / block / block)
        }
        // Large patches of darker tone are what made the T50 texture look dirty; this keeps them out.
        expect(std(means), `${spec.id} ${block}px`).toBeLessThanOrEqual(0.4)
      }
      expect(Math.abs(mean(luma) - (0.2126 * parseInt(spec.paper.slice(1, 3), 16) + 0.7152 * parseInt(spec.paper.slice(3, 5), 16) + 0.0722 * parseInt(spec.paper.slice(5, 7), 16))), `${spec.id} mean`).toBeLessThan(2)
    }
  })

  it('keeps body text readable on the darkest 5% of the texture', () => {
    for (const spec of specs) {
      const { luma, colors } = composite(spec)
      const order = Array.from(luma.keys()).sort((a, b) => luma[a] - luma[b])
      const dark = colors[order[Math.floor(order.length * 0.05)]]
      expect(contrast(readingStyle(spec.id).text, dark), spec.id).toBeGreaterThanOrEqual(7)
    }
  })
})
