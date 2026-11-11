#!/usr/bin/env node
// Generates the seamless paper texture layers in src/assets/paper/ (T63).
//
//   node scripts/generate-paper-textures.mjs          # write the layers
//   node scripts/generate-paper-textures.mjs --check  # exit 1 if a committed layer differs from a fresh build
//
// Each paper is a stack of transparent overlay PNGs that CSS draws as multiple backgrounds over the page
// color: a small grain tile, and structure layers (fibers, laid lines, tonal clouds, pores) whose period is
// 1024 CSS px so a page never shows a repeat. Light marks are a lighter tint of the page and dark marks a
// darker tint in the same hue, so the page color itself stays in CSS.
//
// Only Node built-ins are used. A fixed-seed PRNG draws everything on a torus, so layers wrap without seams
// and the output is deterministic. Layers are written as 8-bit palette PNGs with alpha (a few dozen
// ink/alpha pairs each), which keeps a 1024 px layer far smaller than RGBA noise would be.
// tests/paper-textures.test.ts decodes the committed files with `decodePng`.
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The smallest repeat, in CSS px, that every paper must reach in at least one layer. */
export const PERIOD = 1024
export const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'paper')

// ---------------------------------------------------------------------------------------------------------
// Helpers. A field is a Float32Array of signed luminance changes relative to the page: -0.02 is 2% darker.

function prng(seed) {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  random.gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  random.range = (low, high) => low + random() * (high - low)
  return random
}

function hex(value) {
  const n = parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const wrap = (value, size) => ((value % size) + size) % size

function noise(width, height, random) {
  const values = new Float32Array(width * height)
  for (let i = 0; i < values.length; i++) values[i] = random.gauss()
  return values
}

/** Three wrapped box blurs per axis, close to a Gaussian of the given standard deviations. */
function blur(values, width, height, sigmaX, sigmaY = sigmaX) {
  let current = values
  const pass = (source, radius, horizontal) => {
    if (radius < 1) return source
    const out = new Float32Array(source.length)
    const [outer, inner] = horizontal ? [height, width] : [width, height]
    const span = 2 * radius + 1
    for (let o = 0; o < outer; o++) {
      const at = (i) => (horizontal ? o * width + wrap(i, inner) : wrap(i, inner) * width + o)
      let sum = 0
      for (let i = -radius; i <= radius; i++) sum += source[at(i)]
      for (let i = 0; i < inner; i++) {
        out[at(i)] = sum / span
        sum += source[at(i + radius + 1)] - source[at(i - radius)]
      }
    }
    return out
  }
  const radiusFor = (sigma) => Math.round(Math.sqrt(sigma * sigma * 4 + 1) / 2 - 0.5)
  for (let n = 0; n < 3; n++) { current = pass(current, radiusFor(sigmaX), true); current = pass(current, radiusFor(sigmaY), false) }
  return current
}

/** A small wrapped 3x3 smoothing, for radii below one pixel. */
function soften(values, width, height, amount = 1) {
  const out = new Float32Array(values.length)
  const side = amount, corner = amount * amount, total = 1 + 4 * side + 4 * corner
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += values[wrap(y + dy, height) * width + wrap(x + dx, width)] * (dx === 0 && dy === 0 ? 1 : dx === 0 || dy === 0 ? side : corner)
    out[y * width + x] = sum / total
  }
  return out
}

function normalize(values, target = 1) {
  let sum = 0, squares = 0
  for (const value of values) { sum += value; squares += value * value }
  const mean = sum / values.length
  const deviation = Math.sqrt(Math.max(1e-12, squares / values.length - mean * mean))
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - mean) / deviation * target
  return values
}

/**
 * Smooth periodic clouds: a sum of cosines with whole-number wave vectors, so the result wraps exactly.
 * Waves from `low` to `high` cycles per tile are used, with amplitude falling as 1/k^falloff.
 */
