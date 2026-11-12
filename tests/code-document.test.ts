import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadFileParser } from '../src/core/markdown/highlight'
import { CODE_HIGHLIGHT_LIMIT, renderCodeHtml, renderDelimitedHtml, renderTableHtml } from '../src/features/text/codeDocument'
import { parseDelimited, TABLE_COLUMN_LIMIT } from '../src/features/text/delimited'

const fixture = (name: string) => readFileSync(`tests/fixtures/formats/${name}`, 'utf8')
const tags = (html: string) => [...new Set(Array.from(html.matchAll(/<\/?([a-z0-9]+)/g), (match) => match[1]))].sort()
/** The text a reader would copy: tags removed, entities decoded. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

describe('T85 source files as a reading page', () => {
  it('puts every line in its own element and keeps the text exactly', () => {
    const source = 'first\n\n  third <b>&</b>\nlast'
    const html = renderCodeHtml(source)
    expect(html).toBe('<div class="mino-code" style="--line-digits:1"><pre><code><span class="l">first\n</span><span class="l">\n</span><span class="l">  third &lt;b&gt;&amp;&lt;/b&gt;\n</span><span class="l">last\n</span></code></pre></div>')
    expect(textOf(html)).toBe(`${source}\n`)
  })

  it('does not add a line for a final line break', () => {
    expect(renderCodeHtml('a\nb\n').match(/class="l"/g)).toHaveLength(2)
    expect(renderCodeHtml('a\r\nb\r\n').match(/class="l"/g)).toHaveLength(2)
    expect(renderCodeHtml('a\n\n').match(/class="l"/g)).toHaveLength(2)
    expect(renderCodeHtml('').match(/class="l"/g)).toHaveLength(1)
    expect(renderCodeHtml('x\n'.repeat(1234))).toContain('--line-digits:4')
    expect(renderCodeHtml('﻿a\n')).toContain('<span class="l">a\n</span>')
  })

  it('colors a JSON file with the classes of the shared highlighter', async () => {
    const parser = await loadFileParser('config.json')
    expect(parser).not.toBeNull()
    const source = fixture('config.json')
    const html = renderCodeHtml(source, parser)
    expect(html).toMatch(/<span class="tok-[a-z-]+">/)
    expect(tags(html)).toEqual(['code', 'div', 'pre', 'span'])
    expect(textOf(html)).toBe(source)
    expect(html).toContain('&lt;tags&gt;')
    for (const classes of html.matchAll(/class="([^"]*)"/g)) expect(classes[1]).toMatch(/^(?:l|mino-code|tok-[a-z-]+(?: tok-[a-z-]+)*)$/)
  })

  it('closes and reopens a token that runs over several lines', async () => {
    const parser = await loadFileParser('notes.js')
    const source = 'const a = 1\n/* a comment\n   over three\n   lines */\nconst b = `x\ny`\n'
    const html = renderCodeHtml(source, parser)
    expect(textOf(html)).toBe(source)
    const lines = html.match(/<span class="l">.*?\n<\/span>/gs)!
    expect(lines).toHaveLength(6)
    // Every line is a complete element: its spans open and close inside it.
    for (const line of lines) expect(line.match(/<span/g)!.length).toBe(line.match(/<\/span>/g)!.length)
    expect(lines[2]).toMatch(/<span class="tok-[a-z-]+">   over three<\/span>/)
  })

  it('shows an HTML file as source and never as markup', async () => {
    const source = fixture('page.html')
    const html = renderCodeHtml(source, await loadFileParser('page.html'))
    expect(tags(html)).toEqual(['code', 'div', 'pre', 'span'])
    expect(html).not.toMatch(/<(script|img|body|h1|html|head|title)\b/i)
    expect(html).not.toMatch(/\son[a-z]+=/i)
    expect(textOf(html)).toBe(source)
  })

  it('leaves files without a language, and very large ones, uncolored', async () => {
    expect(await loadFileParser('server.log')).toBeNull()
    expect(await loadFileParser('data.csv')).toBeNull()
    const log = fixture('server.log')
    expect(textOf(renderCodeHtml(log, null))).toBe(log)
    const parser = await loadFileParser('big.json')
    const big = `[${'1,'.repeat(CODE_HIGHLIGHT_LIMIT / 2)}1]`
    expect(renderCodeHtml(big, parser)).not.toContain('tok-')
  })

  it('picks the language from the file name', async () => {
    for (const name of ['a.yaml', 'a.yml', 'a.toml', 'a.xml', 'a.py', 'a.rs', 'a.ts', 'a.sh', 'a.css', 'a.sql', 'a.go', 'a.java', 'a.c', 'a.php', 'a.rb', 'a.lua', 'a.swift', 'a.kt']) expect(await loadFileParser(name), name).not.toBeNull()
  })
})

