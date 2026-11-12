import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bundledFamilies, choiceFamily, cjkFonts, codeFonts, codeFontStack, CODE_FONT_STACK, FIRA_CODE_FAMILY, SOURCE_CODE_FAMILY, familiesIn, fontStack, isFontChoice, isSystemFontName, latinFonts, systemFontId, systemFontName, withoutBundledFonts,
  FANGSONG_FAMILY, GARAMOND_FAMILY, HUOSONG_FAMILY, INTER_FAMILY, KAI_FAMILY, LITERATA_FAMILY, MONO_FAMILY, SANS_FAMILY, SERIF_FAMILY, SOURCE_SERIF_FAMILY,
} from '../src/features/reading/fonts'
import { bundledFaces, facesForText, fontFaceCss, type FontFace } from '../src/features/reading/fontFaces'
import { FONT_BUDGET_BYTES } from '../vite.config'

/** Where each bundled family's files live, relative to the project root. */
const directories: Record<string, string> = {
  [SERIF_FAMILY]: 'node_modules/@fontsource/noto-serif-sc/files',
  [SANS_FAMILY]: 'node_modules/@fontsource/noto-sans-sc/files',
  [KAI_FAMILY]: 'node_modules/@fontsource/lxgw-wenkai/files',
  [FANGSONG_FAMILY]: 'src/assets/fonts/zhuque-fangsong',
  [HUOSONG_FAMILY]: 'src/assets/fonts/chill-huosong',
  [SOURCE_SERIF_FAMILY]: 'node_modules/@fontsource-variable/source-serif-4/files',
  [LITERATA_FAMILY]: 'node_modules/@fontsource-variable/literata/files',
  [GARAMOND_FAMILY]: 'node_modules/@fontsource-variable/eb-garamond/files',
  [INTER_FAMILY]: 'node_modules/@fontsource-variable/inter/files',
  [MONO_FAMILY]: 'node_modules/@fontsource-variable/jetbrains-mono/files',
  [FIRA_CODE_FAMILY]: 'node_modules/@fontsource-variable/fira-code/files',
  [SOURCE_CODE_FAMILY]: 'node_modules/@fontsource-variable/source-code-pro/files',
}
const westernFamilies = [SOURCE_SERIF_FAMILY, LITERATA_FAMILY, GARAMOND_FAMILY, INTER_FAMILY, MONO_FAMILY]
const fileOnDisk = (face: FontFace) => join(directories[face.family], face.file)
const facesOf = (family: string) => bundledFaces.filter((face) => face.family === family)
const rust = readFileSync('src-tauri/src/settings.rs', 'utf8')

