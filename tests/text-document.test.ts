import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chapterLevel, CHUNK_BLOCKS, isHardWrapped, renderTextHtml, textHead, textOutline } from '../src/features/text/textDocument'
import { blockIndex, firstBelow, positionFraction } from '../src/features/text/readingPosition'

const novel = readFileSync('tests/fixtures/formats/novel-utf8.txt', 'utf8')
const wrapped = readFileSync('tests/fixtures/formats/wrapped-english.txt', 'utf8')
const tags = (html: string) => [...new Set(Array.from(html.matchAll(/<\/?([a-z0-9]+)/g), (match) => match[1]))].sort()

describe('T83 plain text as a reading page', () => {
  it('recognizes chapter titles and leaves sentences alone', () => {
    for (const title of ['第一章 出发', '第12章', '　　第三回　风雪夜', '第一百二十章：归来', '第2节 概述', '序章', '楔子', '后记', '尾声', 'Chapter 1', 'CHAPTER XII', 'chapter one: the start', 'Prologue', 'Epilogue']) expect(chapterLevel(title), title).toBe(2)
    for (const title of ['第一卷 海边的灯塔', '第二部', '第3篇 远行', 'Part 2', 'Book III', 'Volume 1']) expect(chapterLevel(title), title).toBe(1)
    for (const line of ['第三章的内容他还没有想好，所以这一句不是章节标题。', '第一章讲的是出发，', '他在第一章出场', '', '   ', 'Chapter and verse were quoted at length in the debate', 'Partly cloudy', '章节', '第章', `第一章 ${'很长'.repeat(30)}`]) expect(chapterLevel(line), line).toBeNull()
  })

  it('shows Markdown and HTML characters as text', () => {
    const html = renderTextHtml(novel)
    expect(html).toContain('写下 *今天* 两个字')
    expect(html).toContain('<p class="in"># 这一行以井号开头，但它只是正文，不是标题。</p>')
    expect(html).toContain('&lt;b&gt;这里的尖括号也只是文字&lt;/b&gt;，1 &lt; 2 &amp;&amp; 3 &gt; 2。')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<em>')
  })

  it('emits only its own tags, whatever the text holds', () => {
    const hostile = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[link](javascript:alert(1))\n"quoted" & \'single\'\n第一章 <svg onload=alert(1)>\n'
    const html = renderTextHtml(hostile)
    expect(tags(html)).toEqual(['div', 'h2', 'p'])
    expect(html).not.toMatch(/<(script|img|svg|a)\b/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&quot;quoted&quot; &amp; &#39;single&#39;')
    expect(tags(renderTextHtml(novel))).toEqual(['div', 'h1', 'h2', 'p'])
    expect(tags(renderTextHtml(wrapped))).toEqual(['br', 'div', 'h2', 'p'])
  })

  it('makes each line of a novel a paragraph and remembers its indent', () => {
    const html = renderTextHtml(novel)
    expect(html.startsWith('<div class="mino-text"><h1>第一卷 海边的灯塔</h1><h2>序章</h2><p class="in">很多年以后')).toBe(true)
    expect(html.match(/<h2>/g)).toHaveLength(4)
    expect(html.match(/<p/g)).toHaveLength(8)
    expect(html).toContain('<p class="in">第三章的内容他还没有想好，所以这一句不是章节标题。</p>')
  })

  it('keeps the lines of hand-wrapped text inside their paragraph', () => {
    expect(isHardWrapped(wrapped.split('\n'))).toBe(true)
    expect(isHardWrapped(novel.split('\n'))).toBe(false)
    const html = renderTextHtml(wrapped)
    expect(html).toContain('<h2>Chapter 1</h2><p>It was a bright cold day in April, and the clocks were<br>striking thirteen. The hallway smelt of boiled cabbage<br>and old rag mats.</p>')
    expect(html.match(/<p>/g)).toHaveLength(3)
  })

  it('reads CRLF, old Mac line ends and a byte-order mark the same way', () => {
    const expected = renderTextHtml(novel)
    expect(renderTextHtml(novel.replace(/\n/g, '\r\n'))).toBe(expected)
    expect(renderTextHtml(novel.replace(/\n/g, '\r'))).toBe(expected)
    expect(renderTextHtml(`﻿${novel}`)).toBe(expected)
    expect(renderTextHtml('')).toBe('<div class="mino-text"></div>')
  })

  it('cuts a long text into sections', () => {
    const long = Array.from({ length: CHUNK_BLOCKS * 2 + 5 }, (_, index) => `第 ${index} 段：这是一段用来凑长度的正文。`).join('\n')
    const html = renderTextHtml(long, true)
    expect(html.startsWith('<div class="mino-text mino-text-long"><section>')).toBe(true)
    expect(html.match(/<section>/g)).toHaveLength(3)
    expect(html.match(/<p>/g)).toHaveLength(CHUNK_BLOCKS * 2 + 5)
    expect(renderTextHtml(long)).not.toContain('<section>')
    expect(renderTextHtml('x\n'.repeat(120_000))).toContain('<section>')
  })

  it('finds a first page at a line break', () => {
    expect(textHead(novel)).toBeNull()
    const long = '一行文字，大约二十个字符左右的长度。\n'.repeat(10_000)
    const head = textHead(long)!
    expect(head.length).toBeLessThanOrEqual(48_000)
    expect(head.length).toBeGreaterThan(40_000)
    expect(long.startsWith(head)).toBe(true)
    expect(long[head.length]).toBe('\n')
    expect(textHead('x'.repeat(200_000))).toBeNull()
  })

  it('lists chapters with their offsets for the source editor', () => {
    const outline = textOutline(novel)
    expect(outline.map((item) => [item.level, item.text])).toEqual([[1, '第一卷 海边的灯塔'], [2, '序章'], [2, '第一章 出发'], [2, '第二章 灯塔'], [2, '尾声']])
    for (const item of outline) expect(novel.slice(item.target).startsWith(item.text)).toBe(true)
    const crlf = novel.replace(/\n/g, '\r\n')
    for (const item of textOutline(crlf)) expect(crlf.slice(item.target).startsWith(item.text)).toBe(true)
    expect(textOutline(`﻿${novel}`)[0].target).toBe(1)
    expect(textOutline('没有章节的文字\n第二行')).toEqual([])
  })
})

describe('T83 reading position', () => {
  it('maps a block index to a fraction and back', () => {
    for (const count of [2, 9, 1000, 40_001]) for (const index of [0, 1, Math.floor(count / 2), count - 1]) expect(blockIndex(positionFraction(index, count), count)).toBe(index)
    expect(positionFraction(0, 1)).toBe(0)
    expect(positionFraction(5, 0)).toBe(0)
    expect(blockIndex(0.5, 0)).toBe(0)
    expect(blockIndex(2, 10)).toBe(9)
    expect(blockIndex(-1, 10)).toBe(0)
  })

  it('finds the first block below the top edge by bisection', () => {
    const bottoms = Array.from({ length: 1000 }, (_, index) => (index + 1) * 30)
    let calls = 0
    const bottomOf = (index: number) => { calls++; return bottoms[index] }
    expect(firstBelow(bottoms.length, bottomOf, 0)).toBe(0)
    expect(firstBelow(bottoms.length, bottomOf, 29)).toBe(0)
    expect(firstBelow(bottoms.length, bottomOf, 30)).toBe(1)
    expect(firstBelow(bottoms.length, bottomOf, 15_015)).toBe(500)
    expect(firstBelow(bottoms.length, bottomOf, 1e9)).toBe(1000)
    expect(calls).toBeLessThan(60)
    expect(firstBelow(0, bottomOf, 10)).toBe(0)
  })
})
