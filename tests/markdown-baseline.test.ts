import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeMarkdown, compareMarkdown } from '../src/core/markdown/compatibility'

type Fixture = { id: string; path: string; sha256: string; mode: 'visual' | 'source-protected' | 'asset'; checkpoints: string[] }
const root = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/manifest.json', import.meta.url), 'utf8')) as Fixture[]
const enc = new TextEncoder()

function bytes(id: string): Uint8Array {
  const fixture = fixtures.find((item) => item.id === id)
  if (!fixture) throw new Error(`Missing fixture ${id}`)
  return readFileSync(root + fixture.path)
}

describe('T02 Markdown compatibility baseline', () => {
  it('locks every fixture to its expected raw bytes', () => {
    for (const fixture of fixtures) {
      expect(createHash('sha256').update(readFileSync(root + fixture.path)).digest('hex'), fixture.id).toBe(fixture.sha256)
    }
  })

  it.each(fixtures.filter((item) => item.mode !== 'asset'))('$id has the declared mode', (fixture) => {
    expect(analyzeMarkdown(bytes(fixture.id)).mode).toBe(fixture.mode)
  })

  it.each(fixtures.filter((item) => item.mode === 'visual'))('$id preserves AST semantics after serialization', (fixture) => {
    const original = bytes(fixture.id)
    const analysis = analyzeMarkdown(original)
    expect(analysis.issues).toEqual([])
    expect(analysis.serialized).toBeDefined()
    expect(compareMarkdown(original, enc.encode(analysis.serialized!))).toEqual([])
  })

  it('preserves raw front matter, BOM, CRLF, and missing final newline', () => {
    const front = analyzeMarkdown(bytes('F08a'))
    expect(front.frontMatter).toContain('title: "原样保留: #1"')
    expect(front.serialized).toContain(front.frontMatter)
    const raw = analyzeMarkdown(bytes('F09a'))
    expect(raw.bom).toBe(true)
    expect(raw.newline).toBe('CRLF')
    expect(raw.trailingNewline).toBe(false)
    expect(raw.serialized?.startsWith('\uFEFF')).toBe(true)
    expect(raw.serialized?.endsWith('\n')).toBe(false)
    expect(raw.serialized).toContain('\r\n')
    expect(analyzeMarkdown(bytes('F09c')).serialized).toBe('')
    expect(analyzeMarkdown(bytes('F09d')).issues.map((issue) => issue.code)).toContain('MIXED_NEWLINES')
  })

  it('parses the declared list, code, link and table semantics', () => {
    const lists = JSON.stringify(analyzeMarkdown(bytes('F02')).semantics)
    expect(lists).toContain('"start":3')
    expect(lists).toContain('"checked":true')
    expect(lists).toContain('"checked":false')
    const code = JSON.stringify(analyzeMarkdown(bytes('F03')).semantics)
    expect(code).toContain('"lang":"mermaid"')
    expect(code).toContain('console.log(value);')
    const links = JSON.stringify(analyzeMarkdown(bytes('F04')).semantics)
    expect(links).toContain('https://example.org/path?q=1')
    expect(links).toContain('./assets/中文%20图片%23%25%28a%29.png')
    const table = JSON.stringify(analyzeMarkdown(bytes('F05')).semantics)
    expect(table).toContain('"align":["left","right","center"]')
    expect(table).toContain('A|B 与 ')
  })

  it('reports math and directive syntax and retains the source', () => {
    const raw = bytes('F08b')
    const analysis = analyzeMarkdown(raw)
    expect(analysis.mode).toBe('source-protected')
    expect(analysis.issues.map((issue) => issue.code)).toContain('UNKNOWN_EXTENSION')
    expect(analysis.serialized).toBeUndefined()
    expect(Buffer.from(enc.encode(analysis.source))).toEqual(raw)
  })

  it('detects deliberate front matter loss and mutation', () => {
    const original = bytes('F08a')
    const text = new TextDecoder().decode(original)
    expect(compareMarkdown(original, enc.encode('# 正文\n\n这是可以编辑的正文。\n')).map((x) => x.code)).toContain('FRONT_MATTER_CHANGE')
    expect(compareMarkdown(original, enc.encode(text.replace('原样保留', '偷偷改写'))).map((x) => x.code)).toContain('FRONT_MATTER_CHANGE')
  })

  it('detects deliberate link target and code content damage', () => {
    for (const [id, from, to] of [
      ['F04', 'https://example.org/path?q=1', 'https://example.org/wrong'],
      ['F03', 'console.log(value);', 'console.log("wrong");'],
    ]) {
      const original = bytes(id)
      const text = new TextDecoder().decode(original)
      expect(compareMarkdown(original, enc.encode(text.replace(from, to))).map((x) => x.code), id).toContain('SEMANTIC_CHANGE')
    }
  })

  it('keeps image formats, corrupt input, and same-name resources distinguishable', () => {
    expect(Buffer.from(bytes('F06')).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(Buffer.from(bytes('F06-jpeg')).subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(Buffer.from(bytes('F06-webp')).subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes('F06-broken').length).toBeLessThan(bytes('F06').length)
    expect(createHash('sha256').update(bytes('F06-same-red')).digest('hex'))
      .not.toBe(createHash('sha256').update(bytes('F06-same-green')).digest('hex'))
    expect(readFileSync(root + 'markdown/assets/中文 图片#%(a).png')).toEqual(Buffer.from(bytes('F04-asset')))
  })
})