describe('T85 CSV and TSV tables', () => {
  it('reads quoted fields with commas, line breaks and doubled quotes', () => {
    const table = parseDelimited(fixture('table.csv'), ',')
    expect(table.rows).toEqual([
      ['书名', '作者', '备注, 含逗号', '页数'],
      ['海边的灯塔', '林某', '第一行\r\n第二行', '320'],
      ['He said "hi"', 'Smith', '<b>not html</b>', '12'],
      ['空行之后', '', '', ''],
    ])
    expect(table.total).toBe(4)
    expect(table.columns).toBe(4)
  })

  it('reads tabs, a missing final line break, a byte-order mark and ragged rows', () => {
    expect(parseDelimited(fixture('table.tsv'), '\t').rows).toEqual([['name', 'value', 'note'], ['alpha', '1', 'first'], ['beta', '2', '含"引号"的文字']])
    expect(parseDelimited('a,b\n1,2', ',').rows).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('﻿a,b\n', ',').rows).toEqual([['a', 'b']])
    expect(parseDelimited('a,b,c\n1\n\n1,2,3,4\n', ',')).toEqual({ rows: [['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']], total: 3, columns: 4 })
    expect(parseDelimited('', ',')).toEqual({ rows: [], total: 0, columns: 0 })
    expect(parseDelimited('"unclosed\nquote', ',').rows).toEqual([['unclosed\nquote']])
    expect(parseDelimited('"",x\n', ',').rows).toEqual([['', 'x']])
    // A line that holds nothing, quoted or not, is a blank line.
    expect(parseDelimited('a\n""\n\nb\n', ',').rows).toEqual([['a'], ['b']])
  })

  it('keeps only the first rows of a long table but counts them all', () => {
    const table = parseDelimited('n\n' + Array.from({ length: 30 }, (_, index) => String(index)).join('\n'), ',', 10)
    expect(table.rows).toHaveLength(10)
    expect(table.total).toBe(31)
    expect(parseDelimited(Array.from({ length: TABLE_COLUMN_LIMIT + 50 }, () => 'x').join(','), ',').columns).toBe(TABLE_COLUMN_LIMIT)
    const html = renderTableHtml(table)
    expect(html).toContain('data-shown="10" data-total="31"')
    expect(html.match(/<tr>/g)).toHaveLength(10)
  })

  it('renders cells as text with the first row as the header', () => {
    const html = renderDelimitedHtml(fixture('table.csv'), ',')
    expect(tags(html)).toEqual(['div', 'table', 'tbody', 'td', 'th', 'thead', 'tr'])
    expect(html).toContain('<thead><tr><th>书名</th><th>作者</th><th>备注, 含逗号</th><th>页数</th></tr></thead>')
    expect(html).toContain('<td>&lt;b&gt;not html&lt;/b&gt;</td>')
    expect(html).toContain('<td>He said &quot;hi&quot;</td>')
    expect(html).not.toContain('mino-table-note')
    expect(renderDelimitedHtml('', ',')).toContain('mino-table-note')
    // A short row is padded so the table stays rectangular.
    expect(renderDelimitedHtml('a,b,c\n1\n', ',')).toContain('<tr><td>1</td><td></td><td></td></tr>')
  })
})
