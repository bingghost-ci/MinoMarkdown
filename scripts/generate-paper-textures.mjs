#!/usr/bin/env node
// Generates the seamless paper texture tiles in src/assets/paper/ (T53).
//
//   node scripts/generate-paper-textures.mjs          # write the tiles
//   node scripts/generate-paper-textures.mjs --check  # exit 1 if a committed tile differs from a fresh build
//
// Only Node built-ins are used: a fixed-seed PRNG draws grain and fibers on a torus so tiles repeat
// without seams, and PNG encoding uses zlib. Each tile is a transparent overlay: light marks are a
// lighter tint of the page, dark marks a darker tint in the same hue, so the page color stays in CSS.
// The quality tests in tests/paper-textures.test.ts decode the committed files with `decodePng`.
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TILE = 256
export const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'paper')

/**
 * `paper` must equal the page color of the style with the same ID in src/features/reading/styles.ts.
 * grain: per-pixel noise strength; fibers: count, length range, alpha, and the share drawn lighter.
 */
export const textureSpecs = [
  { id: 'paper', paper: '#f7f1e3', seed: 11, grain: 0.035, blur: 1, fibers: { count: 70, length: [10, 34], alpha: 0.05, light: 0.55, width: 1 } },
  { id: 'xuan', paper: '#f6f2e6', seed: 23, grain: 0.022, blur: 1, fibers: { count: 120, length: [40, 120], alpha: 0.08, light: 0.85, width: 1, curl: 0.035 } },
  { id: 'kraft', paper: '#dcc49c', seed: 37, grain: 0.05, blur: 1, fibers: { count: 420, length: [4, 14], alpha: 0.075, light: 0.45, width: 1 } },
  { id: 'parchment', paper: '#f1e2bd', seed: 41, grain: 0.04, blur: 1, fibers: { count: 40, length: [8, 26], alpha: 0.04, light: 0.5, width: 1 } },
  { id: 'newsprint', paper: '#ecebe5', seed: 53, grain: 0.045, blur: 0, neutral: true, fibers: { count: 90, length: [3, 9], alpha: 0.06, light: 0.3, width: 1 } },
  { id: 'butter', paper: '#f4e8cb', seed: 67, grain: 0.026, blur: 1, fibers: { count: 30, length: [10, 26], alpha: 0.035, light: 0.6, width: 1 } },
]

function prng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hex(value) {
  const n = parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A signed field: positive values lighten the page, negative values darken it. */
function field(spec) {
  const random = prng(spec.seed)
  const size = TILE
  let values = new Float32Array(size * size)
  for (let i = 0; i < values.length; i++) values[i] = (random() - 0.5) * 2 * spec.grain
  for (let pass = 0; pass < spec.blur; pass++) {
    const next = new Float32Array(values.length)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += values[((y + dy + size) % size) * size + ((x + dx + size) % size)] * (dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1)
      next[y * size + x] = sum / 16 * 1.9
    }
    values = next
  }
  const { count, length, alpha, light, curl = 0.12 } = spec.fibers
  for (let n = 0; n < count; n++) {
    let x = random() * size, y = random() * size
    let angle = random() * Math.PI * 2
    const steps = Math.round(length[0] + random() * (length[1] - length[0]))
    const sign = random() < light ? 1 : -1
    const strength = alpha * (0.55 + random() * 0.45)
    for (let step = 0; step < steps; step++) {
      // Fibers fade in and out, so no blunt ends show.
      const taper = Math.sin(Math.PI * (step + 0.5) / steps)
      const px = ((Math.floor(x) % size) + size) % size, py = ((Math.floor(y) % size) + size) % size
      values[py * size + px] += sign * strength * taper
      angle += (random() - 0.5) * curl
      x += Math.cos(angle); y += Math.sin(angle)
    }
  }
  return values
}

export function renderTexture(spec) {
  const values = field(spec)
  const [r, g, b] = hex(spec.paper)
  const average = (r + g + b) / 3
  const tint = spec.neutral ? [average, average, average] : [r, g, b]
  // Dark marks keep the page hue at about 55% of its value; light marks move toward white.
  const darkInk = tint.map((channel) => channel * 0.55)
  const lightInk = tint.map((channel) => channel + (255 - channel) * 0.85)
  const rgba = new Uint8Array(TILE * TILE * 4)
  for (let i = 0; i < values.length; i++) {
    const value = Math.max(-0.5, Math.min(0.5, values[i]))
    const ink = value >= 0 ? lightInk : darkInk
    rgba[i * 4] = Math.round(ink[0]); rgba[i * 4 + 1] = Math.round(ink[1]); rgba[i * 4 + 2] = Math.round(ink[2])
    // Light marks need more alpha to be seen, because the page is already close to white.
    rgba[i * 4 + 3] = Math.round(Math.abs(value) * 255 * (value >= 0 ? 1.6 : 1))
  }
  return { width: TILE, height: TILE, rgba }
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

/** RGBA, 8 bits per channel, with the Up filter on every row; that compresses noise best here. */
export function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2
    for (let x = 0; x < stride; x++) {
      const above = y > 0 ? rgba[(y - 1) * stride + x] : 0
      raw[y * (stride + 1) + 1 + x] = (rgba[y * stride + x] - above) & 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Decodes the RGBA, non-interlaced PNGs this script writes. */
export function decodePng(buffer) {
  const bytes = Buffer.from(buffer)
  let offset = 8, width = 0, height = 0
  const data = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('Unsupported PNG')
    }
    if (type === 'IDAT') data.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * 4
  const rgba = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0
      const upLeft = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0
      const p = left + up - upLeft
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter]
      rgba[y * stride + x] = (value + predicted) & 255
    }
  }
  return { width, height, rgba }
}

export function texturePath(id) {
  return join(outputDir, `${id}.png`)
}

export function readTexture(id) {
  return readFileSync(texturePath(id))
}

function main() {
  const check = process.argv.includes('--check')
  mkdirSync(outputDir, { recursive: true })
  let stale = 0, total = 0
  for (const spec of textureSpecs) {
    const { width, height, rgba } = renderTexture(spec)
    const png = encodePng(width, height, rgba)
    total += png.length
    if (check) {
      let current = null
      try { current = readTexture(spec.id) } catch { /* missing */ }
      if (!current || !current.equals(png)) { stale++; console.error(`stale: ${spec.id}.png`) }
    } else {
      writeFileSync(texturePath(spec.id), png)
      console.log(`${spec.id}.png ${(png.length / 1024).toFixed(1)} KiB`)
    }
  }
  console.log(`total ${(total / 1024).toFixed(1)} KiB`)
  if (stale) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
