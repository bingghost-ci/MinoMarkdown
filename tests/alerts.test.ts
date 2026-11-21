import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { alertMarker } from '../src/core/markdown/alerts'
import { safeTextHandler } from '../src/features/editor/markdownStringify'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'
import { bootMilkdown } from './helpers/milkdownPipeline'

describe('alert blocks (T121)', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('recognizes the five GitHub markers at the start of a line only', () => {
    expect(alertMarker('[!NOTE]\n内容')).toEqual({ type: 'note', length: 7 })
    expect(alertMarker('[!warning]')).toEqual({ type: 'warning', length: 10 })
    for (const text of ['[!NOTES]', 'x [!NOTE]', '[!NOTE] 标题', '[NOTE]']) expect(alertMarker(text)).toBeNull()
  })

  it('renders an alert as a titled card and leaves other quotes alone', () => {
    const html = renderMarkdownPreview('> [!TIP]\n> 先保存再导出。\n>\n> 第二段\n\n> 普通引用\n')
    expect(html).toContain('<div class="mino-alert mino-alert-tip"><p class="mino-alert-title"></p>')
    expect(html).toContain('<p>先保存再导出。</p>')
    expect(html).not.toContain('[!TIP]')
    expect(html).toContain('<blockquote>\n<p>普通引用</p>')
  })

  it('drops the marker paragraph when the marker stands alone', () => {
    const html = renderMarkdownPreview('> [!CAUTION]\n>\n> 不可撤销。\n')
    expect(html).toMatch(/<div class="mino-alert mino-alert-caution"><p class="mino-alert-title"><\/p>\s*<p>不可撤销。<\/p>/)
  })

  it('never lets markup through the title', () => {
    const html = renderMarkdownPreview('> [!NOTE]\n> <img src=x onerror=alert(1)> <script>x</script>\n')
    expect(html).not.toMatch(/onerror|<script/)
  })

  it('keeps the marker unescaped when the editor writes the document back', async () => {
    const { roundTrip } = await bootMilkdown({ configure: (ctx) => ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, handlers: { ...options.handlers, text: safeTextHandler } })) })
    for (const source of ['> [!NOTE]\n> 提示内容。\n', '> [!TIP]\n>\n> 段落\n', '> [!WARNING]\n> 第一行\n> 第二行\n']) expect(roundTrip(source)).toBe(source)
    // Anywhere else the bracket is still escaped, as before.
    expect(roundTrip('\\[!NOTE] 不在引用里\n')).toBe('\\[!NOTE] 不在引用里\n')
    expect(roundTrip('> 引用\n>\n> \\[!NOTE] 第二段\n')).toBe('> 引用\n>\n> \\[!NOTE] 第二段\n')
  })
})

describe('alert blocks in the editor and on the page (T121)', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('finds alert quotes and their markers without changing the document', async () => {
    const { findAlerts } = await import('../src/features/editor/alerts')
    const { parse } = await bootMilkdown()
    const doc = parse('正文\n\n> [!WARNING]\n> 小心\n\n> 普通引用\n\n> [!NOTE]\n>\n> 说明\n')
    const found = findAlerts(doc)
    expect(found.map((alert) => alert.type)).toEqual(['warning', 'note'])
    // A quote that opens with a line of bold alone is a titled excerpt (T131); bold followed by text is not.
    const titled = findAlerts(parse('> **出处**\n>\n> 引文\n\n> **不是** 标题\n>\n> 引文\n\n> **只有一段**\n'))
    expect(titled.map((item) => item.type)).toEqual(['title'])
    expect(parse('> **出处**\n>\n> 引文\n').nodeAt(titled[0].quote)?.type.name).toBe('paragraph')
    for (const alert of found) {
      expect(doc.nodeAt(alert.quote)?.type.name).toBe('blockquote')
      expect(doc.textBetween(alert.marker, alert.markerEnd)).toMatch(/^\[!(WARNING|NOTE)\]$/)
    }
  })

  it('fits every alert ink to the paper and draws the cards in exports too', async () => {
    const { contrast } = await import('../src/features/reading/color')
    const { alertVariables } = await import('../src/features/reading/alertCss')
    const { readingStyles } = await import('../src/features/reading/styles')
    const { exportStylesheet } = await import('../src/features/reading/css')
    for (const style of readingStyles) for (const [name, ink] of Object.entries(alertVariables(style))) {
      if (name === '--alert-wash') continue
      expect(contrast(ink, style.paper), `${style.id} ${name}`).toBeGreaterThanOrEqual(4.5)
    }
    const { defaultReadingSettings, documentTypography } = await import('../src/app/readingSettings')
    const css = exportStylesheet({ styleId: 'paper', exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard', fontFaces: '', typography: documentTypography(defaultReadingSettings, readingStyles[0]) })
    expect(css).toContain('.mino-doc .mino-alert-warning{--alert:var(--alert-warning)')
    expect(css).toContain('content:"注意"')
    expect(css).toContain('content:"Warning"')
  })
})

describe('quote styles and titled quotes (T131)', () => {
  it('marks the opening bold line of a quote as its title in the preview', () => {
    expect(renderMarkdownPreview('> **出处**\n>\n> 引文\n')).toContain('<p class="mino-quote-title"><strong>出处</strong></p>')
    expect(renderMarkdownPreview('> **不是** 标题\n>\n> 引文\n')).not.toContain('mino-quote-title')
    expect(renderMarkdownPreview('> **只有一段**\n')).not.toContain('mino-quote-title')
  })

  it('offers the same quote styles as settings.rs and scopes each by the attribute on <html>', async () => {
    const { readFileSync } = await import('node:fs')
    const { quoteStyleIds, quoteRules, quoteStyles } = await import('../src/features/reading/layouts')
    const { appStylesheet, exportStylesheet } = await import('../src/features/reading/css')
    const { defaultReadingSettings, documentTypography } = await import('../src/app/readingSettings')
    const { readingStyle } = await import('../src/features/reading/styles')
    const ids = /const QUOTE_STYLE_IDS: &\[&str\] = &\[([^\]]*)\]/.exec(readFileSync('src-tauri/src/settings.rs', 'utf8'))?.[1]
    expect(Array.from(ids!.matchAll(/"([^"]+)"/g), (match) => match[1])).toEqual([...quoteStyleIds])
    expect(quoteStyles.map(([id]) => id)).toEqual([...quoteStyleIds])
    expect(defaultReadingSettings.quoteStyle).toBe('auto')
    expect(quoteRules('auto', '.mino-doc')).toBe('')
    const app = appStylesheet()
    for (const id of ['bar', 'card', 'indent']) expect(app).toContain(`:root[data-quote="${id}"] .mino-doc blockquote:not(.mino-alert){`)
    // The reader's choice comes after the layout's rules, in the app and in an export.
    expect(app.indexOf(':root[data-quote="card"]')).toBeGreaterThan(app.lastIndexOf(':root[data-layout="typewriter"] .mino-doc'))
    const style = readingStyle('paper')
    const css = exportStylesheet({ styleId: 'paper', exportStyle: 'current', pdfMode: 'print', pageSize: 'a4', pageMargin: 'standard', fontFaces: '', typography: documentTypography({ ...defaultReadingSettings, quoteStyle: 'card', layout: 'academic' }, style) })
    expect(css).toContain('.mino-doc blockquote:not(.mino-alert){position:static;margin:1.1em 0;padding:.65em 1.1em')
    expect(css).not.toContain('data-quote')
  })
})