describe('bundled fonts', () => {
  it('bundles twelve families, each with WOFF2 files that exist on disk', () => {
    expect([...bundledFamilies].sort()).toEqual(Object.keys(directories).sort())
    for (const family of Object.keys(directories)) expect(facesOf(family).length, family).toBeGreaterThan(0)
    for (const face of bundledFaces) {
      expect(face.file, face.family).toMatch(/\.woff2$/)
      expect(existsSync(fileOnDisk(face)), fileOnDisk(face)).toBe(true)
      // WOFF2 files start with the signature "wOF2".
      expect(face.url.length).toBeGreaterThan(0)
    }
    expect(readFileSync(fileOnDisk(facesOf(FANGSONG_FAMILY)[0])).subarray(0, 4).toString('latin1')).toBe('wOF2')
    expect(readFileSync(fileOnDisk(facesOf(HUOSONG_FAMILY)[0])).subarray(0, 4).toString('latin1')).toBe('wOF2')
    expect(new Set(bundledFaces.map((face) => `${face.family}/${face.file}`)).size, 'no face listed twice').toBe(bundledFaces.length)
  })

  it('bundles Noto Serif SC and Noto Sans SC as 400 and 700 subsets', () => {
    for (const family of [SERIF_FAMILY, SANS_FAMILY]) {
      const faces = facesOf(family)
      expect(new Set(faces.map((face) => face.weight)), family).toEqual(new Set(['400', '700']))
      expect(faces.filter((face) => face.weight === '400').length, family).toBe(faces.filter((face) => face.weight === '700').length)
      expect(faces.length, family).toBeGreaterThan(150)
      expect(faces.every((face) => face.style === 'normal' && face.ranges !== null && face.ranges.length > 0 && face.unicodeRange !== null), family).toBe(true)
    }
    expect(facesOf(SERIF_FAMILY).length).toBe(202)
  })

  it('bundles LXGW WenKai, Zhuque Fangsong and ChillHuoSong as whole files with weight ranges', () => {
    expect(facesOf(KAI_FAMILY).map((face) => [face.file, face.weight])).toEqual([['lxgw-wenkai-latin-500-normal.woff2', '100 599'], ['lxgw-wenkai-latin-700-normal.woff2', '600 900']])
    expect(facesOf(FANGSONG_FAMILY).map((face) => [face.file, face.weight])).toEqual([['zhuque-fangsong-400.woff2', '100 900']])
    expect(facesOf(HUOSONG_FAMILY).map((face) => [face.file, face.weight])).toEqual([['chill-huosong-400.woff2', '100 900']])
    for (const family of [KAI_FAMILY, FANGSONG_FAMILY, HUOSONG_FAMILY]) expect(facesOf(family).every((face) => face.ranges === null && face.unicodeRange === null && face.style === 'normal'), family).toBe(true)
  })

  it('bundles the five Western families as variable fonts, upright and italic, in the Latin subsets only', () => {
    for (const family of westernFamilies) {
      const faces = facesOf(family)
      expect(faces.map((face) => face.style).sort(), family).toEqual(['italic', 'italic', 'normal', 'normal'])
      for (const face of faces) {
        expect(face.weight, `${family} ${face.file}`).toMatch(/^\d{3} \d{3}$/)
        const [from, to] = face.weight.split(' ').map(Number)
        expect(from, face.file).toBeLessThanOrEqual(400)
        expect(to, face.file).toBeGreaterThanOrEqual(700)
        expect(face.file, family).toMatch(/-(latin|latin-ext)-wght-(normal|italic)\.woff2$/)
        expect(face.file.includes('italic'), face.file).toBe(face.style === 'italic')
        expect(face.ranges, face.file).not.toBeNull()
      }
      expect(new Set(faces.map((face) => /-(latin|latin-ext)-wght-/.exec(face.file)![1])), family).toEqual(new Set(['latin', 'latin-ext']))
      // The Latin subset covers ASCII; no face reaches into Greek, Cyrillic or CJK.
      expect(facesForText('a', new Set([family])).map((face) => face.style).sort(), family).toEqual(['italic', 'normal'])
      expect(facesForText('Жλ读', new Set([family])), family).toEqual([])
    }
  })

  it('stays within the font budget of the build', () => {
    expect(FONT_BUDGET_BYTES).toBe(48 * 1024 * 1024)
    const byFamily = new Map<string, number>()
    for (const face of bundledFaces) byFamily.set(face.family, (byFamily.get(face.family) ?? 0) + statSync(fileOnDisk(face)).size)
    const total = [...byFamily.values()].reduce((sum, size) => sum + size, 0)
    const mib = (bytes: number) => (bytes / 1048576).toFixed(2)
    console.info(`bundled fonts: ${mib(total)} MiB of ${mib(FONT_BUDGET_BYTES)} MiB (${[...byFamily].map(([family, size]) => `${family.replace('Mino ', '')} ${mib(size)}`).join(', ')})`)
    expect(total, `bundled fonts take ${mib(total)} MiB`).toBeLessThanOrEqual(FONT_BUDGET_BYTES)
    expect(total).toBeGreaterThan(1024 * 1024)
  })

  it('declares one rule per face with its style, blocking font display and only WOFF2 sources', () => {
    const css = fontFaceCss(bundledFaces)
    expect(css.match(/@font-face/g)?.length).toBe(bundledFaces.length)
    expect(css.match(/font-style:italic;/g)?.length).toBe(bundledFaces.filter((face) => face.style === 'italic').length)
    expect(css.match(/font-style:normal;/g)?.length).toBe(bundledFaces.filter((face) => face.style === 'normal').length)
    expect(css).not.toMatch(/font-display:\s*swap|format\('woff'\)/)
    expect(css.match(/font-display:block/g)?.length).toBe(bundledFaces.length)
    const italic = facesOf(INTER_FAMILY).find((face) => face.style === 'italic')!
    expect(fontFaceCss([italic], () => 'data:font/woff2;base64,AA==')).toBe(`@font-face{font-family:'${INTER_FAMILY}';font-style:italic;font-weight:${italic.weight};font-display:block;src:url(data:font/woff2;base64,AA==) format('woff2');unicode-range:${italic.unicodeRange};}`)
    expect(fontFaceCss(facesOf(FANGSONG_FAMILY))).not.toContain('unicode-range')
    expect(fontFaceCss([])).toBe('')
  })

  it('offers six Chinese and five Western fonts with unique IDs and families that exist', () => {
    expect(cjkFonts.map((font) => font.id)).toEqual(['song', 'kai', 'sans', 'fangsong', 'huosong', 'hei'])
    expect(latinFonts.map((font) => font.id)).toEqual(['source-serif', 'literata', 'garamond', 'inter', 'mono'])
    for (const font of [...cjkFonts, ...latinFonts]) {
      expect(font.label.length, font.id).toBeGreaterThan(0)
      expect(font.script).toBe(cjkFonts.includes(font) ? 'cjk' : 'latin')
      // settings.rs accepts a bundled font ID as lowercase letters, digits and hyphens, at most 32 long.
      expect(font.id).toMatch(/^[a-z0-9-]{1,32}$/)
      const first = [...familiesIn(font.family)][0]
      expect(bundledFamilies.has(first), `${font.id}: ${first}`).toBe(font.bundled)
      expect(isFontChoice(font.id, font.script)).toBe(true)
      expect(choiceFamily(font.id, font.script)).toBe(font.family)
    }
    expect(cjkFonts.filter((font) => !font.bundled).map((font) => font.id)).toEqual(['hei'])
    expect(CODE_FONT_STACK.startsWith(`'${MONO_FAMILY}', ui-monospace`)).toBe(true)
  })
})

