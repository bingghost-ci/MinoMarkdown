import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { Editor, parserCtx, SerializerReady, serializerCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { protectedFragments } from '../src/core/markdown/compatibility'
import { prepareMarkdown } from '../src/core/markdown/codec'

/** Boots the real Milkdown schema, parser and serializer. There is no DOM here, so only the view fails to start. */
async function milkdownPipeline() {
  // Milkdown's startup timers signal through window events; the view is the only part that needs a real DOM.
  const events = new EventTarget()
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  const pipeline = new Promise<(markdown: string) => string>((resolve) => {
    const capture: MilkdownPlugin = (ctx) => async () => {
      await ctx.wait(SerializerReady)
      const parse = ctx.get(parserCtx)
      const serialize = ctx.get(serializerCtx)
      resolve((markdown) => serialize(parse(markdown)))
    }
    void Editor.make().use(commonmark).use(gfm).use(capture).create().catch(() => undefined)
  })
  return pipeline
}

describe('visual editor round trip through the real Milkdown schema', () => {
  const samples = [
    '第一行<br>第二行\n',
    '<!-- 注释 -->\n\n正文\n',
    '<div align="center">\n块级\n</div>\n\n正文\n',
    '<script>alert(1)</script>\n\n正文\n',
    '脚注[^a]。\n\n[^a]: 内容。\n',
    readFileSync('tests/fixtures/markdown/F13-partial.md', 'utf8'),
  ]

  it.each(samples)('keeps protected fragments in %j', async (source) => {
    expect(prepareMarkdown(source).analysis.mode).toBe('visual')
    const roundTrip = await milkdownPipeline()
    expect(protectedFragments(roundTrip(source))).toEqual(protectedFragments(source))
  })

  it('keeps plain dollar amounts as text', async () => {
    const roundTrip = await milkdownPipeline()
    expect(roundTrip('价格 $5 到 $10\n')).toContain('$5 到 $10')
  })
})
