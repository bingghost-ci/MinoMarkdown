import { describe, expect, it } from 'vitest'
import { diagramConfig, diagramCurveLabels, diagramCurves, diagramKey, diagramLineLabels, diagramLines, diagramLookLabels, diagramLooks, diagramVariables, parseDiagramKey } from '../src/features/diagrams/looks'
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
    expect([defaultReadingSettings.diagramStyle, defaultReadingSettings.diagramLine, defaultReadingSettings.diagramCurve]).toEqual(['page', 'auto', 'auto'])
    expect(diagramKey('kraft', { look: 'neon', line: 'wavy' })).toBe('kraft:page:auto:auto')
    expect(parseDiagramKey('dusk')).toEqual({ styleId: 'dusk', look: 'page', line: 'auto', curve: 'auto' })
    expect(parseDiagramKey(diagramKey('dusk', { look: 'scifi', line: 'dotted', curve: 'angular' }))).toEqual({ styleId: 'dusk', look: 'scifi', line: 'dotted', curve: 'angular' })
  })

  it('draws each look differently: font, routing, edge pattern and strokes', () => {
    const config = (look: (typeof diagramLooks)[number], line = 'auto' as const, curve = 'auto' as const) => diagramConfig('paper', { look, line, curve })
    expect(config('program').fontFamily).toContain('JetBrains Mono')
    expect(config('hand').fontFamily).toContain('WenKai')
    expect(config('program').curve).toBe('stepAfter')
    // Angular edges run into the node along the layout, so their arrowheads point the right way.
    expect(diagramConfig('paper', { look: 'program', line: 'auto', curve: 'auto' }, 'flowchart LR\n A-->B').curve).toBe('stepBefore')
    expect(diagramConfig('paper', { look: 'page', line: 'auto', curve: 'angular' }, 'stateDiagram-v2\n  direction LR\n A-->B').curve).toBe('stepBefore')
    expect(diagramConfig('paper', { look: 'page', line: 'auto', curve: 'angular' }, 'classDiagram\n A<|--B').curve).toBe('linear')
    expect(diagramConfig('paper', { look: 'page', line: 'auto', curve: 'angular' }, 'graph TD\n A-->B').curve).toBe('stepAfter')
    expect(config('scifi').curve).toBe('linear')
    expect(config('page').curve).toBe('basis')
    expect(config('scifi').themeCSS).toContain('drop-shadow')
    expect(config('scifi').themeCSS).toContain('stroke-dasharray:7 4')
    expect(config('program').themeCSS).toContain('rx:0')
    expect(diagramConfig('paper', { look: 'page', line: 'dotted', curve: 'straight' })).toMatchObject({ curve: 'linear', themeCSS: expect.stringContaining('stroke-dasharray:0.5 4.5') })
    expect(diagramConfig('paper', { look: 'scifi', line: 'solid', curve: 'auto' }).themeCSS).toContain('stroke-dasharray:none')
    // Edges a diagram draws dashed itself are left out of the pattern.
    expect(config('page').themeCSS).toContain('.relation:not(.dashed-line):not(.dotted-line)')
    // Only colors made from the style reach the CSS: nothing that could load a file.
    for (const look of diagramLooks) expect(config(look).themeCSS).not.toMatch(/url\(|@import/)
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

  it('draws by hand with a fixed seed, so a redraw gives the same strokes', () => {
    expect(diagramConfig('paper', { look: 'hand', line: 'auto', curve: 'auto' })).toMatchObject({ look: 'handDrawn', handDrawnSeed: 7 })
    expect(diagramConfig('paper', { look: 'ink', line: 'auto', curve: 'auto' }).look).toBe('classic')
  })

  it('has English names for the settings dialog', () => {
    for (const look of diagramLooks) {
      expect(translate(diagramLookLabels[look].name, 'en-US')).not.toBe(diagramLookLabels[look].name)
      expect(translate(diagramLookLabels[look].note, 'en-US')).not.toBe(diagramLookLabels[look].note)
    }
    for (const label of [...diagramLines.map((line) => diagramLineLabels[line]), ...diagramCurves.map((curve) => diagramCurveLabels[curve])]) expect(translate(label, 'en-US')).not.toBe(label)
  })
})