describe('font stacks', () => {
  it('follows the style font when the choice is auto', () => {
    // A Song style: Source Serif draws the Latin letters, Noto Serif SC the Chinese.
    const song = fontStack('auto', 'auto', 'song')
    expect(song.startsWith(`'${SOURCE_SERIF_FAMILY}', '${SERIF_FAMILY}', 'Songti SC'`)).toBe(true)
    expect(song.endsWith(', serif')).toBe(true)
    // WenKai has its own Latin letters.
    const kai = fontStack('auto', 'auto', 'kai')
    expect(kai.startsWith(`'${KAI_FAMILY}', 'Kaiti SC', 'STKaiti'`)).toBe(true)
    expect(kai).not.toContain(SOURCE_SERIF_FAMILY)
    // PingFang: the system font first, so Western text stays in SF.
    const hei = fontStack('auto', 'auto', 'hei')
    expect(hei.startsWith("-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB'")).toBe(true)
    expect(hei.endsWith(', sans-serif')).toBe(true)
    expect(hei).not.toContain('Mino ')
    expect(withoutBundledFonts(hei)).toBe(hei)
  })

  it('puts a chosen Western font first and a chosen Chinese font behind it', () => {
    expect(fontStack('auto', 'inter', 'song').startsWith(`'${INTER_FAMILY}', '${SERIF_FAMILY}'`)).toBe(true)
    expect(fontStack('kai', 'garamond', 'hei').startsWith(`'${GARAMOND_FAMILY}', '${KAI_FAMILY}'`)).toBe(true)
    expect(fontStack('hei', 'literata', 'song').startsWith(`'${LITERATA_FAMILY}', 'PingFang SC'`)).toBe(true)
    expect(fontStack('sans', 'auto', 'song').startsWith(`'${SANS_FAMILY}', 'PingFang SC'`)).toBe(true)
    expect(fontStack('fangsong', 'auto', 'hei').startsWith(`'${SOURCE_SERIF_FAMILY}', '${FANGSONG_FAMILY}', 'STFangsong'`)).toBe(true)
    expect(fontStack('huosong', 'auto', 'hei').startsWith(`'${SOURCE_SERIF_FAMILY}', '${HUOSONG_FAMILY}'`)).toBe(true)
    expect(fontStack('song', 'mono', 'hei').startsWith(`'${MONO_FAMILY}', '${SERIF_FAMILY}'`)).toBe(true)
    // An explicit choice does not depend on the style.
    expect(fontStack('song', 'inter', 'kai')).toBe(fontStack('song', 'inter', 'hei'))
  })

  it('quotes fonts installed on the Mac by name', () => {
    expect(systemFontId('方正书宋 GBK')).toBe('sys:方正书宋 GBK')
    expect(systemFontName('sys:方正书宋 GBK')).toBe('方正书宋 GBK')
    expect(systemFontName('song')).toBeNull()
    expect(systemFontName('sys:')).toBeNull()
    expect(choiceFamily('sys:Georgia', 'latin')).toBe("'Georgia'")
    expect(choiceFamily('auto', 'cjk')).toBeNull()
    const stack = fontStack('sys:方正书宋 GBK', 'sys:Avenir Next', 'song')
    expect(stack.startsWith("'Avenir Next', '方正书宋 GBK', ")).toBe(true)
    expect(fontStack('sys:Kaiti SC', 'auto', 'song').startsWith("'Kaiti SC', ")).toBe(true)
    expect(fontStack('auto', 'sys:Georgia', 'kai').startsWith(`'Georgia', '${KAI_FAMILY}'`)).toBe(true)
    expect(familiesIn(stack).has('方正书宋 GBK')).toBe(true)
    expect(withoutBundledFonts(stack)).toBe(stack)
  })

  it('falls back to auto for unknown choices, including a font of the other script', () => {
    for (const styleFont of ['song', 'kai', 'hei'] as const) {
      const auto = fontStack('auto', 'auto', styleFont)
      expect(fontStack('comic-sans', 'papyrus', styleFont)).toBe(auto)
      expect(fontStack('', '', styleFont)).toBe(auto)
      expect(fontStack('inter', 'song', styleFont)).toBe(auto)
      expect(fontStack("sys:a'b", 'sys:x;}', styleFont)).toBe(auto)
      expect(fontStack('constructor', '__proto__', styleFont)).toBe(auto)
    }
    expect(isFontChoice('auto', 'cjk')).toBe(true)
    expect(isFontChoice('auto', 'latin')).toBe(true)
    expect(isFontChoice('inter', 'cjk')).toBe(false)
    expect(isFontChoice('song', 'latin')).toBe(false)
    expect(isFontChoice('sys:Georgia', 'cjk')).toBe(true)
    expect(isFontChoice("sys:a'b", 'latin')).toBe(false)
    expect(isFontChoice('comic-sans', 'latin')).toBe(false)
  })

  it('never writes an unsafe name into a stack', () => {
    const unsafe = ["a'b", 'a"b', 'a\\b', 'a,b', 'a;b', 'a{b', 'a}b', 'a<b', 'a>b', "x'; } body { display: none } .y { font-family: 'z", 'a\nb', ' Georgia', 'Georgia ', '']
    const safe = /^(?:(?:'[^'"\\,;{}<>\u0000-\u001f]+'|[a-zA-Z-]+)(?:, |$))+$/
    for (const name of unsafe) {
      for (const stack of [fontStack(`sys:${name}`, 'auto', 'song'), fontStack('auto', `sys:${name}`, 'kai'), fontStack(`sys:${name}`, `sys:${name}`, 'hei')]) {
        expect(stack, JSON.stringify(name)).toMatch(safe)
        if (name.trim()) expect(stack.includes(name), JSON.stringify(name)).toBe(false)
      }
      expect(choiceFamily(`sys:${name}`, 'cjk')).toBeNull()
    }
    for (const cjk of ['auto', ...cjkFonts.map((font) => font.id), 'sys:方正书宋 GBK']) {
      for (const latin of ['auto', ...latinFonts.map((font) => font.id), 'sys:Avenir Next']) {
        for (const styleFont of ['song', 'kai', 'hei'] as const) expect(fontStack(cjk, latin, styleFont), `${cjk}/${latin}/${styleFont}`).toMatch(safe)
      }
    }
  })

  it('accepts family names that are safe inside a quoted CSS string and nothing else', () => {
    const cases: [string, boolean][] = [
      ['Georgia', true], ['Avenir Next', true], ['方正书宋 GBK', true], ['霞鹜文楷', true], ['ヒラギノ明朝 ProN', true], ['Noto Sans CJK SC', true], ['SF Pro Text', true], ['Source Han Serif SC VF', true], ['A', true], ['PT Serif (Caption)', true], ['a-b_c.d', true],
      ['', false], [' Georgia', false], ['Georgia ', false], ['\tGeorgia', false], ['Georgia\n', false],
      ["a'b", false], ['a"b', false], ['a\\b', false], ['a,b', false], ['a;b', false], ['a{b', false], ['a}b', false], ['a<b', false], ['a>b', false],
      ['a\u0000b', false], ['a\nb', false], ['a\tb', false], ['a\u001fb', false], ['a\u007fb', false], ['a\u0085b', false], ['a\u009fb', false],
      ['a'.repeat(100), true], ['a'.repeat(101), false], ['字'.repeat(100), true], ['字'.repeat(101), false],
      // The limit counts characters, as `chars().count()` does in Rust, not UTF-16 units.
      ['😀'.repeat(100), true], ['😀'.repeat(101), false],
    ]
    for (const [name, ok] of cases) {
      expect(isSystemFontName(name), JSON.stringify(name.length > 20 ? `${name.slice(0, 4)}… ×${Array.from(name).length}` : name)).toBe(ok)
      expect(systemFontName(systemFontId(name))).toBe(ok ? name : null)
      expect(isFontChoice(systemFontId(name), 'cjk')).toBe(ok)
    }
  })

  it('applies the same rule as is_font_choice in settings.rs', () => {
    const rule = /fn is_font_choice\(value: &str\) -> bool \{([\s\S]*?)\n\}/.exec(rust)?.[1]
    expect(rule, 'is_font_choice in settings.rs').toBeTruthy()
    expect(rule).toContain('strip_prefix("sys:")')
    expect(rule).toContain('!name.is_empty()')
    expect(rule).toContain('name.chars().count() <= 100')
    expect(rule).toContain('name.trim() == name')
    expect(rule).toContain('c.is_control()')
    const forbidden = /matches!\(c, ([^)]*)\)/.exec(rule!)?.[1]
    expect(forbidden, 'the forbidden characters').toBeTruthy()
    const characters = Array.from(forbidden!.matchAll(/'(\\?.)'/g), (match) => match[1].replace(/^\\/, ''))
    expect(characters.sort()).toEqual(['"', "'", '\\', ',', ';', '{', '}', '<', '>'].sort())
    for (const character of characters) expect(isSystemFontName(`a${character}b`), character).toBe(false)
    // Names the Rust tests accept and refuse.
    expect(rust).toContain('"sys:方正书宋 GBK"')
    expect(isFontChoice('sys:方正书宋 GBK', 'cjk')).toBe(true)
    for (const refused of ["sys:a'b", 'sys:', 'sys:x;y', 'Comic Sans']) {
      expect(rust).toContain(`"${refused}"`)
      expect(isFontChoice(refused, 'cjk')).toBe(false)
      expect(isFontChoice(refused, 'latin')).toBe(false)
    }
    // The fonts that older settings migrate to are choices this version knows.
    for (const [, cjk, latin] of rust.matchAll(/=> \("([^"]+)", "([^"]+)"\)/g)) {
      expect(isFontChoice(cjk, 'cjk'), cjk).toBe(true)
      expect(isFontChoice(latin, 'latin'), latin).toBe(true)
    }
  })

  it('removes the bundled families from a stack and keeps the system ones', () => {
    expect(withoutBundledFonts(fontStack('auto', 'auto', 'kai'))).toBe("'Kaiti SC', 'STKaiti', 'Songti SC', 'STSong', serif")
    expect(withoutBundledFonts(fontStack('auto', 'auto', 'song'))).toBe("'Songti SC', 'STSong', 'Songti SC', 'STSong', serif")
    expect(withoutBundledFonts(fontStack('sys:Kaiti SC', 'inter', 'song')).startsWith("'Kaiti SC', ")).toBe(true)
    expect(withoutBundledFonts(CODE_FONT_STACK)).toBe("ui-monospace, SFMono-Regular, Menlo, 'PingFang SC', monospace")
    expect(withoutBundledFonts(`'${INTER_FAMILY}'`)).toBe('')
    for (const cjk of cjkFonts) for (const latin of latinFonts) expect(withoutBundledFonts(fontStack(cjk.id, latin.id, 'song'))).not.toContain('Mino ')
  })
})

describe('font subsets for a text', () => {
  it('picks only the subsets that cover characters of the text', () => {
    const picked = facesForText('阅读 Reading', new Set([SERIF_FAMILY]))
    const files = picked.map((face) => face.file)
    expect(files).toContain('noto-serif-sc-116-400-normal.woff2')
    expect(files).toContain('noto-serif-sc-latin-400-normal.woff2')
    expect(files).toContain('noto-serif-sc-latin-700-normal.woff2')
    expect(files.some((file) => file.includes('cyrillic'))).toBe(false)
    expect(picked.length).toBeLessThan(12)
    expect(facesForText('', new Set([SERIF_FAMILY]))).toEqual([])
    expect(facesForText('阅读', new Set(['Georgia']))).toEqual([])
    expect(facesForText('阅读', new Set())).toEqual([])
    expect(facesForText('Привет', new Set([SERIF_FAMILY])).some((face) => face.file.includes('cyrillic'))).toBe(true)
    // Only the families asked for.
    const both = facesForText('阅读 Reading', new Set([SERIF_FAMILY, SANS_FAMILY]))
    expect(new Set(both.map((face) => face.family))).toEqual(new Set([SERIF_FAMILY, SANS_FAMILY]))
    expect(facesForText('阅读 Reading', new Set([SANS_FAMILY])).every((face) => face.family === SANS_FAMILY)).toBe(true)
    // Characters outside the Basic Multilingual Plane are matched by code point.
    const face = (ranges: [number, number][] | null, style: 'normal' | 'italic' = 'normal', file = 'x.woff2'): FontFace => ({ family: 'X', weight: '400', style, file, url: file, ranges, unicodeRange: null })
    const emoji = face([[0x1f600, 0x1f64f]]), surrogates = face([[0xd800, 0xdfff]]), edge = face([[0x41, 0x41]]), after = face([[0x42, 0x5a]])
    expect(facesForText('😀', new Set(['X']), [emoji, surrogates])).toEqual([emoji])
    expect(facesForText('A', new Set(['X']), [edge, after])).toEqual([edge])
    expect(facesForText('AZ', new Set(['X']), [edge, after])).toEqual([edge, after])
  })

  it('leaves italic faces out when the document has no emphasis', () => {
    const families = new Set([SOURCE_SERIF_FAMILY])
    const withItalic = facesForText('Reading', families)
    expect(withItalic.map((face) => face.style).sort()).toEqual(['italic', 'normal'])
    expect(facesForText('Reading', families, bundledFaces, true)).toEqual(withItalic)
    const upright = facesForText('Reading', families, bundledFaces, false)
    expect(upright.map((face) => face.style)).toEqual(['normal'])
    expect(upright[0].file).toBe('source-serif-4-latin-wght-normal.woff2')
    // Latin Extended letters bring in the second subset.
    expect(facesForText('Dvořák', families, bundledFaces, false).map((face) => face.file).sort()).toEqual(['source-serif-4-latin-ext-wght-normal.woff2', 'source-serif-4-latin-wght-normal.woff2'])
    // Families without italic faces are unaffected.
    expect(facesForText('阅读', new Set([SERIF_FAMILY]), bundledFaces, false)).toEqual(facesForText('阅读', new Set([SERIF_FAMILY])))
  })

  it('takes fonts without subsets whole, whatever the text', () => {
    expect(facesForText('a', new Set([KAI_FAMILY])).length).toBe(2)
    expect(facesForText('', new Set([KAI_FAMILY])).length).toBe(2)
    expect(facesForText('楷', new Set([KAI_FAMILY]), bundledFaces, false).length).toBe(2)
    expect(facesForText('仿宋 text', new Set([FANGSONG_FAMILY])).map((face) => face.file)).toEqual(['zhuque-fangsong-400.woff2'])
    expect(facesForText('x', new Set([HUOSONG_FAMILY]), bundledFaces, false).map((face) => face.file)).toEqual(['chill-huosong-400.woff2'])
  })
})

describe('fonts that ship as one large file', () => {
  it('marks exactly the families without subsets, so the picker does not load them to draw a name', () => {
    const heavy = [...cjkFonts, ...latinFonts, ...codeFonts].filter((font) => font.heavy)
    expect(heavy.map((font) => font.id)).toEqual(['kai', 'fangsong', 'huosong'])
    // A family is heavy when none of its faces is limited to a range of characters.
    for (const font of [...cjkFonts, ...latinFonts, ...codeFonts].filter((item) => item.bundled)) {
      const family = [...familiesIn(font.family)][0]
      const whole = bundledFaces.filter((face) => face.family === family).every((face) => face.ranges === null)
      expect(Boolean(font.heavy), font.id).toBe(whole)
    }
  })
})

describe('T90 code fonts', () => {
  it('offers three bundled and three system monospace fonts', () => {
    expect(codeFonts.map((font) => font.id)).toEqual(['jetbrains-mono', 'fira-code', 'source-code-pro', 'sf-mono', 'menlo', 'monaco'])
    expect(codeFonts.filter((font) => font.bundled).map((font) => font.id)).toEqual(['jetbrains-mono', 'fira-code', 'source-code-pro'])
    for (const font of codeFonts) {
      expect(font.script).toBe('code')
      expect(font.kind).toBe('mono')
      expect(isFontChoice(font.id, 'code'), font.id).toBe(true)
      // settings.rs accepts a listed font ID as lowercase letters, digits and hyphens, at most 32 long.
      expect(font.id).toMatch(/^[a-z0-9-]{1,32}$/)
      if (font.bundled) expect(bundledFamilies.has([...familiesIn(font.family)][0]), font.id).toBe(true)
    }
    // Both new families have files for basic and extended Latin.
    for (const family of [FIRA_CODE_FAMILY, SOURCE_CODE_FAMILY]) expect(bundledFaces.filter((face) => face.family === family && face.style === 'normal').map((face) => face.file).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/-latin-wght-normal\.woff2$/), expect.stringMatching(/-latin-ext-wght-normal\.woff2$/)]))
  })

  it('builds the code stack from the choice and always ends in system fallbacks', () => {
    expect(codeFontStack('auto')).toBe(CODE_FONT_STACK)
    expect(codeFontStack('jetbrains-mono')).toBe(CODE_FONT_STACK)
    expect(codeFontStack('fira-code')).toBe(`'${FIRA_CODE_FAMILY}', ui-monospace, SFMono-Regular, Menlo, 'PingFang SC', monospace`)
    expect(codeFontStack('menlo').startsWith('Menlo, ui-monospace')).toBe(true)
    expect(codeFontStack('sys:Maple Mono').startsWith("'Maple Mono', ui-monospace")).toBe(true)
    // A font from a newer version, or a name that is not safe in CSS, falls back to the default.
    expect(codeFontStack('no-such-font')).toBe(CODE_FONT_STACK)
    expect(codeFontStack("sys:a'b")).toBe(CODE_FONT_STACK)
    // A code font is not a text font and the other way round.
    expect(isFontChoice('fira-code', 'latin')).toBe(false)
    expect(isFontChoice('song', 'code')).toBe(false)
    expect(withoutBundledFonts(codeFontStack('source-code-pro'))).toBe("ui-monospace, SFMono-Regular, Menlo, 'PingFang SC', monospace")
  })

  it('reaches the stylesheet through the typography variables, in the app and in exports', async () => {
    const { typographyVariables } = await import('../src/features/reading/css')
    const { documentTypography, defaultReadingSettings } = await import('../src/app/readingSettings')
    const { readingStyle } = await import('../src/features/reading/styles')
    const style = readingStyle('white')
    expect(typographyVariables(documentTypography(defaultReadingSettings, style), style)['--code-font']).toBe(CODE_FONT_STACK)
    expect(typographyVariables(documentTypography({ ...defaultReadingSettings, codeFont: 'fira-code' }, style), style)['--code-font']).toBe(codeFontStack('fira-code'))
    expect(typographyVariables(documentTypography({ ...defaultReadingSettings, codeFont: 'sys:Maple Mono' }, style), style)['--code-font']).toContain("'Maple Mono'")
  })
})