function clouds(size, random, { low = 1, high = 6, falloff = 1.2, stretchX = 1 } = {}) {
  const values = new Float32Array(size * size)
  const cosine = Float32Array.from({ length: size }, (_, i) => Math.cos(2 * Math.PI * i / size))
  for (let ky = 0; ky <= high; ky++) for (let kx = -high; kx <= high; kx++) {
    if (ky === 0 && kx <= 0) continue
    const k = Math.hypot(kx / stretchX, ky)
    if (k < low || k > high) continue
    const amplitude = random.gauss() / Math.pow(k, falloff)
    const phase = Math.floor(random() * size)
    for (let y = 0; y < size; y++) {
      const row = y * size, offset = ky * y + phase
      for (let x = 0; x < size; x++) values[row + x] += amplitude * cosine[wrap(kx * x + offset, size)]
    }
  }
  return normalize(values)
}

/** Samples a wrapped field at a fractional position, for fields kept at a lower resolution. */
function sample(values, size, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const at = (ix, iy) => values[wrap(iy, size) * size + wrap(ix, size)]
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
}

function splat(values, size, x, y, weight) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const xa = wrap(x0, size), xb = wrap(x0 + 1, size), ya = wrap(y0, size) * size, yb = wrap(y0 + 1, size) * size
  values[ya + xa] += weight * (1 - fx) * (1 - fy)
  values[ya + xb] += weight * fx * (1 - fy)
  values[yb + xa] += weight * (1 - fx) * fy
  values[yb + xb] += weight * fx * fy
}

/**
 * Draws one antialiased fiber about a pixel wide. `curl` is how fast its curvature wanders, `bend` a steady
 * curvature; the ends taper over `taper` of the length so nothing ends bluntly.
 */
function fiber(values, size, random, { x, y, angle, length, weight, curl = 0, bend = 0, taper = 0.25 }) {
  let curvature = bend
  const steps = Math.max(2, Math.round(length * 2))
  for (let step = 0; step < steps; step++) {
    const t = (step + 0.5) / steps
    const fade = Math.min(1, t / taper, (1 - t) / taper)
    splat(values, size, x, y, weight * 0.5 * fade)
    curvature = curvature * 0.985 + random.gauss() * curl
    angle += curvature * 0.5
    x += Math.cos(angle) * 0.5; y += Math.sin(angle) * 0.5
  }
}

/** A soft round dot of the given radius (in pixels). */
function dot(values, size, x, y, radius, weight) {
  const reach = Math.ceil(radius + 1)
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const px = Math.floor(x) + dx, py = Math.floor(y) + dy
    const distance = Math.hypot(px + 0.5 - x, py + 0.5 - y)
    const cover = Math.max(0, Math.min(1, radius + 0.5 - distance))
    if (cover > 0) values[wrap(py, size) * size + wrap(px, size)] += weight * cover
  }
}

// ---------------------------------------------------------------------------------------------------------
// The papers. Every layer function returns a square field of `pixels` side.

/** 书页: felt-pressed book paper. Embossed fine grain, faint laid lines, a few tiny inclusions. */
const paper = {
  id: 'paper', paper: '#f6efe0', dark: [0.56, 0.5, 0.4], light: 1,
  layers: [
    {
      // Sparse short hairs and specks, and a very soft unevenness of tone, over a 1024 px period.
      name: 'fibers', pixels: 1024, size: 1024, step: 3,
      render(size) {
        const random = prng(1101)
        const values = new Float32Array(size * size)
        for (let n = 0; n < 2600; n++) {
          const light = random() < 0.5
          fiber(values, size, random, { x: random() * size, y: random() * size, angle: random() * Math.PI * 2, length: random.range(5, 22), weight: (light ? 0.02 : -0.03) * random.range(0.5, 1), curl: 0.05, bend: random.gauss() * 0.06 })
        }
        for (let n = 0; n < 700; n++) dot(values, size, random() * size, random() * size, random.range(0.1, 0.5), -0.04 * random.range(0.4, 1))
        const tone = clouds(128, random, { low: 2, high: 9, falloff: 1 })
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) values[y * size + x] += 0.004 * sample(tone, 128, x / 8, y / 8)
        return values
      },
    },
    {
      // Laid lines 4 px apart with chain lines every 96 px, as the mould wires leave them.
      name: 'laid', pixels: 384, size: 384, step: 1,
      render(size) {
        const random = prng(1102)
        const values = new Float32Array(size * size)
        const wobble = clouds(96, random, { low: 1, high: 5, falloff: 1 })
        const strength = clouds(96, random, { low: 1, high: 4, falloff: 1 })
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const shift = 0.5 * sample(wobble, 96, x / 4, y / 4)
          const line = Math.cos(2 * Math.PI * (y + shift) / 4)
          const chain = Math.exp(-((x % 96 - 48) ** 2) / 3)
          values[y * size + x] = (0.011 * line - 0.012 * chain) * (1 + 0.3 * sample(strength, 96, x / 4, y / 4))
        }
        return values
      },
    },
    {
      // Felt grain: a fine height field lit from the top left, which reads as pressed relief rather than dirt.
      name: 'grain', pixels: 256, size: 256, step: 2,
      render(size) {
        const random = prng(1103)
        const fine = normalize(soften(noise(size, size, random), size, size, 0.6))
        const coarse = normalize(blur(noise(size, size, random), size, size, 1.1))
        const values = new Float32Array(size * size)
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = y * size + x, j = wrap(y - 1, size) * size + wrap(x - 1, size)
          values[i] = 0.009 * (fine[i] - fine[j]) + 0.022 * (coarse[i] - coarse[j])
        }
        return values
      },
    },
  ],
}

