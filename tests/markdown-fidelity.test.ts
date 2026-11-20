import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { composeVisualMarkdown, prepareMarkdown } from '../src/core/markdown/codec'
import { analyzeMarkdown } from '../src/core/markdown/compatibility'
import { STRONG_SPACER } from '../src/core/markdown/cjkEmphasis'
import { frontMatterLength } from '../src/core/markdown/frontMatter'
import { loadMathRenderer } from '../src/core/markdown/renderMath'
import { duplicateBlock, moveBlock } from '../src/features/editor/blockCommands'
import { findInDoc } from '../src/features/editor/find'
import { literalLinkHandler, withLiteralLinks } from '../src/features/editor/literalLinks'
import { safeTextHandler } from '../src/features/editor/markdownStringify'
import { outlineFromSource } from '../src/features/outline/outline'
import { bootMilkdown } from './helpers/milkdownPipeline'

/** The real Milkdown parser and serializer with the app's handlers, as `EditorAdapter` configures them. */
async function milkdownPipeline(): Promise<(markdown: string) => string> {
  return (await bootMilkdown({ configure: (ctx) => {
    ctx.update(linkSchema.key, withLiteralLinks)
    ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, handlers: { ...options.handlers, text: safeTextHandler, link: literalLinkHandler } }))
  } })).roundTrip
}

afterEach(() => { vi.unstubAllGlobals() })

const mode = (source: string) => analyzeMarkdown(new TextEncoder().encode(source)).mode

describe('escaping in the visual editor serializer', () => {
  it.each([
    ['\\# not heading **b**\n', '\\# not heading **b**'],
    ['1\\. foo **b**\n', '1\\. foo **b**'],
    ['\\> not quote **b**\n', '\\> not quote **b**'],
    ['\\<b> **x**\n', '\\<b> **x**'],
    ['\\- item **b**\n', '\\- item **b**'],
  ])('keeps the escape in %j', async (source, expected) => {
    const roundTrip = await milkdownPipeline()
    expect(roundTrip(source)).toContain(expected)
    expect(roundTrip(roundTrip(source))).toBe(roundTrip(source))
  })

  it('still writes trailing spaces before a mark unchanged', async () => {
    const roundTrip = await milkdownPipeline()
    expect(roundTrip('前文 **粗体** 后文\n')).toBe('前文 **粗体** 后文\n')
  })
})

describe('bare addresses', () => {
  it.each([
    'See www.example.com today.\n',
    'See https://example.com/a?b=1 today.\n',
    'Mail me@example.com now.\n',
    'Bracketed <https://example.com> stays.\n',
    'Explicit [www.example.com](http://www.example.com) stays.\n',
    'Other [text](https://example.com) stays.\n',
  ])('are written back as they were in %j', async (source) => {
    expect(mode(source)).toBe('visual')
    const roundTrip = await milkdownPipeline()
    expect(roundTrip(source)).toBe(source)
  })
})

describe('front matter', () => {
  it('keeps a line break after front matter that ended the file', () => {
    const prepared = prepareMarkdown('---\ntitle: x\n---')
    expect(prepared.analysis.mode).toBe('visual')
    expect(composeVisualMarkdown(prepared.analysis, 'Hello\n')).toBe('---\ntitle: x\n---\nHello')
    expect(composeVisualMarkdown(prepared.analysis, '')).toBe('---\ntitle: x\n---')
  })

  it('does not take a paragraph between two rules for front matter', () => {
    const source = '---\nIntro paragraph\n\n---\n\n# Body\n'
    expect(frontMatterLength(source)).toBe(0)
    expect(prepareMarkdown(source).analysis.frontMatter).toBe('')
    expect(prepareMarkdown(source).editorMarkdown).toContain('Intro paragraph')
    expect(frontMatterLength('---\n\ntitle: x\n---\n')).toBe(0)
    expect(frontMatterLength('---\ntitle: x\n---\nbody')).toBe('---\ntitle: x\n---\n'.length)
    expect(frontMatterLength('---\ntitle: x\n')).toBe(-1)
    expect(outlineFromSource('---\nIntro\n\n---\n\n# Body\n').map((item) => item.text)).toEqual(['Body'])
    expect(outlineFromSource('---\ntitle: x\n---\n\n# Body\n')).toEqual([{ level: 1, text: 'Body', target: '---\ntitle: x\n---\n\n'.length }])
  })
})

