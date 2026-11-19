import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { syntaxRoles } from '../src/core/markdown/syntaxRoleNames'
import { CODE_CONTRAST, COMMENT_CONTRAST, codeColorIds, codeColorLabels, codePalette, isCodeColors, isHexColor, noCustomCodeColors, syntaxRoleLabels, syntaxVariables, withCustomColor } from '../src/features/reading/codeColors'
import { contrast } from '../src/features/reading/color'
import { exportStylesheet, styleVariables, typographyVariables } from '../src/features/reading/css'
import { readingStyle, readingStyles } from '../src/features/reading/styles'
import { defaultReadingSettings, documentTypography } from '../src/app/readingSettings'
import { translate } from '../src/app/i18n'

describe('code color schemes (T110)', () => {
  it('offers the same schemes as settings.rs, with auto as the default', () => {
    expect(codeColorIds).toEqual(['auto', 'quiet', 'github', 'one', 'solarized', 'gruvbox', 'tokyo', 'custom'])
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

describe('custom code colors (T111)', () => {
  const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')

  it('keeps the same roles as settings.rs and names each one in the settings', () => {
    const roles = rust.match(/const SYNTAX_ROLES: &\[&str\] = &\[([^\]]+)\]/)
    expect(roles, 'SYNTAX_ROLES in settings.rs').toBeTruthy()
    expect(roles![1].split(',').map((item) => item.trim().replace(/"/g, ''))).toEqual([...syntaxRoles])
    expect(syntaxRoleLabels.map(([role]) => role).sort()).toEqual([...syntaxRoles].sort())
    for (const [, label] of syntaxRoleLabels) expect(translate(label, 'en-US'), label).not.toBe(label)
    expect(defaultReadingSettings.codeCustomColors).toEqual({ day: {}, night: {} })
  })

  it('shows a role as in auto until the user picks its color, then exactly as picked', () => {
    for (const style of readingStyles) expect(codePalette('custom', style, noCustomCodeColors)).toEqual(codePalette('auto', style))
    const paper = readingStyle('paper')
    // Too faint for the paper, and still used as picked: the choice is the user's.
    const custom = withCustomColor(noCustomCodeColors, false, 'variable', '#FFEE00')
    expect(custom).toEqual({ day: { variable: '#ffee00' }, night: {} })
    expect(codePalette('custom', paper, custom)).toEqual({ ...codePalette('auto', paper), variable: '#ffee00' })
    expect(noCustomCodeColors).toEqual({ day: {}, night: {} })
  })

  it('keeps day and night colors apart', () => {
    const custom = withCustomColor(withCustomColor(noCustomCodeColors, false, 'string', '#112233'), true, 'string', '#ddeeff')
    expect(codePalette('custom', readingStyle('white'), custom).string).toBe('#112233')
    expect(codePalette('custom', readingStyle('dark'), custom).string).toBe('#ddeeff')
    expect(withCustomColor(custom, true, 'string', null)).toEqual({ day: { string: '#112233' }, night: {} })
  })

  it('applies only while the custom scheme is chosen', () => {
    const custom = withCustomColor(noCustomCodeColors, false, 'keyword', '#123456')
    const style = readingStyle('white')
    expect(codePalette('one', style, custom).keyword).toBe('#a626a4')
    expect(codePalette('auto', style, custom)).toEqual(codePalette('auto', style))
  })

  it('lets nothing but a hex color of a known role through to CSS', () => {
    expect(isHexColor('#a1B2c3')).toBe(true)
    for (const bad of ['red', '#12345', '#1234567', '#12345g', '#123456;color:red', 'url(x)', 3, null]) expect(isHexColor(bad), String(bad)).toBe(false)
    const style = readingStyle('white')
    const dirty = { day: { variable: 'red;background:url(x)', nope: '#123456', string: '#ABCDEF' }, night: {} } as never
    const palette = codePalette('custom', style, dirty)
    expect(palette.variable).toBe(codePalette('auto', style).variable)
    expect(palette.string).toBe('#abcdef')
    expect(Object.keys(palette).sort()).toEqual([...syntaxRoles].sort())
    expect(withCustomColor(noCustomCodeColors, false, 'variable', 'red')).toEqual({ day: {}, night: {} })
  })

  it('reaches the page and exports', () => {
    const style = readingStyle('white')
    const settings = { ...defaultReadingSettings, codeColors: 'custom' as const, codeCustomColors: withCustomColor(noCustomCodeColors, false, 'function', '#0a0b0c') }
    const typography = documentTypography(settings, style)
    expect(typographyVariables(typography, style)['--syntax-function']).toBe('#0a0b0c')
    expect(exportStylesheet({ styleId: 'white', exportStyle: 'current', pdfMode: 'screen', pageSize: 'a4', pageMargin: 'standard', typography, fontFaces: '' })).toContain('--syntax-function:#0a0b0c')
  })
})
