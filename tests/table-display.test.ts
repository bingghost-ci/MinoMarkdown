import { readFileSync } from 'node:fs'
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isNumericCell, numericColumns } from '../src/core/markdown/numericColumns'
import { renderMarkdownPreview } from '../src/features/preview/renderMarkdownPreview'
import { renderExport } from '../src/features/export/renderHtml'
import { EditorAdapter } from '../src/features/editor/EditorAdapter'
import { typographyVariables } from '../src/features/reading/css'
import { readingStyle } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'
import './helpers/jsdomLayout'


const table = '| 书名 | 页数 | 价格 | 备注 |\n| --- | --- | :-: | --- |\n| 浮生六记 | 156 | ¥32.50 | 1 册 |\n| 人间词话 | 1,098 | 18 |  |\n| 陶庵梦忆 |  | -5% | 2 |\n'

describe('table display', () => {
  it('recognizes number cells and number-only columns', () => {
    for (const text of ['156', '1,098', '1，098', '-3.5', '+12%', '¥32.50', '$ 7', '−4', '45‰', ' 2 ']) expect(isNumericCell(text), text).toBe(true)
    for (const text of ['', '1 册', 'v2', '1.2.3', '12-34', '一百', '1,23']) expect(isNumericCell(text), text).toBe(false)
    expect(numericColumns([['a', '1', '', 'x'], ['b', '', '', '2']])).toEqual([false, true, false, false])
  })

  it('right-aligns number columns in preview and export without explicit alignment, as a class only', async () => {
    const html = renderMarkdownPreview(table)
    const cells = (tag: string) => Array.from(html.matchAll(new RegExp(`<${tag}([^>]*)>([^<]*)</${tag}>`, 'g')), (match) => [match[2], match[1]])
    const classOf = Object.fromEntries([...cells('th'), ...cells('td')])
    expect(classOf['页数']).toContain('class="mino-num"')
    expect(classOf['156']).toContain('class="mino-num"')
    expect(classOf['1,098']).toContain('class="mino-num"')
    expect(classOf['¥32.50']).toBe(' align="center"')
    expect(classOf['浮生六记']).toBe('')
    expect(classOf['1 册']).toBe('')
    const { html: page } = await renderExport(table, '表格', async () => null)
    expect(page).toContain('<td class="mino-num">156</td>')
  })

  it('switches between three-line and grid tables through CSS variables only', () => {
    const style = readingStyle('paper')
    const lines = typographyVariables(documentTypography(defaultReadingSettings, style), style)
    const grid = typographyVariables(documentTypography({ ...defaultReadingSettings, tableStyle: 'grid' }, style), style)
    expect(lines['--table-cell']).toBe('0')
    expect(lines['--table-edge']).toBe('1.5px solid var(--table-rule)')
    expect(grid['--table-cell']).toBe('1px solid var(--table-line)')
    expect(defaultReadingSettings.tableStyle).toBe('three-line')
  })

  it('draws the rounded table (T128) as one frame with thin rules inside, and falls back for an unknown style', () => {
    const style = readingStyle('paper')
    const rounded = typographyVariables(documentTypography({ ...defaultReadingSettings, tableStyle: 'rounded' }, style), style)
    expect(rounded).toMatchObject({ '--table-collapse': 'separate', '--table-radius': '8px', '--table-cell-width': '0 1px 1px 0', '--table-end-width': '0', '--table-frame': '1px solid var(--table-line)' })
    const grid = typographyVariables(documentTypography({ ...defaultReadingSettings, tableStyle: 'grid' }, style), style)
    expect(grid).toMatchObject({ '--table-collapse': 'collapse', '--table-radius': '0', '--table-cell-width': '1px', '--table-end-width': '1px' })
    expect(documentTypography({ ...defaultReadingSettings, tableStyle: 'dotted' as never }, style).tableStyle).toBe('three-line')
    expect(readFileSync('src-tauri/src/settings.rs', 'utf8')).toContain('"three-line" | "grid" | "rounded"')
  })

  it('decorates number columns in the editor and leaves the Markdown unchanged', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = new EditorAdapter(root, table, () => undefined)
    await editor.create()
    const before = editor.getMarkdown()
    const marked = Array.from(root.querySelectorAll('.mino-num'), (cell) => cell.textContent?.trim())
    expect(marked).toEqual(['页数', '156', '1,098', ''])
    expect(root.querySelectorAll('td.mino-num, th.mino-num').length).toBe(4)
    expect(editor.getMarkdown()).toBe(before)
    await editor.destroy()
  })
})