/** 宣纸: long thin fibers, mostly lighter than the sheet, over the fine laid lines of the bamboo screen. */
const xuan = {
  id: 'xuan', paper: '#f5f3ea', dark: [0.6, 0.57, 0.5], light: 1,
  layers: [
    {
      name: 'fibers', pixels: 1024, size: 1024, step: 4,
      render(size) {
        const random = prng(2301)
        const values = new Float32Array(size * size)
        // Long fibers swirl gently. Most are lighter than the sheet; one in six is a darker strand.
        for (let n = 0; n < 800; n++) {
          const dark = random() < 0.16
          const length = 50 * Math.exp(random.range(0, 2.1))
          fiber(values, size, random, { x: random() * size, y: random() * size, angle: random() * Math.PI * 2, length, weight: (dark ? -0.03 : 0.034) * random.range(0.45, 1), curl: 0.0012, bend: random.gauss() * 0.004, taper: 0.3 })
        }
        // A few thick bundles, each several strands running side by side.
        for (let n = 0; n < 36; n++) {
          const x = random() * size, y = random() * size, angle = random() * Math.PI * 2, length = random.range(120, 420), bend = random.gauss() * 0.003
          const dark = random() < 0.3
          for (let strand = 0; strand < 3; strand++) {
            const fork = prng(9000 + n)
            fiber(values, size, fork, { x: x + Math.sin(angle) * strand * 0.7, y: y - Math.cos(angle) * strand * 0.7, angle, length, weight: dark ? -0.026 : 0.032, curl: 0.001, bend, taper: 0.35 })
          }
        }
        // Short fine hairs fill the sheet between the long fibers.
        for (let n = 0; n < 4000; n++) fiber(values, size, random, { x: random() * size, y: random() * size, angle: random() * Math.PI * 2, length: random.range(8, 40), weight: (random() < 0.2 ? -0.014 : 0.016) * random.range(0.4, 1), curl: 0.01, bend: random.gauss() * 0.015 })
        return values
      },
    },
    {
      // 帘纹: laid lines 3 px apart, chain lines every 72 px, both slightly irregular.
      name: 'laid', pixels: 432, size: 432, step: 1,
      render(size) {
        const random = prng(2302)
        const values = new Float32Array(size * size)
        const wobble = clouds(108, random, { low: 1, high: 6, falloff: 1 })
        const strength = clouds(108, random, { low: 1, high: 5, falloff: 1 })
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const bend = sample(wobble, 108, x / 4, y / 4)
          const line = Math.cos(2 * Math.PI * (y + 0.45 * bend) / 3)
          const chain = Math.exp(-(((x + 0.8 * bend + 72) % 72 - 36) ** 2) / 2.2)
          values[y * size + x] = (0.013 * line - 0.02 * chain) * (1 + 0.35 * sample(strength, 108, x / 4, y / 4)) - 0.004
        }
        return values
      },
    },
    {
      // A soft felted mat. Its mean is slightly below the page so the white fibers above have room to show.
      name: 'grain', pixels: 256, size: 256, step: 2,
      render(size) {
        const random = prng(2303)
        const mat = new Float32Array(size * size)
        for (let n = 0; n < 2600; n++) fiber(mat, size, random, { x: random() * size, y: random() * size, angle: random() * Math.PI * 2, length: random.range(5, 18), weight: random() < 0.5 ? 1 : -1, curl: 0.06, bend: random.gauss() * 0.08 })
        const soft = normalize(soften(mat, size, size, 0.5))
        const fine = normalize(noise(size, size, random))
        const values = new Float32Array(size * size)
        for (let i = 0; i < values.length; i++) values[i] = 0.007 * soft[i] + 0.0035 * fine[i] - 0.01
        return values
      },
    },
  ],
}

