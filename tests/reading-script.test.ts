import { describe, expect, it } from 'vitest'
import { dominantScript } from '../src/features/reading/script'
import { documentTypography, defaultReadingSettings } from '../src/app/readingSettings'
import { readingStyle } from '../src/features/reading/styles'

const chinese = '读书是一件安静的事。翻开一本排得好的书，纸色、字距、行宽都恰到好处，注意力自然落在文字上。段落之间留出呼吸的空间，行宽保持在三十到四十个汉字之间，眼睛换行时不容易串行。'
const english = 'Reading is a quiet thing. Open a well set book and the paper, the spacing and the measure are all just right, so attention settles on the words. Leave room to breathe between paragraphs and keep the line to sixty or eighty letters.'
const code = Array.from({ length: 60 }, (_, index) => `const value${index} = compute(input, options) // returns the next result for this item`).join('\n')

describe('dominant script', () => {
  it('reads Chinese prose as CJK and English prose as Latin', () => {
    expect(dominantScript(`# 春日读书记\n\n${chinese}\n`)).toBe('cjk')
    expect(dominantScript(`# Notes on reading\n\n${english}\n`)).toBe('latin')
    expect(dominantScript(`# Notes\n\n${english}\n\n${english}\n\n- one item\n- another item\n`)).toBe('latin')
  })

  it('keeps a Chinese document with English terms as CJK', () => {
    expect(dominantScript(`${chinese}Mino 使用 Tauri、React 和 TypeScript 构建，编辑器基于 Milkdown 与 ProseMirror。\n\n${chinese}English text mixes in naturally, with proper spacing between 中文 and Latin words.`)).toBe('cjk')
    // A Chinese sentence for every English one is still a Chinese document.
    expect(dominantScript(`${english}\n\n${chinese}`)).toBe('cjk')
  })

  it('ignores code blocks, inline code, URLs, link targets, HTML tags and formulas when judging the prose', () => {
    // The code alone would make each of these documents Latin.
    expect(dominantScript(code)).toBe('latin')
    expect(dominantScript(`${chinese}\n\n\`\`\`ts\n${code}\n\`\`\`\n\n${chinese}`)).toBe('cjk')
    expect(dominantScript(`${chinese}\n\n~~~\n${code}\n~~~\n`)).toBe('cjk')
    expect(dominantScript(`${chinese}\n\n${code.split('\n').map((line) => `\`${line}\``).join(' ')}\n`)).toBe('cjk')
    const urls = Array.from({ length: 80 }, (_, index) => `https://example.com/docs/reading/experience/chapter/section/page${index}`).join(' ')
    expect(dominantScript(`${chinese}\n\n${urls}\n`)).toBe('cjk')
    const links = Array.from({ length: 80 }, (_, index) => `[链接](../docs/reading/experience/chapter/section/page${index}.md)`).join('、')
    expect(dominantScript(`${chinese}\n\n${links}\n`)).toBe('cjk')
    const tags = Array.from({ length: 80 }, () => '<span class="note important highlighted" data-kind="reading experience">注</span>').join('')
    expect(dominantScript(`${chinese}\n\n${tags}\n`)).toBe('cjk')
    const math = Array.from({ length: 80 }, () => '$\\alpha + \\beta = \\gamma \\times \\delta$').join(' ')
    expect(dominantScript(`${chinese}\n\n${math}\n\n$$\n\\sum \\alpha \\beta \\gamma \\delta \\epsilon \\zeta \\eta \\theta \\iota \\kappa \\lambda \\omega \\sigma \\tau \\phi \\chi \\psi \\rho \\xi \\nu \\mu\n$$\n`)).toBe('cjk')
    // And an English document stays Latin whatever its code says.
    expect(dominantScript(`${english}\n\n\`\`\`\n// ${chinese}\n// ${chinese}\n\`\`\`\n`)).toBe('latin')
  })

  it('keeps an English document with a few Chinese words as Latin', () => {
    expect(dominantScript(`${english} The Chinese word for reading is 读书, and 书 means book.\n\n${english}`)).toBe('latin')
    expect(dominantScript(`${english} Café, naïve, Dvořák and Ελληνικά or Русский words count as Western text.`)).toBe('latin')
  })

  it('treats empty and short documents as CJK', () => {
    expect(dominantScript('')).toBe('cjk')
    expect(dominantScript('\n\n')).toBe('cjk')
    expect(dominantScript('# Title')).toBe('cjk')
    expect(dominantScript('Hello world, this is a short note.')).toBe('cjk')
    expect(dominantScript('1234 5678 — 90 % … !?')).toBe('cjk')
    const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ')
    expect(dominantScript(words(19))).toBe('cjk')
    expect(dominantScript(words(20))).toBe('latin')
    // Under one CJK character in ten counts as Western: 2 of 22 passes, 3 of 23 does not.
    expect(dominantScript(`${words(20)} 读书`)).toBe('latin')
    expect(dominantScript(`${words(20)} 读书记`)).toBe('cjk')
  })

  it('reads Japanese and Korean as CJK', () => {
    const japanese = '読書は静かな営みです。よく組まれた本を開けば、紙の色も字間も行の長さもちょうどよく、注意は自然に言葉へ向かいます。カタカナとひらがなも数えます。'
    const korean = '독서는 조용한 일입니다. 잘 짜인 책을 펼치면 종이의 색과 자간과 행의 길이가 모두 알맞아서 주의가 자연스럽게 글로 향합니다.'
    expect(dominantScript(japanese)).toBe('cjk')
    expect(dominantScript(korean)).toBe('cjk')
    expect(dominantScript(`${japanese}\n\n${korean}\n\n${chinese}\n\nSome English terms such as Markdown and Unicode appear here.`)).toBe('cjk')
    expect(dominantScript(`${korean} ${english}`)).toBe('cjk')
  })

  it('looks at the first 200 000 characters only', () => {
    const long = `${english}\n\n`.repeat(900)
    expect(long.length).toBeGreaterThan(200_000)
    expect(dominantScript(long + chinese.repeat(3000))).toBe('latin')
  })

  it('feeds the layout: a Western document gets Western typography', () => {
    const style = readingStyle('paper')
    expect(documentTypography(defaultReadingSettings, style, dominantScript(english)).measure).toBe('32')
    expect(documentTypography(defaultReadingSettings, style, dominantScript(chinese)).measure).toBe('36')
    // Hyphenation comes with justified text only.
    expect(documentTypography(defaultReadingSettings, style, dominantScript(english)).hyphens).toBe(false)
    expect(documentTypography({ ...defaultReadingSettings, textAlign: 'justify' }, style, dominantScript(english)).hyphens).toBe(true)
  })
})
