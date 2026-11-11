import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast, parseHex, toHsl } from '../src/features/reading/color'
import { appStylesheet, documentElementCss, styleVariables, typographyVariables, DOC_ROOT, PAGE_BACKGROUND, type Typography } from '../src/features/reading/css'
import { dayStyleIds, isStyleId, legacyStyleIds, migrateStyleId, nightStyleIds, readingStyle, readingStyles, resolveStyleId, styleIds, themeIds, type ReadingStyle } from '../src/features/reading/styles'
import { activeStyle, defaultReadingSettings, documentFontFamily, documentTypography, latinLineHeights, latinMeasures, layoutScript, lineHeights, pickedStyle, toggledDayNight } from '../src/app/readingSettings'

const colorFields = ['paper', 'text', 'secondary', 'link', 'heading', 'title', 'muted', 'codeInk', 'codeBg', 'quoteLine', 'rule', 'tableLine', 'tableRule', 'selection', 'desk', 'edge'] as const
const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')
const typography = (style: ReadingStyle, overrides: Partial<Typography> = {}): Typography => ({ ...documentTypography(defaultReadingSettings, style), ...overrides })

describe('reading styles', () => {
  it('lists the 9 styles in order with every field filled in', () => {
    expect(styleIds).toEqual(['white', 'mist', 'paper', 'xuan', 'parchment', 'kraft', 'mint', 'charcoal', 'dark', 'gray', 'slate', 'dusk'])
    expect(readingStyles.map((style) => style.id)).toEqual([...styleIds])
    expect(themeIds).toEqual(['system', ...styleIds])
    for (const style of readingStyles) {
      expect(style.name.length, style.id).toBeGreaterThan(0)
      for (const field of colorFields) expect(() => parseHex(style[field]), `${style.id}.${field}`).not.toThrow()
      for (const [name, value] of Object.entries(style.ui)) expect(() => parseHex(value), `${style.id}.ui.${name}`).not.toThrow()
      expect(style.title, `${style.id} title is the accent`).toBe(style.link)
      expect(style.ui.accent, `${style.id} accent`).toBe(style.link)
    }
    expect(dayStyleIds).toEqual(['white', 'mist', 'paper', 'xuan', 'parchment', 'kraft', 'mint'])
    expect(nightStyleIds).toEqual(['charcoal', 'dark', 'gray', 'slate', 'dusk'])
  })

  it('maps every style ID of earlier versions to a style that exists', () => {
    expect(Object.keys(legacyStyleIds).sort()).toEqual(['amber', 'black', 'blueprint', 'butter', 'eink', 'graphite', 'ink', 'light', 'newsprint'])
    for (const [old, current] of Object.entries(legacyStyleIds)) {
      expect(isStyleId(old), `${old} is retired`).toBe(false)
      expect(isStyleId(current), `${old} → ${current}`).toBe(true)
      expect(migrateStyleId(old)).toBe(current)
      expect(readingStyle(old).id).toBe(current)
    }
    expect(readingStyle('light').id).toBe('white')
    expect(readingStyle('graphite').id).toBe('dark')
    expect(readingStyle('ink').id).toBe('charcoal')
    expect(readingStyle('butter').id).toBe('paper')
    expect(readingStyle('eink').id).toBe('mist')
    for (const id of styleIds) expect(migrateStyleId(id)).toBe(id)
    expect(migrateStyleId('neon')).toBeNull()
    expect(migrateStyleId('system')).toBeNull()
    expect(readingStyle('neon').id).toBe('white')
    expect(readingStyle('').id).toBe('white')
  })

  // Reported, not fixed here: `legacyStyleIds[id]` also finds the members of Object.prototype, so these
  // IDs come back as a function or an object, and `readingStyle` returns undefined for them. settings.rs
  // refuses such IDs, so the app does not reach this today. Remove `.fails` once the lookup is own-key only.
  it('treats the names of Object.prototype members as unknown style IDs', () => {
    for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(migrateStyleId(id), id).toBeNull()
      expect(readingStyle(id).id, id).toBe('white')
      expect(resolveStyleId(id, 'paper', 'charcoal', true), id).toBe('dark')
    }
  })

  it('keeps the same style IDs and legacy table as settings.rs', () => {
    const ids = /const STYLE_IDS: &\[&str\] = &\[([^\]]*)\]/.exec(rust)?.[1]
    expect(ids, 'STYLE_IDS in settings.rs').toBeTruthy()
    expect(Array.from(ids!.matchAll(/"([^"]+)"/g), (match) => match[1])).toEqual([...styleIds])
    const legacy = /const LEGACY_STYLE_IDS: &\[\(&str, &str\)\] = &\[(.*?)\];/.exec(rust)?.[1]
    expect(legacy, 'LEGACY_STYLE_IDS in settings.rs').toBeTruthy()
    const pairs = Array.from(legacy!.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g), (match) => [match[1], match[2]])
    expect(pairs.length).toBeGreaterThan(0)
    expect(Object.fromEntries(pairs)).toEqual({ ...legacyStyleIds })
    expect(pairs.length).toBe(Object.keys(legacyStyleIds).length)
  })

  it('keeps body text between 7:1 and 15:1 and secondary text, links, titles and code at 4.5:1 or more', () => {
    for (const style of readingStyles) {
      const body = contrast(style.text, style.paper)
      expect(body, `${style.id} body ${body.toFixed(2)}`).toBeGreaterThanOrEqual(7)
      expect(body, `${style.id} body ${body.toFixed(2)}`).toBeLessThanOrEqual(15)
      for (const field of ['secondary', 'link', 'title', 'codeInk'] as const) {
        const ratio = contrast(style[field], style.paper)
        expect(ratio, `${style.id} ${field} on paper ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
      const code = contrast(style.codeInk, style.codeBg)
      expect(code, `${style.id} code ink on code background ${code.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style.heading, style.paper), `${style.id} heading`).toBeGreaterThanOrEqual(contrast(style.text, style.paper) - 0.01)
    }
  })

  // HSL saturation is ill-conditioned next to white (#f7f8fa is 3/255 off gray, yet reads as 0.23), so
  // neutrality is measured as the spread between the color channels as well.
  const channelSpread = (hex: string) => { const rgb = parseHex(hex); return Math.max(...rgb) - Math.min(...rgb) }

  it('keeps the chrome neutral: no tint from the page, and dark chrome for night styles only', () => {
    for (const style of readingStyles) {
      const page = channelSpread(style.paper)
      for (const [name, color] of [...(['sidebar', 'chrome', 'raised', 'line', 'hover'] as const).map((field) => [`ui.${field}`, style.ui[field]] as const), ['desk', style.desk] as const]) {
        const spread = channelSpread(color)
        expect(spread, `${style.id}.${name} ${color} is ${spread}/255 off gray`).toBeLessThanOrEqual(8)
        // Where HSL saturation means something (the dark palettes), it stays under 0.08 too.
        const saturation = toHsl(color)[1]
        if (style.dark) expect(saturation, `${style.id}.${name} ${color} saturation ${saturation.toFixed(3)}`).toBeLessThanOrEqual(0.08)
        // A tinted page (parchment is 66/255 off gray) leaves the chrome as gray as a white page does.
        if (page > 16) expect(spread, `${style.id}.${name}`).toBeLessThan(page / 2)
      }
      expect(style.dark).toBe(style.group === 'night')
      for (const color of [style.ui.chrome, style.ui.sidebar, style.ui.raised, style.desk]) expect(toHsl(color)[2] < 0.5, `${style.id} ${color}`).toBe(style.dark)
      expect(styleVariables(style)['color-scheme']).toBe(style.dark ? 'dark' : 'light')
    }
    // The page color does not reach the window: every day style shares one chrome, whatever its paper.
    for (const field of ['sidebar', 'chrome', 'raised', 'line', 'hover'] as const) expect(new Set(dayStyleIds.map((id) => readingStyle(id).ui[field])).size, field).toBe(1)
    expect(new Set(['white', 'paper', 'xuan', 'parchment', 'kraft', 'mint'].map((id) => readingStyle(id).desk)).size).toBe(1)
  })

  /**
   * Pairs measured below the bound, with the measured ratio. Each is reported, not accepted: the test
   * fails when a listed pair gets worse, and also when it is fixed, so the entry is removed then.
   */
  const knownLowContrast: Record<string, number> = {
  }

  it('keeps chrome text readable on the chrome, sidebar and desk, and the accent visible on the chrome', () => {
    const seen = new Set<string>()
    for (const style of readingStyles) {
      const vars = styleVariables(style)
      for (const [name, surface] of [['chrome', style.ui.chrome], ['sidebar', style.ui.sidebar], ['desk', style.desk]] as const) {
        for (const [variable, bound] of [['--ui-text', 7], ['--ui-secondary', 4.5]] as const) {
          const key = `${style.id} ${variable} on ${name}`
          const ratio = contrast(vars[variable], surface)
          const known = knownLowContrast[key]
          if (known === undefined) { expect(ratio, `${key} ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(bound); continue }
          seen.add(key)
          expect(ratio, `${key} ${ratio.toFixed(2)} is listed as below ${bound}; remove it from knownLowContrast once fixed`).toBeLessThan(bound)
          expect(ratio, `${key} ${ratio.toFixed(2)} got worse`).toBeGreaterThanOrEqual(known - 0.05)
        }
      }
      const accent = contrast(style.ui.accent, style.ui.chrome)
      expect(accent, `${style.id} accent on chrome ${accent.toFixed(2)}`).toBeGreaterThanOrEqual(3)
      const ink = contrast(style.ui.accentInk, style.ui.accent)
      expect(ink, `${style.id} accent ink on accent ${ink.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
    expect([...seen].sort()).toEqual(Object.keys(knownLowContrast).sort())
  })

  it('uses offline paper layers for the paper styles only and no generated SVG noise', () => {
    const textured = readingStyles.filter((style) => style.texture).map((style) => style.id)
    expect(textured).toEqual(['paper', 'xuan', 'parchment', 'kraft'])
    const css = appStylesheet()
    expect(css).not.toMatch(/feTurbulence|svg\+xml/)
    expect(css).not.toMatch(/https?:\/\//)
    for (const style of readingStyles) expect(css).toContain(`:root[data-theme="${style.id}"]`)
    expect(css).toContain(':root[data-theme="white"],:root:not([data-theme])')
    for (const style of readingStyles) {
      const vars = styleVariables(style)
      if (!style.texture) {
        expect(vars['--paper-texture'], style.id).toBe('none')
        expect(vars['--paper-texture-size'], style.id).toBe('auto')
        continue
      }
      expect(style.texture, 'each paper style has its own texture').toBe(style.id)
      const layers = vars['--paper-texture'].split(', ')
      expect(layers.length, style.id).toBeGreaterThanOrEqual(2)
      for (const layer of layers) expect(layer, style.id).toMatch(/^url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\)$/)
      const sizes = vars['--paper-texture-size'].split(', ')
      expect(sizes.length, `${style.id} sizes`).toBe(layers.length)
      for (const size of sizes) expect(size, style.id).toMatch(/^(\d+)px \1px$/)
    }
    // The veil is the first background layer, so the size list starts with its `auto`.
    expect(PAGE_BACKGROUND).toContain('background-image:var(--paper-veil,none),var(--paper-texture)')
    expect(PAGE_BACKGROUND).toContain('background-size:auto,var(--paper-texture-size,auto)')
  })

  it('writes the title, chrome text and code font variables', () => {
    for (const style of readingStyles) {
      const vars = styleVariables(style)
      expect(vars['--title']).toBe(style.title)
      expect(vars['--surface']).toBe(style.paper)
      expect(vars['--accent']).toBe(style.ui.accent)
      expect(() => parseHex(vars['--ui-text'])).not.toThrow()
      expect(() => parseHex(vars['--ui-secondary'])).not.toThrow()
      // Chrome text is neutral as well.
      expect(toHsl(vars['--ui-text'])[1]).toBeLessThanOrEqual(0.12)
    }
    const css = documentElementCss(DOC_ROOT)
    expect(css).toContain('.mino-doc h1,.mino-doc h2{color:var(--title);')
    expect(css).toContain('font:.88em var(--code-font)')
  })

  it('veils the texture with the page color by the texture strength', () => {
    const paper = readingStyle('paper')
    const [r, g, b] = parseHex(paper.paper)
    expect(typographyVariables(typography(paper, { textureStrength: 100 }), paper)['--paper-veil']).toBe('none')
    expect(typographyVariables(typography(paper, { textureStrength: 60 }), paper)['--paper-veil']).toBe(`linear-gradient(rgba(${r},${g},${b},0.40),rgba(${r},${g},${b},0.40))`)
    expect(typographyVariables(typography(paper, { textureStrength: 0 }), paper)['--paper-veil']).toBe(`linear-gradient(rgba(${r},${g},${b},1.00),rgba(${r},${g},${b},1.00))`)
    // Out-of-range values are clamped.
    expect(typographyVariables(typography(paper, { textureStrength: 250 }), paper)['--paper-veil']).toBe('none')
    expect(typographyVariables(typography(paper, { textureStrength: -5 }), paper)['--paper-veil']).toContain(',1.00)')
    for (const style of readingStyles) {
      for (const textureStrength of [0, 60, 100]) {
        const veil = typographyVariables(typography(style, { textureStrength }), style)['--paper-veil']
        if (!style.texture) expect(veil, `${style.id} ${textureStrength}`).toBe('none')
        else if (textureStrength < 100) {
          const alpha = /^linear-gradient\(rgba\((\d+),(\d+),(\d+),([\d.]+)\),rgba\(\1,\2,\3,\4\)\)$/.exec(veil)
          expect(alpha, `${style.id} ${veil}`).not.toBeNull()
          expect([Number(alpha![1]), Number(alpha![2]), Number(alpha![3])]).toEqual(parseHex(style.paper))
          expect(Number(alpha![4])).toBeCloseTo(1 - textureStrength / 100, 5)
        }
      }
    }
    expect(defaultReadingSettings.textureStrength).toBe(60)
  })

  it('ages the page edges for parchment only, scaled by the texture strength', () => {
    const none = '0 0 0 transparent'
    expect(readingStyles.filter((style) => style.aging).map((style) => style.id)).toEqual(['parchment'])
    for (const style of readingStyles) {
      if (style.aging) continue
      expect(typographyVariables(typography(style, { textureStrength: 100 }), style)['--page-aging'], style.id).toBe(none)
    }
    const parchment = readingStyle('parchment')
    const alphas = (strength: number) => Array.from(typographyVariables(typography(parchment, { textureStrength: strength }), parchment)['--page-aging'].matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\)/g), (match) => Number(match[1]))
    expect(typographyVariables(typography(parchment, { textureStrength: 0 }), parchment)['--page-aging']).toBe(none)
    expect(alphas(100)).toEqual([0.5, 0.42])
    expect(alphas(50)).toEqual([0.25, 0.21])
    expect(typographyVariables(typography(parchment, { textureStrength: 100 }), parchment)['--page-aging']).toMatch(/^inset /)
  })

  it('resolves the system choice to the day or night style, migrating older IDs', () => {
    expect(resolveStyleId('system', 'paper', 'charcoal', false)).toBe('paper')
    expect(resolveStyleId('system', 'paper', 'charcoal', true)).toBe('charcoal')
    expect(resolveStyleId('kraft', 'paper', 'dark', true)).toBe('kraft')
    expect(resolveStyleId('system', 'butter', 'graphite', false)).toBe('paper')
    expect(resolveStyleId('system', 'butter', 'graphite', true)).toBe('dark')
    expect(resolveStyleId('ink', 'paper', 'dark', false)).toBe('charcoal')
    expect(resolveStyleId('neon', 'paper', 'charcoal', true)).toBe('dark')
    expect(resolveStyleId('neon', 'paper', 'charcoal', false)).toBe('white')
    expect(resolveStyleId('system', 'neon', 'neon', true)).toBe('dark')
    expect(resolveStyleId('system', 'neon', 'neon', false)).toBe('white')
    expect(activeStyle({ theme: 'system', dayTheme: 'white', nightTheme: 'dark' }, true).id).toBe('dark')
    expect(activeStyle(defaultReadingSettings, false).id).toBe('white')
  })

  it('maps typography settings to CSS variables', () => {
    const style = readingStyle('dark')
    const vars = typographyVariables(documentTypography({ ...defaultReadingSettings, paragraphSpacing: 'relaxed', measure: '30', textAlign: 'justify', firstLineIndent: true }, style), style)
    expect(vars).toMatchObject({ '--doc-gap': '1.3em', '--doc-measure': '30em', '--doc-align': 'justify', '--doc-indent': '2em', '--image-filter': 'brightness(.9)', '--doc-hyphens': 'manual', '--doc-justify': 'inter-character' })
    expect(vars['--code-font']).toContain('Mino JetBrains Mono')
    expect(typographyVariables(documentTypography({ ...defaultReadingSettings, measure: 'unlimited', imageDimming: false }, style), style)).toMatchObject({ '--doc-measure': '864px', '--image-filter': 'none' })
    expect(typographyVariables(documentTypography(defaultReadingSettings, readingStyle('paper')), readingStyle('paper'))['--image-filter']).toBe('none')
    expect(typographyVariables(documentTypography({ ...defaultReadingSettings, tableStyle: 'grid' }, style), style)).toMatchObject({ '--table-cell': '1px solid var(--table-line)' })
    expect(typographyVariables(documentTypography(defaultReadingSettings, style), style)).toMatchObject({ '--table-cell': '0', '--table-frame': '0' })
  })

  it('lays out a mostly-Western document the Western way', () => {
    const style = readingStyle('paper')
    const settings = { ...defaultReadingSettings, measure: '36' as const, textAlign: 'left' as const, firstLineIndent: true }
    const cjk = documentTypography(settings, style)
    expect(cjk).toMatchObject({ measure: '36', textAlign: 'left', firstLineIndent: true, hyphens: false, lineHeight: lineHeights.comfortable })
    expect(documentTypography(settings, style, 'cjk')).toEqual(cjk)
    const latin = documentTypography(settings, style, 'latin')
    expect(latin).toMatchObject({ measure: '32', textAlign: 'justify', firstLineIndent: false, hyphens: true, lineHeight: latinLineHeights.comfortable })
    expect(latin.lineHeight).toBeLessThan(cjk.lineHeight)
    expect(latin.fontFamily).toBe(cjk.fontFamily)
    expect(typographyVariables(latin, style)).toMatchObject({ '--doc-measure': '32em', '--doc-align': 'justify', '--doc-indent': '0', '--doc-hyphens': 'auto', '--doc-justify': 'auto', '--doc-line-height': String(latinLineHeights.comfortable) })
    expect(latinMeasures).toEqual({ '30': '28', '36': '32', '42': '36', unlimited: 'unlimited' })
    for (const height of ['compact', 'comfortable', 'relaxed'] as const) {
      expect(latinLineHeights[height]).toBeLessThan(lineHeights[height])
      expect(documentTypography({ ...settings, editorLineHeight: height }, style, 'latin').lineHeight).toBe(latinLineHeights[height])
    }
    expect(typographyVariables(documentTypography({ ...settings, measure: 'unlimited' }, style, 'latin'), style)['--doc-measure']).toBe('864px')
    // Switched off, a Western document keeps the Chinese layout.
    const off = { ...settings, latinLayout: 'off' as const }
    expect(layoutScript(off, 'latin')).toBe('cjk')
    expect(layoutScript(settings, 'latin')).toBe('latin')
    expect(layoutScript(settings, 'cjk')).toBe('cjk')
    expect(documentTypography(off, style, 'latin')).toEqual(cjk)
    const css = documentElementCss(DOC_ROOT)
    expect(css).toContain('-webkit-hyphens:var(--doc-hyphens,manual);hyphens:var(--doc-hyphens,manual)')
    // Code never hyphenates.
    expect(css).toMatch(/\.mino-doc pre\{[^}]*hyphens:manual\}/)
  })

  it('switches between day and night to the remembered style of the other side, set explicitly', () => {
    const settings = { theme: 'system' as const, dayTheme: 'paper' as const, nightTheme: 'charcoal' as const }
    expect(toggledDayNight(settings, false)).toEqual({ theme: 'charcoal' })
    expect(toggledDayNight(settings, true)).toEqual({ theme: 'paper' })
    expect(toggledDayNight({ ...settings, theme: 'kraft' }, true)).toEqual({ theme: 'charcoal' })
    expect(toggledDayNight({ ...settings, theme: 'dark' }, false)).toEqual({ theme: 'paper' })
    // Toggling twice returns to the remembered day style.
    const night = { ...settings, ...toggledDayNight(settings, false) }
    expect(toggledDayNight(night, false)).toEqual({ theme: 'paper' })
  })

  it('remembers a picked style as the day or night choice and keeps following the system when it suits', () => {
    expect(pickedStyle(readingStyle('paper'), { theme: 'system' }, false)).toEqual({ dayTheme: 'paper' })
    expect(pickedStyle(readingStyle('charcoal'), { theme: 'system' }, true)).toEqual({ nightTheme: 'charcoal' })
    expect(pickedStyle(readingStyle('charcoal'), { theme: 'system' }, false)).toEqual({ theme: 'charcoal', nightTheme: 'charcoal' })
    expect(pickedStyle(readingStyle('paper'), { theme: 'system' }, true)).toEqual({ theme: 'paper', dayTheme: 'paper' })
    expect(pickedStyle(readingStyle('mint'), { theme: 'white' }, false)).toEqual({ theme: 'mint', dayTheme: 'mint' })
    expect(pickedStyle(readingStyle('dark'), { theme: 'white' }, true)).toEqual({ theme: 'dark', nightTheme: 'dark' })
  })

  it('follows the style font unless a font was chosen', () => {
    const paper = readingStyle('paper')
    expect(documentFontFamily({ cjkFont: 'auto', latinFont: 'auto' }, paper)).toContain('Mino Noto Serif SC')
    expect(documentFontFamily({ cjkFont: 'auto', latinFont: 'auto' }, readingStyle('xuan'))).toContain('Mino LXGW WenKai')
    expect(documentFontFamily({ cjkFont: 'auto', latinFont: 'auto' }, readingStyle('white'))).toContain('PingFang SC')
    expect(documentFontFamily({ cjkFont: 'hei', latinFont: 'auto' }, paper)).not.toContain('Mino ')
    expect(documentFontFamily({ cjkFont: 'sys:Kaiti SC', latinFont: 'auto' }, paper)).toMatch(/^'Kaiti SC'/)
  })

  it('indents only top-level paragraphs', () => {
    const css = documentElementCss(DOC_ROOT)
    expect(css).toContain('.mino-doc > p{text-indent:var(--doc-indent)}')
    expect(css).toContain('.mino-doc blockquote p{text-indent:0}')
  })
})