describe('extension syntax other editors read', () => {
  it.each([
    'See [[Page]] and [[Other|alias]].\n',
    '::youtube[abc]{#x}\n',
    'text :span[t]{.red} more\n',
    'note^[inline]\n',
    'a ==highlight== b\n',
    'H~2~O\n',
  ])('is kept as source: %j', (source) => {
    expect(mode(source)).toBe('source-protected')
  })

  it.each([
    'Compare `a == b == c` in code.\n',
    '```js\nif (a == b) {}\n```\n',
    'x == y and y == z\n',
    'C++ uses std::vector here.\n',
    'Time 10:30, ratio 1:2.\n',
    'Real ~~strike~~ stays.\n',
    'Code `[[x]]` and `^[y]`.\n',
    'An escaped \\[\\[x\\]\\] stays.\n',
  ])('does not protect %j', (source) => {
    expect(mode(source)).toBe('visual')
  })
})

describe('the CJK strong spacer', () => {
  it('is removed on save, while a thin space the user typed stays', () => {
    const prepared = prepareMarkdown('**重点）**之后\n')
    expect(prepared.editorMarkdown).toBe(`**重点）**${STRONG_SPACER}之后\n`)
    expect(composeVisualMarkdown(prepared.analysis, `${prepared.editorMarkdown}用户 空格\n`)).toBe('**重点）**之后\n用户 空格\n')
  })
})

describe('regex lookbehind', () => {
  it('appears nowhere in src: the WebKit of macOS 12 cannot parse it', () => {
    const found: string[] = []
    const visit = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        if (statSync(path).isDirectory()) visit(path)
        else if (/\.(?:ts|tsx|js|mjs)$/.test(name) && /\(\?<[=!]/.test(readFileSync(path, 'utf8'))) found.push(path)
      }
    }
    visit('src')
    expect(found).toEqual([])
  })
})

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    image: { group: 'inline', inline: true, atom: true },
    text: { group: 'inline' },
  },
})

describe('find around inline nodes', () => {
  it('never matches across or over an image', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('ab,cd'), schema.node('image'), schema.text('ef')])])
    const regex = { caseSensitive: false, wholeWord: false, regex: true }
    const texts = (query: string) => findInDoc(doc, query, regex).map(({ from, to }) => doc.textBetween(from, to, '', '[img]'))
    expect(texts('[^,]+')).toEqual(['ab', 'cd', 'ef'])
    expect(texts('.')).toEqual(['a', 'b', ',', 'c', 'd', 'e', 'f'])
    expect(texts('d.e')).toEqual([])
    expect(findInDoc(doc, 'ef')[0]).toEqual({ from: 7, to: 9 })
  })
})

describe('block commands in reading mode', () => {
  it('leave the document alone', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('one')), schema.node('paragraph', null, schema.text('two'))])
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 7) })
    const view = { composing: false, editable: false } as never
    let dispatched = false
    expect(moveBlock(-1)(state, () => { dispatched = true }, view)).toBe(false)
    expect(duplicateBlock(state, () => { dispatched = true }, view)).toBe(false)
    expect(dispatched).toBe(false)
    expect(moveBlock(-1)(state, () => { dispatched = true }, { composing: false, editable: true } as never)).toBe(true)
    expect(dispatched).toBe(true)
  })
})

describe('KaTeX limits', () => {
  it('caps the size a formula may ask for', async () => {
    const draw = await loadMathRenderer('$x$')
    const html = draw!(String.raw`\rule{100000em}{1em}`, false)
    expect(html).toContain('border-right-width:50em')
    expect(html).not.toContain('width:100000em')
  })
})
