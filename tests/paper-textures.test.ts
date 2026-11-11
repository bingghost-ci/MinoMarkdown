import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { textureBackground, type TextureId } from '../src/features/reading/textures'
// The generator is plain Node; the tests read the committed layers with its decoder.
import { PERIOD, decodePng, encodePng, layerFile, outputDir, readLayer, renderLayer, textureSpecs } from '../scripts/generate-paper-textures.mjs'

type Layer = { name: string; pixels: number; size: number }
type Spec = { id: TextureId; paper: string; layers: Layer[] }
const specs = textureSpecs as unknown as Spec[]
const spec = (id: TextureId) => specs.find((item) => item.id === id)!
const KiB = 1024
/** The side of the square of page, in CSS px at 1x, that the metrics look at: one full period. */
const N = PERIOD
/** The strength the app applies by default: the texture veiled 40% with the page color. */
const DEFAULT_STRENGTH = 0.6

// The page colors the layers are tinted for. styles.ts must use the same ones.
const pages: Record<TextureId, string> = { paper: '#f6efe0', xuan: '#f5f3ea', parchment: '#ead6a8', kraft: '#c9a878' }

const wrap = (value: number, size: number) => ((value % size) + size) % size
const rgb = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const linear = (channel: number) => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const relative = (r: number, g: number, b: number) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

const decoded = new Map<string, { width: number; rgba: Uint8Array }>()
function pixels(paper: Spec, layer: Layer) {
  const key = layerFile(paper, layer) as string
  if (!decoded.has(key)) decoded.set(key, decodePng(readLayer(paper, layer)) as { width: number; rgba: Uint8Array })
  return decoded.get(key)!
}

/**
 * Draws layers over the page color as the browser does (top layer last; scaled layers are interpolated) and
 * returns the page-sized RGB image.
 */
function draw(paper: Spec, names?: string[]) {
  const page = rgb(paper.paper)
  const image = new Float32Array(N * N * 3)
  for (let i = 0; i < N * N; i++) { image[i * 3] = page[0]; image[i * 3 + 1] = page[1]; image[i * 3 + 2] = page[2] }
  for (const layer of [...paper.layers].reverse()) {
    if (names && !names.includes(layer.name)) continue
    const { width, rgba } = pixels(paper, layer)
    const scale = layer.size / width
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, a = 0
      if (scale === 1) {
        const p = (wrap(y, width) * width + wrap(x, width)) * 4
        r = rgba[p]; g = rgba[p + 1]; b = rgba[p + 2]; a = rgba[p + 3] / 255
      } else {
        const u = (x + 0.5) / scale - 0.5, v = (y + 0.5) / scale - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0
        for (let corner = 0; corner < 4; corner++) {
          const dx = corner & 1, dy = corner >> 1
          const p = (wrap(y0 + dy, width) * width + wrap(x0 + dx, width)) * 4
          const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * rgba[p + 3] / 255
          r += rgba[p] * weight; g += rgba[p + 1] * weight; b += rgba[p + 2] * weight; a += weight
        }
        if (a > 0) { r /= a; g /= a; b /= a }
      }
      const i = (y * N + x) * 3
      image[i] += (r - image[i]) * a; image[i + 1] += (g - image[i + 1]) * a; image[i + 2] += (b - image[i + 2]) * a
    }
  }
  return image
}

const cache = new Map<string, Float64Array>()
/** Luminance of the drawn layers relative to the page: -0.02 is 2% darker than the page color. */
function delta(id: TextureId, names?: string[]) {
  const key = `${id}:${names?.join('+') ?? '*'}`
  if (!cache.has(key)) {
    const paper = spec(id), image = draw(paper, names), page = rgb(paper.paper), base = luma(page[0], page[1], page[2])
    cache.set(key, Float64Array.from({ length: N * N }, (_, i) => luma(image[i * 3], image[i * 3 + 1], image[i * 3 + 2]) / base - 1))
  }
  return cache.get(key)!
}

/**
 * How much of a dark text's contrast ratio is left on each pixel of the texture, at a texture strength:
 * (L + 0.05) of the pixel over (L + 0.05) of the bare page, which is the page-side factor of the WCAG ratio.
 */
function contrastKept(id: TextureId, strength: number) {
  const paper = spec(id), image = draw(paper), page = rgb(paper.paper), base = relative(page[0], page[1], page[2]) + 0.05
  const mix = (value: number, k: number) => page[k] + (value - page[k]) * strength
  return Float64Array.from({ length: N * N }, (_, i) => (relative(mix(image[i * 3], 0), mix(image[i * 3 + 1], 1), mix(image[i * 3 + 2], 2)) + 0.05) / base)
}

