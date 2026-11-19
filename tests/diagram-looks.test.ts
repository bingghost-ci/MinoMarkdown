import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanDiagramColors, customColorsKey, defaultDiagramOptions, diagramColorLabels, diagramColorRoleLabels, diagramColorRoles, diagramColorSchemes, diagramConfig, diagramCurveLabels, diagramCurves, diagramFillLabels, diagramFills, diagramFontIds, diagramFontLabels, diagramKey, diagramLineLabels, diagramLines, diagramLookLabels, diagramLooks, diagramTone, diagramVariables, fitColor, handPalette, isDiagramFont, parseCustomColorsKey, parseDiagramKey, type DiagramOptions } from '../src/features/diagrams/looks'
import { contrast, fromHsl } from '../src/features/reading/color'
import { defaultReadingSettings } from '../src/app/readingSettings'
import { styleIds } from '../src/features/reading/styles'
import { translate } from '../src/app/i18n'

const hex = /^#[0-9a-f]{6}$/

describe('diagram looks (T107)', () => {
  it('converts HSL back to the hex it came from', () => {
    expect(fromHsl(0, 1, 0.5)).toBe('#ff0000')
    expect(fromHsl(240, 1, 0.5)).toBe('#0000ff')
    expect(fromHsl(-240, 1, 0.5)).toBe('#00ff00')
  })

  it('keeps the page look as the default, and reads unknown options as the defaults', () => {
    expect([defaultReadingSettings.diagramStyle, defaultReadingSettings.diagramLine, defaultReadingSettings.diagramCurve, defaultReadingSettings.diagramFill, defaultReadingSettings.diagramColors, defaultReadingSettings.diagramFont]).toEqual(['page', 'auto', 'auto', 'auto', 'auto', 'auto'])
    expect(defaultReadingSettings.diagramCustomColors).toEqual({})
    expect(diagramKey('kraft', { look: 'neon', line: 'wavy', fill: 'glitter', colors: 'rainbow', font: 'comic' })).toBe(diagramKey('kraft'))
    expect(parseDiagramKey('dusk')).toEqual({ styleId: 'dusk', ...defaultDiagramOptions })
    const given = { look: 'scifi', line: 'dotted', curve: 'angular', fill: 'hatch', colors: 'custom', custom: { accent: '#d9532b', text: '#101010' }, font: 'sys:Hannotate SC' } as const
    expect(parseDiagramKey(diagramKey('dusk', given))).toEqual({ styleId: 'dusk', ...given })
    // Only known roles and plain hex colors survive: these reach CSS.
    expect(cleanDiagramColors({ accent: '#ABCDEF', node: 'red', glow: '#ffffff', line: 'url(x)', text: '#12345' })).toEqual({ accent: '#abcdef' })
    expect(parseCustomColorsKey(customColorsKey({ border: '#112233' }))).toEqual({ border: '#112233' })
    for (const font of ['auto', 'kai', 'tech', 'sys:Songti SC']) expect(isDiagramFont(font), font).toBe(true)
    for (const font of ['comic', 'sys:', "sys:a'b", 'sys:x;y', 7]) expect(isDiagramFont(font), String(font)).toBe(false)
  })

  it('draws each look differently: font, routing, edge pattern and what is done after Mermaid', () => {
    const config = (look: (typeof diagramLooks)[number], extra: Partial<DiagramOptions> = {}) => diagramConfig('paper', { look, ...extra })
    expect(config('program').fontFamily).toContain('Mino Inter')
    // The hand-drawn looks write in a hand: a brush-written regular script or a running script.
    expect(config('hand').fontFamily).toMatch(/^'Mino Ma Shan Zheng'/)
    expect(config('chalk').fontFamily).toContain('Ma Shan Zheng')
    expect(config('pencil').fontFamily).toMatch(/^'Mino Caveat', 'Mino Long Cang'/)
    expect(config('scifi').fontFamily).toContain('Oxanium')
    expect(config('ink').fontFamily).toContain('Long Cang')
    expect(config('ink', { font: 'kai' }).fontFamily).toContain('WenKai')
    // The font is the user's to change, whatever the look.
    expect(config('scifi', { font: 'longcang' }).fontFamily).toContain('Long Cang')
    expect(config('page', { font: 'sys:Hannotate SC' }).fontFamily).toBe("'Hannotate SC', 'PingFang SC', sans-serif")
    expect(Object.fromEntries(diagramLooks.map((look) => [look, config(look).pass]))).toEqual({ page: 'none', program: 'cards', hand: 'sketch', pencil: 'sketch', chalk: 'sketch', scifi: 'console', ink: 'sketch', color: 'colors' })
    for (const look of diagramLooks) expect(config(look).look).toBe('classic')
    expect(config('program').curve).toBe('stepAfter')
    // Angular edges run into the node along the layout, so their arrowheads point the right way.
    expect(diagramConfig('paper', { look: 'program' }, 'flowchart LR\n A-->B').curve).toBe('stepBefore')
    expect(diagramConfig('paper', { look: 'page', curve: 'angular' }, 'stateDiagram-v2\n  direction LR\n A-->B').curve).toBe('stepBefore')
    expect(diagramConfig('paper', { look: 'page', curve: 'angular' }, 'classDiagram\n A<|--B').curve).toBe('linear')
    expect(diagramConfig('paper', { look: 'page', curve: 'angular' }, 'graph TD\n A-->B').curve).toBe('stepAfter')
    expect(config('page').curve).toBe('basis')
    expect(config('scifi').themeCSS).toContain('drop-shadow')
    expect(config('program').themeCSS).toContain('stroke-dasharray:5 4')
    expect(config('page', { line: 'dotted', curve: 'straight' })).toMatchObject({ curve: 'linear', themeCSS: expect.stringContaining('stroke-dasharray:0.5 4.5') })
    expect(config('scifi', { line: 'dashed' }).themeCSS).toContain('stroke-dasharray:7 4')
    // Edges a diagram draws dashed itself are left out of the pattern.
    expect(config('page').themeCSS).toContain('.relation:not(.dashed-line):not(.dotted-line)')
    // Only colors made from the style or checked as hex reach the CSS: nothing that could load a file.
    for (const look of diagramLooks) expect(config(look, { colors: 'custom', custom: { text: '#123456', accent: '#d9532b' } }).themeCSS).not.toMatch(/url\(|@import/)
  })

  it('works a tone out of the paper, the look and the scheme (T117)', () => {
    for (const styleId of styleIds) for (const look of diagramLooks) for (const colors of diagramColorSchemes) {
      const tone = diagramTone(styleId, { look, colors, custom: { accent: '#d9532b' } })
      for (const color of [tone.ground, tone.text, tone.accent, tone.second, tone.line, ...tone.pens]) expect(color, `${styleId} ${look} ${colors}`).toMatch(hex)
      expect(contrast(tone.text, tone.ground), `${styleId} ${look} ${colors} text`).toBeGreaterThan(4.5)
      expect(contrast(tone.accent, tone.ground), `${styleId} ${look} ${colors} accent`).toBeGreaterThanOrEqual(3)
    }
    // Cards, the console, chalk and the pen bring their own board; the console's and the blackboard are dark on any paper.
    expect(diagramLooks.filter((look) => diagramTone('white', { look }).panel !== null)).toEqual(['program', 'chalk', 'scifi', 'ink'])
    for (const look of ['scifi', 'chalk'] as const) expect(diagramTone('white', { look }).dark, look).toBe(true)
    expect(diagramTone('white', { look: 'ink' }).grid).toMatch(hex)
    expect(diagramTone('white', { look: 'page' }).grid).toBeNull()
    // A scheme changes the accent, and a color of the user's own wins over the scheme's.
    expect(diagramTone('white', { look: 'program', colors: 'ember' }).accent).toBe('#d9532b')
    expect(diagramTone('white', { look: 'program', colors: 'ocean' }).accent).not.toBe(diagramTone('white', { look: 'program', colors: 'ember' }).accent)
    const own = diagramTone('white', { look: 'page', colors: 'custom', custom: { node: '#ffeeaa', line: '#112233', text: '#101010' } })
    expect([own.node, own.line, own.text]).toEqual(['#ffeeaa', '#112233', '#101010'])
    expect(diagramVariables('white', 'page', { colors: 'custom', custom: { node: '#ffeeaa', border: '#333333' } })).toMatchObject({ primaryColor: '#ffeeaa', primaryBorderColor: '#333333' })
    // Custom colors do nothing unless the scheme is `custom`.
    expect(diagramTone('white', { look: 'page', colors: 'auto', custom: { node: '#ffeeaa' } }).node).not.toBe('#ffeeaa')
    expect(fitColor('#ffff00', '#ffffff', 3)).not.toBe('#ffff00')
    expect(contrast(fitColor('#ffff00', '#ffffff', 3), '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('colors every look from the style, with readable text on its nodes', () => {
    for (const styleId of styleIds) for (const look of diagramLooks) {
      const v = diagramVariables(styleId, look) as Record<string, unknown>
      for (const name of ['primaryColor', 'primaryBorderColor', 'secondaryColor', 'lineColor', 'textColor', 'noteBkgColor', 'pie1', 'pie12']) expect(v[name], `${styleId} ${look} ${name}`).toMatch(hex)
      expect(contrast(v.primaryTextColor as string, v.primaryColor as string), `${styleId} ${look}`).toBeGreaterThan(4.5)
      expect(contrast(v.textColor as string, v.noteBkgColor as string), `${styleId} ${look} note`).toBeGreaterThan(4.5)
    }
    // A diagram changes with the paper: two styles never draw the same nodes.
    expect(diagramVariables('paper').primaryColor).not.toBe(diagramVariables('mint').primaryColor)
  })

  it('gives each hand-drawn look its own hand (T115, T117)', () => {
    const hands = Object.fromEntries((['hand', 'pencil', 'chalk', 'ink'] as const).map((look) => [look, handPalette('paper', { look }).hand]))
    expect(hands.hand).toMatchObject({ fill: 'wash', twice: false, grain: 'none' })
    expect(hands.pencil).toMatchObject({ fill: 'hatch', twice: true, grain: 'pencil' })
    expect(hands.chalk).toMatchObject({ fill: 'none', coloredOutline: true, grain: 'chalk' })
    expect(hands.ink).toMatchObject({ fill: 'none', inner: true, solidArrows: true, twice: false, grain: 'none' })
    // Nothing drawn by hand is ruled: every hand strays, and the pencil runs past its corners.
    for (const hand of Object.values(hands)) expect(hand.wobble).toBeGreaterThanOrEqual(1.5)
    expect(hands.pencil.overshoot).toBeGreaterThan(0)
    // The colorful look gives out eight colors too.
    expect(new Set(diagramTone('white', { look: 'color' }).pens).size).toBe(8)
    // The fill is the user's to change within a look.
    expect(handPalette('paper', { look: 'pencil', fill: 'wash' }).hand.fill).toBe('wash')
    for (const styleId of styleIds) for (const look of ['hand', 'pencil', 'chalk', 'ink'] as const) {
      const palette = handPalette(styleId, { look }), v = diagramVariables(styleId, look) as Record<string, string>
      expect(palette.plain).toBe(v.primaryColor)
      for (const color of [...palette.fills, ...palette.frames, palette.paper]) expect(color, `${styleId} ${look}`).toMatch(hex)
      // Outlines and frames that can be told from what they are drawn on.
      expect(contrast(v.primaryBorderColor, palette.paper), `${styleId} ${look}`).toBeGreaterThan(3)
      for (const frame of palette.frames) expect(contrast(frame, palette.paper), `${styleId} ${look} ${frame}`).toBeGreaterThan(2.4)
    }
    expect(new Set(handPalette('paper', { look: 'hand' }).fills).size).toBe(8)
    // One chosen node color replaces the turn of pens.
    expect(handPalette('paper', { look: 'hand', colors: 'custom', custom: { node: '#ffeeaa' } }).fills).toEqual(['#ffeeaa'])
  })

  it('names the same looks, fills, schemes, color roles and fonts as settings.rs', () => {
    const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')
    const listed = (after: string) => [...rust.slice(rust.indexOf(after) + after.length).split(/[)\]]/)[0].matchAll(/"([a-z-]+)"/g)].map((match) => match[1])
    expect(listed('settings.diagram_style.as_str(),')).toEqual([...diagramLooks])
    expect(listed('settings.diagram_fill.as_str(),')).toEqual([...diagramFills])
    expect(listed('settings.diagram_colors.as_str(),')).toEqual([...diagramColorSchemes])
    expect([...rust.slice(rust.indexOf('const DIAGRAM_COLOR_ROLES')).split(';')[0].matchAll(/"([a-z-]+)"/g)].map((match) => match[1])).toEqual([...diagramColorRoles])
    expect([...rust.slice(rust.indexOf('const DIAGRAM_FONT_IDS')).split(';')[0].matchAll(/"([a-z-]+)"/g)].map((match) => match[1])).toEqual(['auto', ...diagramFontIds])
  })

  it('has English names for the settings dialog', () => {
    for (const look of diagramLooks) {
      expect(translate(diagramLookLabels[look].name, 'en-US')).not.toBe(diagramLookLabels[look].name)
      expect(translate(diagramLookLabels[look].note, 'en-US')).not.toBe(diagramLookLabels[look].note)
    }
    for (const label of [...diagramLines.map((line) => diagramLineLabels[line]), ...diagramCurves.map((curve) => diagramCurveLabels[curve]), ...diagramFills.map((fill) => diagramFillLabels[fill]), ...diagramColorSchemes.map((scheme) => diagramColorLabels[scheme]), ...diagramColorRoles.map((role) => diagramColorRoleLabels[role]), ...Object.values(diagramFontLabels)]) expect(translate(label, 'en-US')).not.toBe(label)
  })
})