/** 羊皮卷: skin. Large soft clouds of tone, pores in loose clusters, faint veins. No vignette: CSS adds the aged edges. */
const parchment = {
  id: 'parchment', paper: '#ead6a8', dark: [0.52, 0.42, 0.28], light: 0.7,
  layers: [
    {
      name: 'pores', pixels: 1024, size: 1024, step: 4,
      render(size) {
        const random = prng(4101)
        const values = new Float32Array(size * size)
        // Pores gather where the density field is high, as hair follicles do on skin.
        const density = clouds(128, random, { low: 2, high: 10, falloff: 0.8 })
        let placed = 0
        while (placed < 11000) {
          const x = random() * size, y = random() * size
          if (random() > 1 / (1 + Math.exp(-2.2 * (sample(density, 128, x / 8, y / 8) - 0.5)))) continue
          dot(values, size, x, y, random.range(0.3, 1.0), -0.14 * random.range(0.45, 1))
          placed++
        }
        // Veins: long faint lines that branch once or twice.
        for (let n = 0; n < 26; n++) {
          const x = random() * size, y = random() * size, angle = random() * Math.PI * 2
          const length = random.range(180, 520), weight = -0.045 * random.range(0.6, 1)
          fiber(values, size, random, { x, y, angle, length, weight, curl: 0.0006, bend: random.gauss() * 0.0008, taper: 0.4 })
          for (let branch = 0; branch < 2; branch++) {
            // The trunk bends little, so a point on its starting line is close enough for a branch to leave from.
            const along = random.range(0.25, 0.7) * length
            fiber(values, size, random, { x: x + Math.cos(angle) * along, y: y + Math.sin(angle) * along, angle: angle + (random() < 0.5 ? 1 : -1) * random.range(0.35, 0.8), length: random.range(60, 200), weight: weight * 0.75, curl: 0.004, taper: 0.45 })
          }
        }
        // Short light scratches and creases.
        for (let n = 0; n < 900; n++) fiber(values, size, random, { x: random() * size, y: random() * size, angle: random() * Math.PI * 2, length: random.range(6, 40), weight: 0.022 * random.range(0.4, 1), curl: 0.02, bend: random.gauss() * 0.03 })
        return soften(values, size, size, 0.12)
      },
    },
    {
      // 云状色斑: warm darker and lighter areas, stored at a quarter of its drawn size because it is all blur.
      name: 'clouds', pixels: 256, size: 1024, step: 1,
      render(size) {
        const random = prng(4102)
        const broad = clouds(size, random, { low: 1, high: 5, falloff: 1.1 })
        const mid = clouds(size, random, { low: 4, high: 14, falloff: 1.3 })
        const mottle = clouds(size, random, { low: 16, high: 44, falloff: 0.5 })
        const values = new Float32Array(size * size)
        for (let i = 0; i < values.length; i++) {
          const v = 0.75 * broad[i] + 0.6 * mid[i] + 0.28 * mottle[i]
          // Darker patches are a little stronger than lighter ones, as stains on skin are.
          values[i] = (v < 0 ? 0.033 : 0.026) * Math.tanh(v * 0.9) / 0.72
        }
        return values
      },
    },
    {
      name: 'grain', pixels: 256, size: 256, step: 2,
      render(size) {
        const random = prng(4103)
        const fine = normalize(soften(noise(size, size, random), size, size, 0.5))
        const skin = normalize(blur(noise(size, size, random), size, size, 2.2))
        const values = new Float32Array(size * size)
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = y * size + x, j = wrap(y - 1, size) * size + wrap(x - 1, size)
          values[i] = 0.007 * fine[i] + 0.012 * (skin[i] - skin[j])
        }
        return values
      },
    },
  ],
}

