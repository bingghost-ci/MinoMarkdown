import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { syntaxRoles } from '../src/core/markdown/syntaxRoleNames'
import { CODE_CONTRAST, COMMENT_CONTRAST, codeColorIds, codeColorLabels, codePalette, isCodeColors, syntaxVariables } from '../src/features/reading/codeColors'
import { contrast } from '../src/features/reading/color'
import { exportStylesheet, styleVariables, typographyVariables } from '../src/features/reading/css'
import { readingStyle, readingStyles } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'
import { translate } from '../src/app/i18n'

describe('code color schemes (T110)', () => {
  it('offers the same schemes as settings.rs, with auto as the default', () => {
    expect(codeColorIds).toEqual(['auto', 'quiet', 'github', 'one', 'solarized', 'gruvbox', 'tokyo'])
    expect(defaultReadingSettings.codeColors).toBe('auto')
    const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')
    expect(rust).toContain(`matches!(settings.code_colors.as_str(), ${codeColorIds.map((id) => `"${id}"`).join(' | ')})`)
    expect(isCodeColors('one')).toBe(true)
    expect(isCodeColors('neon')).toBe(false)
  })

  it('gives every role a readable color on every reading style', () => {
    for (const style of readingStyles) for (const id of codeColorIds) {
      const palette = codePalette(id, style)
      expect(Object.keys(palette).sort()).toEqual([...syntaxRoles].sort())
      for (const role of syntaxRoles) {
        expect(palette[role], `${id} ${role}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(contrast(palette[role], style.codeBg), `${style.id} ${id} ${role}`).toBeGreaterThanOrEqual((role === 'comment' ? COMMENT_CONTRAST : CODE_CONTRAST) - 0.01)
      }
    }
  })

  it('keeps a scheme color that is already readable, and its hue when it is not', () => {
    expect(codePalette('one', readingStyle('white')).keyword).toBe('#a626a4')
    expect(codePalette('tokyo', readingStyle('charcoal')).keyword).toBe('#bb9af7')
    // One's type yellow is too light for paper: it is darkened, not replaced.
    const fitted = codePalette('one', readingStyle('kraft')).type
    expect(fitted).not.toBe('#c18401')
    expect(contrast(fitted, readingStyle('kraft').codeBg)).toBeGreaterThanOrEqual(CODE_CONTRAST - 0.01)
  })

  it('uses the day half on light styles and the night half on dark ones', () => {
    expect(codePalette('github', readingStyle('white')).keyword).toBe('#cf222e')
    expect(codePalette('github', readingStyle('charcoal')).keyword).toBe('#ff7b72')
  })

  it('draws the quiet scheme from the style alone', () => {
    const style = readingStyle('paper')
    const palette = codePalette('quiet', style)
    expect(palette.variable).toBe(style.text)
    expect(palette.keyword).toBe(style.heading)
  })

  it('falls back to the style\'s own set for an unknown scheme', () => {
    const style = readingStyle('paper')
    expect(codePalette('neon', style)).toEqual(codePalette('auto', style))
    expect(codePalette(undefined, style)).toEqual(codePalette('auto', style))
    expect(styleVariables(style)['--syntax-keyword']).toBe(codePalette('auto', style).keyword)
  })

  it('reaches the page and exports through the typography variables', () => {
    const style = readingStyle('white')
    const typography = documentTypography({ ...defaultReadingSettings, codeColors: 'one' }, style)
    expect(typographyVariables(typography, style)['--syntax-keyword']).toBe('#a626a4')
    expect(syntaxVariables('one', style)['--syntax-definition']).toBe(codePalette('one', style).definition)
    const css = exportStylesheet({ styleId: 'white', exportStyle: 'current', pdfMode: 'screen', pageSize: 'a4', pageMargin: 'standard', typography, fontFaces: '' })
    expect(css).toContain('--syntax-keyword:#a626a4')
  })

  it('has English names and notes', () => {
    for (const id of codeColorIds) {
      if (!/[\u4e00-\u9fff]/.test(codeColorLabels[id].name)) continue
      expect(translate(codeColorLabels[id].name, 'en-US')).not.toBe(codeColorLabels[id].name)
    }
    for (const id of codeColorIds) expect(translate(codeColorLabels[id].note, 'en-US')).not.toBe(codeColorLabels[id].note)
  })
})
