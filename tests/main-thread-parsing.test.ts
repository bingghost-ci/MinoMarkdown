import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Counts every Markdown parse, whichever module starts it.
const parses = vi.hoisted(() => ({ count: 0 }))
vi.mock('unified', async (importOriginal) => {
  const original = await importOriginal<typeof import('unified')>()
  return {
    ...original,
    unified: () => {
      const processor = original.unified()
      const parse = processor.parse.bind(processor)
      processor.parse = ((...input: Parameters<typeof parse>) => { parses.count++; return parse(...input) }) as typeof processor.parse
      return processor
    },
  }
})

import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { hydrateMarkdownAsync, imageUrlsInAsync, rewriteImageUrlsAsync } from '../src/core/markdown/analysisClient'
import { normalizeAdjacentStrong } from '../src/core/markdown/cjkEmphasis'
import { prepareMarkdown } from '../src/core/markdown/codec'
import { analyzeMarkdown } from '../src/core/markdown/compatibility'
import { hydrateMarkdown } from '../src/features/document/hydrate'
import { assetUrl } from '../src/features/editor/assetUrl'
import { safeTextHandler } from '../src/features/editor/markdownStringify'
import { imageUrlsIn, localAssetPath, replaceImageUrls, rewriteImageUrls } from '../src/features/export/snapshot'

const withImages = '# 标题\n\n![一](assets/a.png) 和 ![二](<assets/b c.png> "题") 以及 ![远程](https://example.com/x.png)\n\n![引用][pic]\n\n[pic]: assets/d.png\n'
const toAsset = (url: string) => { const path = localAssetPath(url); return path === null || /^https?:/.test(url) ? null : assetUrl('key', path) }

beforeEach(() => { parses.count = 0 })