/** 牛皮纸: unbleached pulp. Short streaks along the machine direction, dark and light flecks, coarse grain. */
const kraft = {
  id: 'kraft', paper: '#c9a878', dark: [0.5, 0.44, 0.34], light: 0.6,
  layers: [
    {
      name: 'fibers', pixels: 1024, size: 1024, step: 6,
      render(size) {
        const random = prng(3701)
        const values = new Float32Array(size * size)
        for (let n = 0; n < 12000; n++) {
          const light = random() < 0.5
          fiber(values, size, random, { x: random() * size, y: random() * size, angle: random.gauss() * 0.13 + (random() < 0.5 ? 0 : Math.PI), length: 6 * Math.exp(random.range(0, 2.2)), weight: (light ? 0.09 : -0.08) * random.range(0.4, 1), curl: 0.002, bend: random.gauss() * 0.003, taper: 0.3 })
        }
        // 杂点: bark specks and pale shives.
        for (let n = 0; n < 2600; n++) dot(values, size, random() * size, random() * size, random.range(0.3, 0.95), -0.11 * random.range(0.4, 1))
        for (let n = 0; n < 1500; n++) dot(values, size, random() * size, random() * size, random.range(0.3, 0.9), 0.09 * random.range(0.4, 1))
        // A few long dark splinters.
        for (let n = 0; n < 160; n++) fiber(values, size, random, { x: random() * size, y: random() * size, angle: random.gauss() * 0.3, length: random.range(8, 26), weight: -0.1, curl: 0.004, taper: 0.2 })
        return values
      },
    },
    {
      // Uneven pulp density, drawn out along the fiber direction; all blur, so stored small.
      name: 'clouds', pixels: 256, size: 1024, step: 1,
      render(size) {
        const random = prng(3702)
        const values = clouds(size, random, { low: 3, high: 20, falloff: 0.9, stretchX: 0.45 })
        for (let i = 0; i < values.length; i++) values[i] *= 0.011
        return values
      },
    },
    {
      // Coarse grain, smeared horizontally.
      name: 'grain', pixels: 256, size: 256, step: 3,
      render(size) {
        const random = prng(3703)
        const streak = normalize(blur(noise(size, size, random), size, size, 2.4, 0.6))
        const fine = normalize(noise(size, size, random))
        const lumpy = normalize(blur(noise(size, size, random), size, size, 1.3))
        const values = new Float32Array(size * size)
        for (let i = 0; i < values.length; i++) values[i] = 0.017 * streak[i] + 0.011 * fine[i] + 0.01 * lumpy[i]
        return values
      },
    },
  ],
}

/**
 * The papers, with their layers listed top first (the order of CSS `background-image`). `paper` is the page
 * color the layers are tinted for; `pixels` is a layer's stored side and `size` the side it is drawn at, in
 * CSS px; `step` is the alpha quantization in 1/255 units.
 */
export const textureSpecs = [paper, xuan, parchment, kraft]

// ---------------------------------------------------------------------------------------------------------
// Rendering and PNG.

