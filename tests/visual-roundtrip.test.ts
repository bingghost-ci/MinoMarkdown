import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { protectedFragments } from '../src/core/markdown/compatibility'
import { prepareMarkdown } from '../src/core/markdown/codec'
import { bootMilkdown } from './helpers/milkdownPipeline'

/** Boots the real Milkdown schema, parser and serializer. There is no DOM here, so only the view fails to start. */
async function milkdownPipeline() {
  return (await bootMilkdown()).roundTrip
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
