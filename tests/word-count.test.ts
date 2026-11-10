import { describe, expect, it } from 'vitest'
import { countWords } from '../src/features/document/wordCount'

describe('word count', () => {
  it.each([
    ['', 0],
    ['   \n\t', 0],
    ['中文字数', 4],
    ['hello world', 2],
    ['中文和 English 混排', 5 + 1],
    ['日本語のカナ', 6],
    ['한국어', 3],
    ["don't stop, well-known v1.2", 4],
    ['标点，不算。！？', 4],
    ['2026 年 11 月', 4],
    ['snake_case', 1],
    ['# 标题 **粗**', 3],
  ])('%j has %i', (text, expected) => { expect(countWords(text)).toBe(expected) })

  it('gives the same answer on repeated calls', () => {
    expect([countWords('一 two'), countWords('一 two')]).toEqual([2, 2])
  })
})