const mean = (values: ArrayLike<number>) => { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i]; return sum / values.length }
const std = (values: ArrayLike<number>) => { const m = mean(values); let sum = 0; for (let i = 0; i < values.length; i++) sum += (values[i] - m) ** 2; return Math.sqrt(sum / values.length) }
const percentile = (values: ArrayLike<number>, p: number) => Float64Array.from(values).sort()[Math.floor(values.length * p)]

/** Correlation of the field with itself moved by (dx, dy), wrapping. */
function autocorrelation(values: Float64Array, dx: number, dy: number, size = N) {
  const m = mean(values)
  let sum = 0, squares = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = values[y * size + x] - m
    sum += a * (values[wrap(y + dy, size) * size + wrap(x + dx, size)] - m); squares += a * a
  }
  return sum / squares
}

function blockMeans(values: Float64Array, block: number) {
  const out: number[] = []
  for (let by = 0; by < N; by += block) for (let bx = 0; bx < N; bx += block) {
    let sum = 0
    for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) sum += values[y * N + x]
    out.push(sum / block / block)
  }
  return out
}

/** Mean over a wrapped square window of the given radius around every pixel. */
function boxMean(values: Float64Array, radius: number) {
  const rows = new Float64Array(N * N), out = new Float64Array(N * N), span = 2 * radius + 1
  for (let y = 0; y < N; y++) {
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += values[y * N + wrap(i, N)]
    for (let x = 0; x < N; x++) { rows[y * N + x] = sum / span; sum += values[y * N + wrap(x + radius + 1, N)] - values[y * N + wrap(x - radius, N)] }
  }
  for (let x = 0; x < N; x++) {
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += rows[wrap(i, N) * N + x]
    for (let y = 0; y < N; y++) { out[y * N + x] = sum / span; sum += rows[wrap(y + radius + 1, N) * N + x] - rows[wrap(y - radius, N) * N + x] }
  }
  return out
}

/** Mean of each row (or column) over the first `length` rows. */
function profile(values: Float64Array, length: number, axis: 'rows' | 'columns') {
  return Array.from({ length }, (_, i) => { let sum = 0; for (let j = 0; j < N; j++) sum += axis === 'rows' ? values[i * N + j] : values[j * N + i]; return sum / N })
}

/** Amplitude of the wave with `cycles` periods in the profile, and its power over the strongest unrelated wave. */
function periodicity(values: number[], cycles: number) {
  const n = values.length, m = mean(values)
  const power = (k: number) => {
    let re = 0, im = 0
    for (let i = 0; i < n; i++) { re += (values[i] - m) * Math.cos(2 * Math.PI * k * i / n); im += (values[i] - m) * Math.sin(2 * Math.PI * k * i / n) }
    return (re * re + im * im) / n / n
  }
  let other = 0
  // Harmonics and neighbors of the line frequency belong to the same lines, so they are not counted against it.
  for (let k = 1; k < n / 2; k++) if (k % cycles > 3 && cycles - (k % cycles) > 3) other = Math.max(other, power(k))
  return { amplitude: 2 * Math.sqrt(power(cycles)), dominance: power(cycles) / other }
}

/** 8-connected groups of marked pixels on the torus, with their area and bounding box. */
function components(mask: Uint8Array) {
  const seen = new Uint8Array(N * N), out: Array<{ area: number; width: number; height: number; x: number; y: number }> = []
  const stack: number[] = []
  for (let start = 0; start < N * N; start++) {
    if (!mask[start] || seen[start]) continue
    let area = 0, minX = 0, maxX = 0, minY = 0, maxY = 0
    stack.push(start, 0, 0); seen[start] = 1
    while (stack.length) {
      const ry = stack.pop()!, rx = stack.pop()!, i = stack.pop()!
      area++; minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry)
      const x = i % N, y = (i - x) / N
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = wrap(y + dy, N) * N + wrap(x + dx, N)
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j, rx + dx, ry + dy) }
      }
    }
    out.push({ area, width: maxX - minX + 1, height: maxY - minY + 1, x: start % N, y: Math.floor(start / N) })
  }
  return out
}

const marks = (values: Float64Array, test: (value: number) => boolean) => Uint8Array.from(values, (value) => (test(value) ? 1 : 0))
const area = (groups: Array<{ area: number }>) => groups.reduce((sum, group) => sum + group.area, 0)