/** Renders one layer to palette indices plus the palette of [r, g, b, a] entries. */
export function renderLayer(spec, layer) {
  const size = layer.pixels
  const values = layer.render(size)
  const page = hex(spec.paper)
  const darkInk = page.map((channel, k) => Math.round(channel * spec.dark[k]))
  const lightInk = page.map((channel) => Math.round(channel + (255 - channel) * spec.light))
  // How much luminance a fully opaque mark of each ink changes, as a fraction of the page's.
  const darkReach = 1 - luminance(darkInk) / luminance(page), lightReach = luminance(lightInk) / luminance(page) - 1
  const palette = [[0, 0, 0, 0]]
  const slots = new Map([[0, 0]])
  const indices = new Uint8Array(size * size)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const alpha = Math.min(230, Math.round(Math.min(1, Math.abs(value) / (value < 0 ? darkReach : lightReach)) * 255 / layer.step) * layer.step)
    const key = alpha === 0 ? 0 : value < 0 ? -alpha : alpha
    let slot = slots.get(key)
    if (slot === undefined) {
      slot = palette.length
      if (slot > 255) throw new Error(`${spec.id}-${layer.name}: more than 256 palette entries; raise its step`)
      slots.set(key, slot)
      palette.push([...(value < 0 ? darkInk : lightInk), alpha])
    }
    indices[i] = slot
  }
  // Palette order must not depend on where a value first appears, or small edits would reshuffle the file.
  const order = [...slots.entries()].sort((a, b) => a[0] - b[0])
  const remap = new Uint8Array(palette.length)
  const sorted = order.map(([, slot], position) => { remap[slot] = position; return palette[slot] })
  for (let i = 0; i < indices.length; i++) indices[i] = remap[indices[i]]
  return { width: size, height: size, indices, palette: sorted }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** An 8-bit palette PNG with a tRNS chunk, unfiltered rows. */
export function encodePng({ width, height, indices, palette }) {
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) Buffer.from(indices.buffer, indices.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 3; header[10] = 0; header[11] = 0; header[12] = 0
  const colors = Buffer.from(palette.flatMap(([r, g, b]) => [r, g, b]))
  const alphas = Buffer.from(palette.map((entry) => entry[3]))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('PLTE', colors), chunk('tRNS', alphas), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Decodes the 8-bit palette (or RGBA), non-interlaced PNGs this script writes into RGBA. */
export function decodePng(buffer) {
  const bytes = Buffer.from(buffer)
  let offset = 8, width = 0, height = 0, type = 6, colors = null, alphas = Buffer.alloc(0)
  const data = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const name = bytes.toString('ascii', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (name === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9]
      if (body[8] !== 8 || (type !== 6 && type !== 3) || body[12] !== 0) throw new Error('Unsupported PNG')
    }
    if (name === 'PLTE') colors = body
    if (name === 'tRNS') alphas = body
    if (name === 'IDAT') data.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const channels = type === 6 ? 4 : 1
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      const p = left + up - upLeft
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter]
      pixels[y * stride + x] = (value + predicted) & 255
    }
  }
  if (type === 6) return { width, height, rgba: pixels }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < pixels.length; i++) {
    const slot = pixels[i]
    rgba[i * 4] = colors[slot * 3]; rgba[i * 4 + 1] = colors[slot * 3 + 1]; rgba[i * 4 + 2] = colors[slot * 3 + 2]
    rgba[i * 4 + 3] = slot < alphas.length ? alphas[slot] : 255
  }
  return { width, height, rgba }
}

export function layerFile(spec, layer) {
  return `${spec.id}-${layer.name}.png`
}

export function readLayer(spec, layer) {
  return readFileSync(join(outputDir, layerFile(spec, layer)))
}

function main() {
  const check = process.argv.includes('--check')
  mkdirSync(outputDir, { recursive: true })
  const expected = new Set()
  let stale = 0, total = 0
  for (const spec of textureSpecs) {
    let sum = 0
    for (const layer of spec.layers) {
      const png = encodePng(renderLayer(spec, layer))
      const file = layerFile(spec, layer)
      expected.add(file)
      sum += png.length
      if (check) {
        let current = null
        try { current = readLayer(spec, layer) } catch { /* missing */ }
        if (!current || !current.equals(png)) { stale++; console.error(`stale: ${file}`) }
      } else {
        writeFileSync(join(outputDir, file), png)
        console.log(`${file} ${layer.pixels}px drawn at ${layer.size}px, ${(png.length / 1024).toFixed(1)} KiB`)
      }
    }
    console.log(`${spec.id} ${(sum / 1024).toFixed(1)} KiB`)
    total += sum
  }
  // Files of papers or layers that no longer exist would still be inlined by the app's glob.
  for (const file of readdirSync(outputDir)) {
    if (expected.has(file)) continue
    if (check) { stale++; console.error(`unexpected: ${file}`) } else { rmSync(join(outputDir, file)); console.log(`removed ${file}`) }
  }
  console.log(`total ${(total / 1024).toFixed(1)} KiB`)
  if (stale) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
