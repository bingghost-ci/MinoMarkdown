import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/generate-scale-fixtures.mjs <empty-temp-directory>')
  process.exit(2)
}
const root = resolve(target)
const records = []
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function record(relative, bytes) {
  const destination = join(root, relative)
  await mkdir(resolve(destination, '..'), { recursive: true })
  await writeFile(destination, bytes, { flag: 'wx' })
  records.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) })
}

function documentBytes(size, lines) {
  const width = Math.floor(size / lines)
  const extra = size % lines
  const chunks = []
  for (let i = 0; i < lines; i++) {
    const prefix = `- item ${String(i).padStart(5, '0')} `
    const lineSize = width + (i < extra ? 1 : 0)
    chunks.push(prefix + 'x'.repeat(lineSize - prefix.length - 1) + '\n')
  }
  return Buffer.from(chunks.join(''))
}

function chunk(name, payload) {
  const table = chunk.crcTable ??= Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
    return n >>> 0
  })
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  let crc = 0xffffffff
  for (const byte of Buffer.concat([Buffer.from(name), payload])) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8)
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, Buffer.from(name), payload, trailer])
}

function imageBytes(seed) {
  const width = 512
  const height = 512
  let state = seed >>> 0
  const raw = Buffer.alloc(height * (1 + width * 4))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0
    for (let x = 0; x < width; x++) {
      for (let color = 0; color < 3; color++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5
        raw[offset++] = state & 255
      }
      raw[offset++] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

await mkdir(root, { recursive: true })
for (const [name, size, lines] of [
  ['ordinary-100KiB.md', 100 * 1024, 1000],
  ['middle-1MiB-10000-lines.md', 1024 * 1024, 10000],
  ['boundary-5MiB.md', 5 * 1024 * 1024, 50000],
]) await record(`documents/${name}`, documentBytes(size, lines))

for (let i = 0; i < 10000; i++) {
  await record(`directory/doc-${String(i).padStart(5, '0')}.md`, Buffer.from(`# Synthetic ${i}\n`))
}
for (let i = 0; i < 20; i++) {
  await record(`images/image-${String(i).padStart(2, '0')}.png`, imageBytes(i + 1))
}
const manifest = {
  id: 'F10', generator: 'scripts/generate-scale-fixtures.mjs', seed: 'xorshift32(index+1)',
  count: records.length, totalBytes: records.reduce((sum, item) => sum + item.bytes, 0), records,
}
const manifestText = JSON.stringify(manifest, null, 2) + '\n'
const manifestSha256 = sha256(Buffer.from(manifestText))
await writeFile(join(root, 'manifest.json'), manifestText, { flag: 'wx' })
const expected = JSON.parse(await readFile(new URL('../tests/fixtures/F10-scale.json', import.meta.url), 'utf8')).expected
if (manifest.count !== expected.count || manifest.totalBytes !== expected.totalBytes || manifestSha256 !== expected.manifestSha256) {
  throw new Error('F10 generated fixture manifest differs from its locked expectation')
}
for (const item of expected.documents) {
  const actual = records.find((record) => record.path === item.path)
  if (!actual || actual.bytes !== item.bytes || actual.sha256 !== item.sha256) {
    throw new Error(`F10 document differs from its locked expectation: ${item.path}`)
  }
}
console.log(JSON.stringify({ root, count: manifest.count, totalBytes: manifest.totalBytes, manifestSha256, verified: true }))