/** The share of marked pixels whose eight neighbors are all marked: near zero for thin lines, high for blobs. */
function interiorShare(mask: Uint8Array) {
  let total = 0, interior = 0
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!mask[y * N + x]) continue
    total++
    let all = true
    for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1 && all; dx++) all = mask[wrap(y + dy, N) * N + wrap(x + dx, N)] === 1
    if (all) interior++
  }
  return interior / Math.max(1, total)
}

describe('paper textures', { timeout: 120_000 }, () => {
  it('covers the four papers, tinted for their page colors, and the app stacks the same layers', () => {
    expect(specs.map((item) => item.id)).toEqual(['paper', 'xuan', 'parchment', 'kraft'])
    for (const paper of specs) {
      expect(paper.paper, paper.id).toBe(pages[paper.id])
      const background = textureBackground(paper.id)!
      expect(background.image.split(', '), paper.id).toEqual(paper.layers.map((layer) => `url("data:image/png;base64,${readLayer(paper, layer).toString('base64')}")`))
      expect(background.size, paper.id).toBe(paper.layers.map((layer) => `${layer.size}px ${layer.size}px`).join(', '))
    }
    expect(textureBackground(null)).toBeNull()
  })

  it('matches a fresh build of the generator, so the committed layers are reproducible', () => {
    const expected = new Set<string>()
    for (const paper of specs) for (const layer of paper.layers) {
      expected.add(layerFile(paper, layer))
      expect(Buffer.compare(encodePng(renderLayer(paper, layer)), readLayer(paper, layer)), layerFile(paper, layer)).toBe(0)
    }
    // Every PNG in the folder is inlined into the app, so nothing else may live there.
    expect(readdirSync(outputDir).sort()).toEqual([...expected].sort())
  })

  it('stays within the size budget: 700 KiB per paper and 2 MiB in all', () => {
    for (const paper of specs) expect(paper.layers.reduce((sum, layer) => sum + readLayer(paper, layer).length, 0), paper.id).toBeLessThanOrEqual(700 * KiB)
    expect(readdirSync(outputDir).reduce((sum, file) => sum + statSync(join(outputDir, file)).size, 0)).toBeLessThanOrEqual(2048 * KiB)
  })

  it('wraps without seams: across the edges, every layer changes no more than between neighbors inside', () => {
    for (const paper of specs) for (const layer of paper.layers) {
      const { width, rgba } = pixels(paper, layer)
      // Signed strength of a mark: light marks positive, dark marks negative.
      const page = rgb(paper.paper), base = luma(page[0], page[1], page[2])
      const value = (x: number, y: number) => { const p = (y * width + x) * 4; return (luma(rgba[p], rgba[p + 1], rgba[p + 2]) - base) * rgba[p + 3] / 255 }
      let seamX = 0, innerX = 0, seamY = 0, innerY = 0
      for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
        const right = Math.abs(value(x, y) - value((x + 1) % width, y)), down = Math.abs(value(x, y) - value(x, (y + 1) % width))
        if (x === width - 1) seamX += right; else innerX += right / (width - 1)
        if (y === width - 1) seamY += down; else innerY += down / (width - 1)
      }
      expect(seamX / innerX, `${layerFile(paper, layer)} left/right`).toBeLessThan(1.5)
      expect(seamY / innerY, `${layerFile(paper, layer)} top/bottom`).toBeLessThan(1.5)
    }
  })

  it('repeats no sooner than every 1024 px: each paper has a layer that long which does not repeat inside it', () => {
    for (const paper of specs) {
      const long = paper.layers.filter((layer) => layer.size >= PERIOD)
      expect(long.length, paper.id).toBeGreaterThan(0)
      for (const layer of paper.layers) expect(layer.size % 1 === 0 && layer.pixels === pixels(paper, layer).width, layerFile(paper, layer)).toBe(true)
      // A layer drawn 1024 px wide that was really a 256 or 512 px pattern would match itself when moved that far.
      const values = delta(paper.id, [long[0].name])
      for (const shift of [256, 512]) {
        expect(Math.abs(autocorrelation(values, shift, 0)), `${paper.id} moved ${shift}px across`).toBeLessThan(0.3)
        expect(Math.abs(autocorrelation(values, 0, shift)), `${paper.id} moved ${shift}px down`).toBeLessThan(0.3)
      }
    }
  })

  it('书页 has laid lines and a fine pressed grain', () => {
    const values = delta('paper')
    // Laid lines every 4 px: a clear peak in the row brightness profile, yet under 1.5% of the page's luminance.
    const laid = periodicity(profile(values, 1024, 'rows'), 1024 / 4)
    expect(laid.amplitude).toBeGreaterThan(0.005)
    expect(laid.amplitude).toBeLessThan(0.015)
    expect(laid.dominance).toBeGreaterThan(8)
    // The grain is fine: strong pixel to pixel, gone once averaged over 32 px.
    const grain = std(delta('paper', ['grain']))
    expect(grain).toBeGreaterThan(0.012)
    expect(grain).toBeLessThan(0.022)
    expect(std(blockMeans(values, 32))).toBeLessThan(0.006)
    // It is pressed relief lit from the top left, so each pixel opposes its lower-right neighbor.
    expect(autocorrelation(delta('paper', ['grain']), 2, 2)).toBeLessThan(-0.1)
  })

  it('宣纸 has long thin fibers, mostly light, over laid and chain lines', () => {
    const fibers = delta('xuan', ['fibers'])
    const light = marks(fibers, (value) => value > 0.012), dark = marks(fibers, (value) => value < -0.012)
    const lightGroups = components(light), darkGroups = components(dark)
    const long = lightGroups.filter((group) => Math.max(group.width, group.height) >= 150)
    // Long: most of the light fiber area belongs to strands at least 150 px across.
    expect(long.length).toBeGreaterThanOrEqual(5)
    expect(area(long) / area(lightGroups)).toBeGreaterThan(0.4)
    // Thin: lines a pixel or two wide have almost no pixel surrounded by other marked pixels.
    expect(interiorShare(light)).toBeLessThan(0.05)
    expect(interiorShare(dark)).toBeLessThan(0.05)
    // Mostly lighter, with some darker strands, covering a modest part of the sheet.
    expect(area(lightGroups)).toBeGreaterThan(2.5 * area(darkGroups))
    expect(darkGroups.filter((group) => Math.max(group.width, group.height) >= 60).length).toBeGreaterThanOrEqual(10)
    expect(area(lightGroups) / N / N).toBeGreaterThan(0.04)
    expect(area(lightGroups) / N / N).toBeLessThan(0.15)
    // Fibers run every way: neither axis holds more than 65% of the long strands' extent.
    const across = long.reduce((sum, group) => sum + group.width, 0), down = long.reduce((sum, group) => sum + group.height, 0)
    expect(across / (across + down)).toBeGreaterThan(0.35)
    expect(across / (across + down)).toBeLessThan(0.65)
    // 帘纹: laid lines every 3 px and chain lines every 72 px, both faint.
    const values = delta('xuan')
    const laid = periodicity(profile(values, 1008, 'rows'), 1008 / 3)
    expect(laid.amplitude).toBeGreaterThan(0.006)
    expect(laid.amplitude).toBeLessThan(0.016)
    expect(laid.dominance).toBeGreaterThan(8)
    const chain = periodicity(profile(values, 1008, 'columns'), 1008 / 72)
    expect(chain.amplitude).toBeGreaterThan(0.0008)
    expect(chain.dominance).toBeGreaterThan(1)
  })

  it('羊皮卷 has soft clouds of tone within bounds, pores in clusters, and veins', () => {
    const values = delta('parchment')
    // Clouds: 64 px patches differ clearly, both darker and lighter than the page, but never by much.
    const patches = blockMeans(values, 64)
    expect(std(patches)).toBeGreaterThan(0.012)
    expect(std(patches)).toBeLessThan(0.03)
    expect(Math.min(...patches)).toBeLessThan(-0.02)
    expect(Math.min(...patches)).toBeGreaterThan(-0.065)
    expect(Math.max(...patches)).toBeGreaterThan(0.015)
    expect(Math.max(...patches)).toBeLessThan(0.05)
    // Soft: the cloud layer has no edges; neighboring pixels differ by under 0.8% of the page's luminance.
    const clouds = delta('parchment', ['clouds'])
    let step = 0
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) step = Math.max(step, Math.abs(clouds[y * N + x] - clouds[y * N + (x + 1) % N]), Math.abs(clouds[y * N + x] - clouds[((y + 1) % N) * N + x]))
    expect(step).toBeLessThan(0.008)
    // Pores: thousands of dark dots a few pixels in size.
    const groups = components(marks(delta('parchment', ['pores']), (value) => value < -0.03))
    const pores = groups.filter((group) => group.area <= 14)
    expect(pores.length).toBeGreaterThan(4000)
    expect(pores.length).toBeLessThan(12000)
    // In loose clusters: counts per 64 px patch vary far more than evenly scattered dots would (ratio 1).
    const counts = new Float64Array((N / 64) ** 2)
    for (const pore of pores) counts[Math.floor(pore.y / 64) * (N / 64) + Math.floor(pore.x / 64)]++
    expect(std(counts) ** 2 / mean(counts)).toBeGreaterThan(3)
    expect(Math.min(...counts)).toBeLessThan(mean(counts) / 2.5)
    // Veins: a few long thin dark lines.
    const veins = components(marks(delta('parchment', ['pores']), (value) => value < -0.012)).filter((group) => Math.max(group.width, group.height) >= 120)
    expect(veins.length).toBeGreaterThanOrEqual(5)
  })

  it('牛皮纸 has horizontal fibers, dark and light flecks, and coarse grain', () => {
    const values = delta('kraft')
    // Fiber direction: the sheet stays alike much further across than down.
    for (const lag of [2, 4, 8]) expect(autocorrelation(values, lag, 0), `lag ${lag}`).toBeGreaterThan(2 * autocorrelation(values, 0, lag))
    expect(autocorrelation(values, 4, 0)).toBeGreaterThan(0.3)
    // Streaks: among the marks of the fiber layer, wide ones are common and tall ones all but absent.
    const fibers = delta('kraft', ['fibers'])
    for (const groups of [components(marks(fibers, (value) => value > 0.012)), components(marks(fibers, (value) => value < -0.012))]) {
      const wide = groups.filter((group) => group.width >= 6 && group.width >= 2.5 * group.height).length
      const tall = groups.filter((group) => group.height >= 6 && group.height >= 2.5 * group.width).length
      expect(wide).toBeGreaterThan(1500)
      expect(tall).toBeLessThan(wide / 50)
    }
    // Flecks: compact dots well darker or lighter than the page.
    const compact = (group: { area: number; width: number; height: number }) => group.area >= 2 && group.width <= 5 && group.height <= 5
    expect(components(marks(fibers, (value) => value < -0.05)).filter(compact).length).toBeGreaterThan(400)
    expect(components(marks(fibers, (value) => value > 0.04)).filter(compact).length).toBeGreaterThan(200)
    // Coarse: the roughest of the four papers, by a clear margin over book paper.
    expect(std(values)).toBeGreaterThan(0.025)
    expect(std(values)).toBeGreaterThan(1.4 * std(delta('paper')))
  })

  it('stays clean: no shift of the page color, no stains, no dark blobs', () => {
    // Largest allowed drop of a 7x7 px area below its 33x33 px surroundings. Parchment pores sit in clusters
    // and kraft has flecks, so they get more room; nothing may look like a spot of dirt on book paper or xuan.
    const blob: Record<TextureId, number> = { paper: 0.035, xuan: 0.04, parchment: 0.055, kraft: 0.065 }
    // Largest allowed spread of 64 px patch means. Only parchment has tonal clouds (bounded in its own test).
    const patchy: Record<TextureId, number> = { paper: 0.006, xuan: 0.004, parchment: 0.03, kraft: 0.012 }
    for (const paper of specs) {
      const values = delta(paper.id)
      expect(Math.abs(mean(values)), `${paper.id} mean`).toBeLessThan(0.02)
      expect(percentile(values, 0.01), `${paper.id} darkest 1%`).toBeGreaterThan(-0.09)
      expect(percentile(values, 0.99), `${paper.id} lightest 1%`).toBeLessThan(0.09)
      expect(std(blockMeans(values, 64)), `${paper.id} patches`).toBeLessThan(patchy[paper.id])
      const near = boxMean(values, 3), around = boxMean(values, 16)
      let drop = 0
      for (let i = 0; i < N * N; i++) drop = Math.max(drop, around[i] - near[i])
      expect(drop, `${paper.id} dark blob`).toBeLessThan(blob[paper.id])
    }
  })

  it('keeps body text contrast: at most 5% lost on average, and on the darkest 5% of pixels at default strength', () => {
    for (const paper of specs) {
      const full = contrastKept(paper.id, 1)
      expect(mean(full), `${paper.id} average at full strength`).toBeGreaterThan(0.97)
      // The darkest twentieth of the pixels at full strength: clearly textured, still far from hurting text.
      expect(percentile(full, 0.05), `${paper.id} darkest 5% at full strength`).toBeGreaterThan(0.87)
      const usual = contrastKept(paper.id, DEFAULT_STRENGTH)
      expect(mean(usual), `${paper.id} average at default strength`).toBeGreaterThan(0.98)
      expect(percentile(usual, 0.05), `${paper.id} darkest 5% at default strength`).toBeGreaterThan(0.93)
    }
  })
})