describe('main-thread parsing (T92)', () => {
  it('keeps the synchronous image parsers out of the workspace hook', () => {
    const hook = readFileSync(new URL('../src/app/useDocumentWorkspace.ts', import.meta.url), 'utf8')
    // Saving, drafts and opening go through the worker versions; a direct call here would parse the whole document on the main thread.
    expect(hook).not.toMatch(/(?<![A-Za-z])(?:imageUrlsIn|rewriteImageUrls|replaceImageUrls|hydrateMarkdown)\(/)
    expect(hook).toContain('instance!.persistableMarkdown()')
    // A visual save never asks which images the text holds; a source-mode save asks only when it has recovered images.
    expect(hook).toContain('!visual && document.recoveredAssets.size ? new Set(await imageUrlsInAsync(markdown)) : null')
  })

  it('finds and rewrites images with one parse, giving the same text as the two separate steps', () => {
    const replacements = new Map<string, string>()
    for (const url of imageUrlsIn(withImages)) { const next = toAsset(url); if (next !== null) replacements.set(url, next) }
    const expected = rewriteImageUrls(withImages, replacements)
    parses.count = 0
    const { markdown, replaced } = replaceImageUrls(withImages, toAsset)
    expect(parses.count).toBe(1)
    expect(markdown).toBe(expected)
    expect(markdown).not.toBe(withImages)
    expect(new Map(Array.from(replaced, ([next, old]) => [old, next]))).toEqual(replacements)
    expect(markdown).toContain('https://example.com/x.png')
  })

  it('does not parse a text without images, nor rewrite with nothing to replace', async () => {
    expect(replaceImageUrls('# 没有图片\n\n正文', () => 'x')).toEqual({ markdown: '# 没有图片\n\n正文', replaced: new Map() })
    expect(await imageUrlsInAsync('# 没有图片\n\n正文')).toEqual([])
    expect(await rewriteImageUrlsAsync(withImages, new Map())).toBe(withImages)
    expect(parses.count).toBe(0)
  })

  it('hydrates a document as the open path did before', async () => {
    const hydrated = hydrateMarkdown(withImages, 'key')
    expect(hydrated.failed).toBe(false)
    expect(hydrated.prepared.analysis.mode).toBe('visual')
    // The old open path: list the images, map each local one to its asset URL, rewrite.
    const replacements = new Map<string, string>()
    for (const url of imageUrlsIn(hydrated.prepared.editorMarkdown)) { const path = localAssetPath(url); if (path !== null) replacements.set(url, assetUrl('key', path)) }
    expect(hydrated.markdown).toBe(rewriteImageUrls(hydrated.prepared.editorMarkdown, replacements))
    expect(hydrated.imageUrls).toEqual(new Map(Array.from(replacements, ([old, next]) => [next, old])))
    expect(hydrated.imageUrls.get(assetUrl('key', 'assets/d.png'))).toBe('assets/d.png')
    expect(hydrateMarkdown(withImages, '').markdown).toBe(hydrated.prepared.editorMarkdown)
    expect(await hydrateMarkdownAsync(withImages, 'key')).toEqual(hydrated)
    // A reference shared by a link and an image cannot be rewritten safely: the document stays source-only.
    const shared = hydrateMarkdown('![图][r] 与 [链接][r]\n\n[r]: assets/a.png\n', 'key')
    expect(shared).toMatchObject({ failed: true, markdown: shared.prepared.editorMarkdown })
    expect(shared.imageUrls.size).toBe(0)
  })

  it('keeps no copy of the document in a prepared analysis', () => {
    const { analysis } = prepareMarkdown(withImages)
    for (const field of ['source', 'body', 'serialized', 'semantics']) expect(analysis).not.toHaveProperty(field)
    expect(analysis.mode).toBe('visual')
  })

  it('parses each block holding dollar signs once, however often the document is serialized', () => {
    const source = Array.from({ length: 50 }, (_, index) => `第 ${index} 项 $${index} 一斤，折后 $${index}.5 元`).join('\n\n')
    const parser = unified().use(remarkParse).use(remarkGfm)
    const writer = unified().use(remarkStringify, { handlers: { text: safeTextHandler } })
    const serialize = () => { const tree = parser.parse(source); parses.count = 0; const output = writer.stringify(tree); return { output, parsed: parses.count } }
    const first = serialize()
    const second = serialize()
    expect(first.parsed).toBeGreaterThan(0)
    expect(second.parsed).toBe(0)
    expect(second.output).toBe(first.output)
    expect(first.output).toContain('第 3 项 $3 一斤，折后 $3.5 元')
    // A lone dollar sign cannot open a formula and needs no parse at all.
    const lone = parser.parse('只花了 $5，很便宜')
    parses.count = 0
    expect(writer.stringify(lone)).toBe('只花了 $5，很便宜\n')
    expect(parses.count).toBe(0)
  })

  it('skips the emphasis parse when the pattern is absent and still fixes it when present', () => {
    expect(normalizeAdjacentStrong('# 标题\n\n**普通加粗** 文字\n')).toBe('# 标题\n\n**普通加粗** 文字\n')
    expect(normalizeAdjacentStrong('没有任何强调')).toBe('没有任何强调')
    expect(parses.count).toBe(0)
    expect(normalizeAdjacentStrong('**螺旋（spiral）**指变化，`**代码）**字`')).toBe('**螺旋（spiral）** 指变化，`**代码）**字`')
    expect(parses.count).toBe(1)
  })

  it('numbers issue lines as counting line breaks up to each offset does', () => {
    const source = '---\ntitle: a\n---\n第一段\n\n$$x$$\n\n第二段\n第三行\n\n$$y$$ 与 $$z$$\n\n:::note\n内容\n'
    const analysis = analyzeMarkdown(new TextEncoder().encode(source))
    expect(analysis.issues.length).toBeGreaterThanOrEqual(3)
    for (const issue of analysis.issues) {
      if (issue.offset === undefined) continue
      expect(issue.line).toBe(analysis.body.slice(0, issue.offset).split('\n').length + 3)
    }
  })
})
