#!/usr/bin/env node
// Repeatable T30 baseline: node scripts/perf-baseline.mjs [output.json]
// Runs in Node (V8), so numbers are comparable between runs, not to WKWebView.
import { build } from 'esbuild'
import { mkdtemp, rm, stat, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'mino-baseline-'))
const entry = join(temp, 'entry.ts')
await writeFile(entry, `export { prepareMarkdown } from ${JSON.stringify(join(root, 'src/core/markdown/codec.ts'))}\nexport { imageUrlsIn } from ${JSON.stringify(join(root, 'src/features/export/snapshot.ts'))}\n`)
const outfile = join(temp, 'bundle.mjs')
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error', nodePaths: [join(root, 'node_modules')] })
const { prepareMarkdown, imageUrlsIn } = await import(pathToFileURL(outfile).href)

const paragraph = '这是一段用于测试的中文内容，包含 **加粗** 和 `代码`。\n\n'
const encoder = new TextEncoder()
const documentOf = (bytes) => paragraph.repeat(Math.ceil(bytes / encoder.encode(paragraph).length))
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const timed = (fn) => { const started = performance.now(); fn(); return performance.now() - started }
const measure = (fn, runs = 3) => Math.round(median(Array.from({ length: runs }, () => timed(fn))))

const result = { runtime: `node ${process.version}`, documents: {}, images: {}, dist: null }
for (const [label, bytes] of [['100KiB', 100 * 1024], ['1MiB', 1024 * 1024], ['3MiB', 3 * 1024 * 1024]]) {
  const markdown = documentOf(bytes)
  result.documents[label] = { chars: markdown.length, prepareMarkdownMs: measure(() => prepareMarkdown(markdown)), imageUrlsInMs: measure(() => imageUrlsIn(markdown)) }
}
const imageDocument = Array.from({ length: 20 }, (_, index) => `${paragraph}![图片${index}](assets/image-${index}.png)\n\n`).join('')
result.images.twentyImageDocument = { prepareMarkdownMs: measure(() => prepareMarkdown(imageDocument)), imageUrlsInMs: measure(() => imageUrlsIn(imageDocument)), found: imageUrlsIn(imageDocument).length }
const bytes = new Uint8Array(1024 * 1024)
for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
let json = 0
result.images.twentyOneMiBAsNumberArrayJson = { ms: measure(() => { json = 0; for (let index = 0; index < 20; index++) json += JSON.stringify(Array.from(bytes)).length }), jsonMiB: Math.round(json / 1048576) }
try {
  const assets = join(root, 'dist/assets')
  const files = await Promise.all((await readdir(assets)).map(async (name) => ({ name, size: (await stat(join(assets, name))).size })))
  const total = files.reduce((sum, file) => sum + file.size, 0)
  const largest = files.sort((a, b) => b.size - a.size)[0]
  result.dist = { totalKiB: Math.round(total / 1024), largest: largest.name, largestKiB: Math.round(largest.size / 1024), katexFiles: files.filter((file) => file.name.startsWith('KaTeX')).length }
} catch { result.dist = 'dist/assets missing; run npm run build first' }
await rm(temp, { recursive: true, force: true })
const output = JSON.stringify(result, null, 2)
console.log(output)
if (process.argv[2]) await writeFile(process.argv[2], output + '\n')
