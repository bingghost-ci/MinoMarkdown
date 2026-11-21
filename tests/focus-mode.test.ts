import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import type { DecorationSet } from '@milkdown/kit/prose/view'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { focusPlugin, FOCUS_CLASS } from '../src/features/editor/focus'
import { appStylesheet, exportStylesheet } from '../src/features/reading/css'
import { readingStyle } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'
import { bootMilkdown } from './helpers/milkdownPipeline'

describe('focus mode and the heading under the caret (T135)', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('marks the top-level block the caret is in, and only that one', async () => {
    const { parse } = await bootMilkdown()
    const doc = parse('# 标题\n\n第一段\n\n> 引用里\n>\n> 第二段\n\n最后\n')
    const marked = (pos: number) => {
      const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) })
      const set = focusPlugin.props.decorations!.call(focusPlugin, state) as DecorationSet
      return set.find().map((decoration) => [doc.nodeAt(decoration.from)!.type.name, decoration.to - decoration.from, (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class])
    }
    expect(marked(2)).toEqual([['heading', doc.child(0).nodeSize, FOCUS_CLASS]])
    const quoteStart = doc.child(0).nodeSize + doc.child(1).nodeSize
    // Deep inside a quote, the whole quote is the block in focus.
    expect(marked(quoteStart + 3)).toEqual([['blockquote', doc.child(2).nodeSize, FOCUS_CLASS]])
  })

  it('dims the other blocks only in focus mode and only while editing, and never in an export', () => {
    const css = appStylesheet()
    expect(css).toContain(':root[data-focus="on"] .editor-panel:not([data-reading="true"]) .editor-root .milkdown .ProseMirror > :not(.mino-focus){opacity:.36')
    expect(css).toContain('> h3.mino-focus::after{content:"H3"}')
    expect(css).not.toMatch(/\.mino-doc[^{}]*mino-focus/)
    const exported = exportStylesheet({ styleId: 'white', exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard', fontFaces: '', typography: documentTypography({ ...defaultReadingSettings, focusMode: true }, readingStyle('white')) })
    expect(exported).not.toContain('mino-focus')
    expect(defaultReadingSettings.focusMode).toBe(false)
  })
})