describe('the generated font files (T98)', () => {
  it('are what the generator makes from the installed font packages', async () => {
    // @ts-expect-error The generator is a plain Node script without type declarations.
    const generator = await import('../scripts/generate-font-table.mjs') as { buildCss: () => string; buildTable: () => string; outputs: { css: string; table: string } }
    expect(readFileSync(generator.outputs.table, 'utf8')).toBe(generator.buildTable())
    expect(readFileSync(generator.outputs.css, 'utf8')).toBe(generator.buildCss())
  })

  it('register every face under a family the app knows, and every family the app knows has faces', () => {
    expect(new Set(bundledFaces.map((face) => face.family))).toEqual(bundledFamilies)
    expect(bundledFamilies.size).toBe(12)
  })

  it('give the page the same rules the app used to write from the face list, with each file found by the build', () => {
    const css = readFileSync('src/features/reading/bundledFonts.css', 'utf8')
    const rules = css.split('\n').filter((line) => line.startsWith('@font-face'))
    expect(rules).toHaveLength(bundledFaces.length)
    // The style sheet names each file by its path; the table has the same faces in the same order.
    const paths = rules.map((rule) => /src:url\(\.\.\/\.\.\/\.\.\/([^)]+)\)/.exec(rule)![1])
    expect(paths.map((path) => path.split('/').pop())).toEqual(bundledFaces.map((face) => face.file))
    for (const path of paths) expect(existsSync(path), path).toBe(true)
    expect(rules.map((rule) => rule.replace(/src:url\([^)]+\)/, 'src:url(FILE)'))).toEqual(fontFaceCss(bundledFaces, () => 'FILE').split('\n'))
  })

  it('works out a face\'s ranges when they are asked for, once', () => {
    const face = bundledFaces.find((item) => item.family === SERIF_FAMILY)!
    expect(Object.getOwnPropertyDescriptor(face, 'ranges')?.get).toBeTypeOf('function')
    expect(face.ranges).toBe(face.ranges)
    expect(face.ranges![0]).toHaveLength(2)
    expect(face.ranges!.length).toBe(face.unicodeRange!.split(',').length)
  })
})
