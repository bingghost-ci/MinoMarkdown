#!/usr/bin/env node
// Repeatable T30 baseline: node scripts/perf-baseline.mjs [output.json]
// Runs in Node (V8), so numbers are comparable between runs, not to WKWebView.
import { build } from 'esbuild'
import { mkdtemp, rm, stat, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'mino-baseline-'))
const entry = join(temp, 'entry.ts')
const sources = {
  'src/core/markdown/codec.ts': ['prepareMarkdown'],
  'src/features/export/snapshot.ts': ['imageUrlsIn', 'rewriteImageUrls'],
  'src/features/editor/findText.ts': ['findInText'],
  'src/core/markdown/compatibility.ts': ['analyzeMarkdown'],
  'src/features/editor/markdownStringify.ts': ['safeTextHandler'],
}
await writeFile(entry, Object.entries(sources).map(([file, names]) => `export { ${names.join(', ')} } from ${JSON.stringify(join(root, file))}\n`).join('') + `export { unified } from 'unified'\nexport { default as remarkParse } from 'remark-parse'\nexport { default as remarkGfm } from 'remark-gfm'\nexport { default as remarkStringify } from 'remark-stringify'\n`)
const outfile = join(temp, 'bundle.mjs')
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error', nodePaths: [join(root, 'node_modules')] })
const { prepareMarkdown, imageUrlsIn, rewriteImageUrls, findInText, analyzeMarkdown, safeTextHandler, unified, remarkParse, remarkGfm, remarkStringify } = await import(pathToFileURL(outfile).href)

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
// T91: the paths T92-T100 change. Medians of five runs; only comparable between runs of this script.
const oneMiB = documentOf(1024 * 1024)
const withImages = oneMiB + Array.from({ length: 20 }, (_, index) => `![图片${index}](assets/image-${index}.png)\n\n`).join('')
const replacements = new Map(Array.from({ length: 20 }, (_, index) => [`assets/image-${index}.png`, `mino-asset://localhost/key/image-${index}.png`]))
result.t91 = {
  rewriteImageUrls1MiB20ImagesMs: measure(() => rewriteImageUrls(withImages, replacements), 5),
  imageUrlsIn1MiB20ImagesMs: measure(() => imageUrlsIn(withImages), 5),
  findInText1MiBSingleCharMs: measure(() => findInText(oneMiB, '的'), 5),
  findInText1MiBSingleCharMatches: findInText(oneMiB, '的').length,
}
// Serializing 2000 paragraphs that hold `$`: each run parses anew, as the editor builds a new tree for every save.
const dollars = Array.from({ length: 2000 }, (_, index) => `第 ${index} 项的价格是 $${index} 一斤，折后 $${index / 2}。`).join('\n\n')
const dollarParser = unified().use(remarkParse).use(remarkGfm)
const dollarWriter = unified().use(remarkStringify, { handlers: { text: safeTextHandler } })
const serializeDollars = () => { const tree = dollarParser.parse(dollars); return timed(() => dollarWriter.stringify(tree)) }
result.t91.dollarSerializeFirstMs = Math.round(serializeDollars())
result.t91.dollarSerializeLaterMs = Math.round(median(Array.from({ length: 5 }, serializeDollars)))
// 2000 formulas written as `$$x$$` on one line: each is an issue whose line number is looked up.
const formulas = Array.from({ length: 2000 }, (_, index) => `${paragraph.repeat(4)}$$x_{${index}}$$\n\n`).join('')
const formulaBytes = encoder.encode(formulas)
result.t91.analyze2000FormulaIssuesMs = measure(() => analyzeMarkdown(formulaBytes), 5)
result.t91.analyze2000FormulaIssues = analyzeMarkdown(formulaBytes).issues.length
try {
  const html = await readFile(join(root, 'dist/index.html'), 'utf8')
  const name = /<script[^>]+src="\/?(assets\/[^"]+\.js)"/.exec(html)?.[1]
  const workers = (await readdir(join(root, 'dist/assets'))).filter((file) => /^analysis\.worker-.*\.js$/.test(file))
  result.entry = { file: name, bytes: (await stat(join(root, 'dist', name))).size, analysisWorkerBytes: workers.length === 1 ? (await stat(join(root, 'dist/assets', workers[0]))).size : null }
} catch { result.entry = 'dist/index.html missing; run npm run build first' }
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
