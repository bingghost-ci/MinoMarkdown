import { contrast, fromHsl, isHexColor, luminance, mix, toHsl, towardContrast } from '../reading/color'
import { CAVEAT_FAMILY, INTER_FAMILY, KAI_FAMILY, LONG_CANG_FAMILY, MA_SHAN_FAMILY, MONO_FAMILY, OXANIUM_FAMILY, systemFontName } from '../reading/fonts'
import { readingStyle, type ReadingStyle } from '../reading/styles'
import { customColorsKey, diagramColorRoles, noDiagramColors, type DiagramColorRole, type DiagramCustomColors } from './colorKey'

export { customColorsKey, diagramColorRoles, noDiagramColors, type DiagramColorRole, type DiagramCustomColors }

/**
 * How Mermaid diagrams are drawn. A look decides the drawing; the options beside it decide what the user may
 * change within a look: the color scheme, the label font, how edges run and are patterned, and how the
 * hand-drawn looks fill their shapes. Every color is worked out from the reading style, so a diagram sits on
 * the page the way text does.
 *
 * Mermaid itself only ever draws a plain diagram from the variables and CSS made here. Looks that Mermaid
 * cannot draw are finished afterwards: `sketch.ts` redraws the hand-drawn ones, `dress.ts` the diagram of
 * cards and the console.
 * This module does not import Mermaid, so the settings can list the looks without loading it.
 */
export const diagramLooks = ['page', 'program', 'hand', 'pencil', 'chalk', 'scifi', 'ink', 'color'] as const
export type DiagramLook = (typeof diagramLooks)[number]
export const diagramLines = ['auto', 'solid', 'dashed', 'dotted'] as const
export type DiagramLine = (typeof diagramLines)[number]
export const diagramCurves = ['auto', 'curved', 'angular', 'straight'] as const
export type DiagramCurve = (typeof diagramCurves)[number]
/** How a hand-drawn look fills a shape: a wash of color set off from the outline, hatching, flat color or nothing. */
export const diagramFills = ['auto', 'wash', 'hatch', 'solid', 'none'] as const
export type DiagramFill = (typeof diagramFills)[number]
export const diagramColorSchemes = ['auto', 'ember', 'ocean', 'forest', 'grape', 'rose', 'graphite', 'custom'] as const
export type DiagramColorScheme = (typeof diagramColorSchemes)[number]
/** Fonts offered for labels besides `auto` (the look's own) and `sys:<family>`. */
export const diagramFontIds = ['doc', 'longcang', 'mashan', 'kai', 'sans', 'mono', 'tech'] as const
export type DiagramFontId = (typeof diagramFontIds)[number]
export type DiagramFont = 'auto' | DiagramFontId | `sys:${string}`

export type DiagramOptions = { look: DiagramLook; line: DiagramLine; curve: DiagramCurve; fill: DiagramFill; colors: DiagramColorScheme; custom: DiagramCustomColors; font: DiagramFont }
export const defaultDiagramOptions: DiagramOptions = { look: 'page', line: 'auto', curve: 'auto', fill: 'auto', colors: 'auto', custom: noDiagramColors, font: 'auto' }

/** Names and notes for the settings, in Chinese; `i18n.ts` translates them. */
export const diagramLookLabels: Record<DiagramLook, { name: string; note: string }> = {
  page: { name: '纸面', note: '节点染上强调色，圆角、曲线，安静地印在纸上' },
  program: { name: '架构', note: '技术文档里的架构图：浅色卡片、虚线分组框、带文字的连线用强调色，整张图垫一块底板；节点加 :::dark 成为深色核心块' },
  hand: { name: '彩笔', note: '一笔画成的墨线，底下是错开一点的水彩色块，手写字' },
  pencil: { name: '铅笔', note: '石墨灰的细线反复描出轮廓，灰色排线当阴影，带铅笔的颗粒' },
  chalk: { name: '粉笔', note: '黑板上的彩色粉笔：粗而发毛的线条，每个节点一种颜色' },
  scifi: { name: '科幻', note: '飞船控制台：深色屏幕和网格，切角面板，发光的描边和数据线' },
  ink: { name: '钢笔', note: '方格纸上的钢笔画：浓黑的墨线，方框描双线，实心箭头，不填色' },
  color: { name: '彩色', note: '柔和的多色色块，颜色向纸色靠拢' },
}
export const diagramLineLabels: Record<DiagramLine, string> = { auto: '随风格', solid: '实线', dashed: '虚线', dotted: '点线' }
export const diagramCurveLabels: Record<DiagramCurve, string> = { auto: '随风格', curved: '曲线', angular: '折线', straight: '直线' }
export const diagramFillLabels: Record<DiagramFill, string> = { auto: '随风格', wash: '水彩', hatch: '排线', solid: '平涂', none: '不填' }
export const diagramColorLabels: Record<DiagramColorScheme, string> = { auto: '随纸张', ember: '橙红', ocean: '海蓝', forest: '松绿', grape: '葡萄紫', rose: '玫瑰', graphite: '石墨', custom: '自定义' }
export const diagramColorRoleLabels: Record<DiagramColorRole, string> = { accent: '强调色', node: '节点底色', border: '节点边框', line: '连线', text: '文字' }
export const diagramFontLabels: Record<'auto' | DiagramFontId, string> = { auto: '随风格', doc: '正文字体', longcang: '行书', mashan: '手写楷书', kai: '楷书', sans: '无衬线', mono: '等宽', tech: '科技' }

const isOneOf = <T extends string>(list: readonly T[]) => (value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)
export const isDiagramLook = isOneOf(diagramLooks)
export const isDiagramLine = isOneOf(diagramLines)
export const isDiagramCurve = isOneOf(diagramCurves)
export const isDiagramFill = isOneOf(diagramFills)
export const isDiagramColorScheme = isOneOf(diagramColorSchemes)
const isFontId = isOneOf(diagramFontIds)
export function isDiagramFont(value: unknown): value is DiagramFont {
  return value === 'auto' || isFontId(value) || (typeof value === 'string' && systemFontName(value) !== null)
}
/** Only known roles with `#rrggbb` values: these reach CSS. */
export function cleanDiagramColors(value: unknown): DiagramCustomColors {
  const colors: DiagramCustomColors = {}
  if (value && typeof value === 'object') for (const role of diagramColorRoles) { const color = (value as Record<string, unknown>)[role]; if (isHexColor(color)) colors[role] = color.toLowerCase() }
  return colors
}

/** The options as given, with anything unknown read as the default. */
export function diagramOptions(given: Partial<Record<keyof DiagramOptions, unknown>> = {}): DiagramOptions {
  return {
    look: isDiagramLook(given.look) ? given.look : defaultDiagramOptions.look,
    line: isDiagramLine(given.line) ? given.line : 'auto',
    curve: isDiagramCurve(given.curve) ? given.curve : 'auto',
    fill: isDiagramFill(given.fill) ? given.fill : 'auto',
    colors: isDiagramColorScheme(given.colors) ? given.colors : 'auto',
    custom: cleanDiagramColors(given.custom),
    font: isDiagramFont(given.font) ? given.font : 'auto',
  }
}

export function parseCustomColorsKey(key: string | undefined): DiagramCustomColors {
  const parts = (key ?? '').split('.')
  return cleanDiagramColors(Object.fromEntries(diagramColorRoles.map((role, index) => [role, parts[index] ? `#${parts[index]}` : undefined])))
}

/** A style and the diagram options together; drawn diagrams and the cache are keyed by it. */
export function diagramKey(styleId: string, given: Partial<Record<keyof DiagramOptions, unknown>> = {}): string {
  const options = diagramOptions(given)
  return [styleId, options.look, options.line, options.curve, options.fill, options.colors, encodeURIComponent(options.font), customColorsKey(options.custom)].join(':')
}

/** Reads `diagramKey`; a bare style ID means that style with the default options. */
export function parseDiagramKey(key: string): { styleId: string } & DiagramOptions {
  const [styleId, look, line, curve, fill, colors, font, custom] = key.split(':')
  let family: string | undefined
  try { family = font === undefined ? undefined : decodeURIComponent(font) } catch { family = undefined }
  return { styleId: styleId || 'white', ...diagramOptions({ look, line, curve, fill, colors, font: family, custom: parseCustomColorsKey(custom) }) }
}

/** What `auto` means for each look. */
const lookDefaults: Record<DiagramLook, { line: Exclude<DiagramLine, 'auto'>; curve: Exclude<DiagramCurve, 'auto'>; fill: Exclude<DiagramFill, 'auto'>; font: DiagramFontId }> = {
  page: { line: 'solid', curve: 'curved', fill: 'solid', font: 'doc' },
  program: { line: 'solid', curve: 'angular', fill: 'solid', font: 'sans' },
  hand: { line: 'solid', curve: 'curved', fill: 'wash', font: 'mashan' },
  pencil: { line: 'solid', curve: 'curved', fill: 'hatch', font: 'longcang' },
  chalk: { line: 'solid', curve: 'curved', fill: 'none', font: 'mashan' },
  // Straight data lines: stepped ones run along each other where several leave one panel, and cannot be told apart.
  scifi: { line: 'solid', curve: 'straight', fill: 'solid', font: 'tech' },
  ink: { line: 'solid', curve: 'angular', fill: 'none', font: 'longcang' },
  color: { line: 'solid', curve: 'curved', fill: 'solid', font: 'doc' },
}
export function resolvedLine(look: DiagramLook, line: DiagramLine): Exclude<DiagramLine, 'auto'> { return line === 'auto' ? lookDefaults[look].line : line }
export function resolvedCurve(look: DiagramLook, curve: DiagramCurve): Exclude<DiagramCurve, 'auto'> { return curve === 'auto' ? lookDefaults[look].curve : curve }
export function resolvedFill(look: DiagramLook, fill: DiagramFill): Exclude<DiagramFill, 'auto'> { return fill === 'auto' ? lookDefaults[look].fill : fill }
/** The looks drawn by hand, which are the ones the fill applies to. */
export function isSketchLook(look: DiagramLook): boolean { return look === 'hand' || look === 'pencil' || look === 'chalk' || look === 'ink' }

const fontStacks: Record<DiagramFontId, string> = {
  doc: 'inherit',
  longcang: `'${CAVEAT_FAMILY}', '${LONG_CANG_FAMILY}', 'Kaiti SC', cursive`,
  mashan: `'${MA_SHAN_FAMILY}', 'Kaiti SC', cursive`,
  kai: `'${KAI_FAMILY}', 'Kaiti SC', cursive`,
  sans: `'${INTER_FAMILY}', 'PingFang SC', 'Hiragino Sans GB', sans-serif`,
  mono: `'${MONO_FAMILY}', 'PingFang SC', monospace`,
  tech: `'${OXANIUM_FAMILY}', 'PingFang SC', 'Hiragino Sans GB', sans-serif`,
}
/** The font stack labels are drawn in; `inherit` is the document's own. Mermaid measures labels in it, so it is loaded first. */
export function diagramFontFamily(look: DiagramLook, font: DiagramFont = 'auto'): string {
  if (font.startsWith('sys:')) { const name = systemFontName(font); return name ? `'${name}', 'PingFang SC', sans-serif` : fontStacks[lookDefaults[look].font] }
  return fontStacks[font === 'auto' ? lookDefaults[look].font : font as DiagramFontId]
}
/** The look's own font; kept for callers that know nothing of the font option. */
export const diagramFonts: Record<DiagramLook, string> = Object.fromEntries(diagramLooks.map((look) => [look, diagramFontFamily(look)])) as Record<DiagramLook, string>

const schemeAccents: Record<Exclude<DiagramColorScheme, 'auto' | 'custom'>, string> = { ember: '#d9532b', ocean: '#2a6fdb', forest: '#2b8a57', grape: '#7a4fd6', rose: '#d4447c', graphite: '#5b6068' }

/** Moves a color's lightness until it stands out from the ground by `ratio`, keeping its hue. */
export function fitColor(color: string, ground: string, ratio: number): string {
  return towardContrast(color, ground, ratio, { lighter: luminance(ground) < 0.3, step: 0.03, steps: 24, floor: 0.04, ceiling: 0.96 })
}

/**
 * The colors of a diagram, worked out once from the reading style, the look and the scheme. `ground` is what
 * the shapes sit on: the page, or the board a look lays under the whole diagram (`panel`).
 */
export type DiagramTone = {
  dark: boolean; paper: string; panel: string | null; ground: string
  text: string; muted: string; accent: string; second: string
  node: string; border: string; line: string; frame: string
  /** Colors given to nodes in turn by the looks that use several. */
  pens: string[]
  /** The ruling of the board, for the looks that have one: squared paper, a console's grid. */
  grid: string | null
}

export function diagramTone(styleId: string, given: Partial<DiagramOptions> = {}): DiagramTone {
  const options = diagramOptions(given), style = readingStyle(styleId), look = options.look
  const custom = options.colors === 'custom' ? options.custom : noDiagramColors
  const picked = options.colors === 'custom' ? custom.accent ?? style.link : options.colors === 'auto' ? style.link : schemeAccents[options.colors]
  const [hue, saturation] = toHsl(picked)
  // The board under the diagram: a lighter sheet for cards, a screen for the console, a blackboard for chalk.
  const panel = look === 'program' ? (style.dark ? mix(style.paper, '#000000', 0.22) : mix(style.paper, '#ffffff', 0.55))
    : look === 'scifi' ? mix('#070b14', fromHsl(hue, 0.7, 0.3), 0.1)
    : look === 'chalk' ? mix('#27332f', fromHsl(hue, 0.3, 0.25), options.colors === 'auto' ? 0 : 0.35)
    // Squared paper for the pen, a shade off the page so the sheet shows.
    : look === 'ink' ? (style.dark ? mix(style.paper, '#000000', 0.18) : mix(style.paper, '#fffdf6', 0.6))
    : null
  const ground = panel ?? style.paper
  const dark = luminance(ground) < 0.3
  const ink = look === 'scifi' ? mix('#ffffff', fromHsl(hue, 0.9, 0.8), 0.25) : look === 'chalk' ? '#f3f1e7' : dark === style.dark ? style.text : (dark ? '#ececec' : '#22252a')
  const text = custom.text ?? ink
  const accent = look === 'scifi' ? fromHsl(options.colors === 'auto' ? 187 : hue, options.colors === 'graphite' ? 0.12 : 0.95, 0.6) : fitColor(picked, ground, 3)
  const second = look === 'scifi' ? fromHsl((options.colors === 'auto' ? 187 : hue) + 150, 0.95, 0.66) : fitColor(fromHsl(hue + 150, Math.max(0.35, saturation * 0.8), dark ? 0.66 : 0.42), ground, 3)
  const hues = (count: number, start: number) => Array.from({ length: count }, (_, index) => start + [0, 150, 205, 95, 268, 40, 320, 180][index % 8])
  let node: string, border: string, line: string, frame: string, pens: string[]
  switch (look) {
    case 'program':
      node = mix(ground, ink, dark ? 0.09 : 0.055); border = mix(ground, ink, dark ? 0.22 : 0.17); line = mix(ink, ground, 0.45); frame = mix(ink, ground, 0.5); pens = [accent]
      break
    case 'scifi':
      node = mix(ground, accent, 0.1); border = accent; line = accent; frame = mix(accent, ground, 0.45); pens = [accent, second]
      break
    case 'chalk':
      node = ground; border = ink; line = ink; frame = mix(ink, ground, 0.35)
      pens = options.colors === 'auto' ? ['#f6a6b8', '#f7e08a', '#9fd8f2', '#aee6b9', '#f5b98a', '#cbb7f5'] : hues(6, hue).map((h) => fromHsl(h, 0.8, 0.8))
      break
    case 'pencil': {
      const lead = mix(ink, ground, 0.3)
      node = ground; border = lead; line = lead; frame = mix(lead, ground, 0.25)
      pens = [options.colors === 'auto' || options.colors === 'graphite' ? mix(lead, ground, 0.74) : mix(fitColor(picked, ground, 2.2), ground, 0.6)]
      break
    }
    case 'hand': {
      const pen = mix(ink, ground, 0.08)
      // A yellow-green wash is bright for its lightness (the pine style's accent), so the fill moves away from the text until the label reads.
      node = towardContrast(dark ? fromHsl(hue, 0.4, 0.3) : fromHsl(hue, 0.75, 0.86), text, 4.6, { lighter: !dark, step: 0.02, steps: 15 }); border = pen; line = pen; frame = mix(fitColor(picked, ground, 3), ink, 0.1)
      pens = hues(8, options.colors === 'auto' ? 340 : hue).map((h) => mix(dark ? fromHsl(h, 0.45, 0.34) : fromHsl(h, 0.8, 0.84), ground, 0.06))
      break
    }
    case 'ink': {
      // Black ink, or the scheme's color as the ink in the pen.
      const pen = options.colors === 'auto' || options.colors === 'graphite' ? mix(ink, dark ? '#ffffff' : '#000000', 0.5) : fitColor(mix(picked, dark ? '#ffffff' : '#000000', 0.35), ground, 7)
      node = ground; border = pen; line = pen; frame = pen; pens = [pen]
      break
    }
    case 'color':
      // A color for each node, starting from the scheme's; `dress.ts` gives them out.
      node = ''; border = ''; line = mix(ink, ground, 0.3); frame = mix(ink, ground, 0.6)
      pens = hues(8, options.colors === 'auto' ? 212 : hue).map((h) => dark ? fromHsl(h, 0.45, 0.3) : fromHsl(h, 0.78, 0.89))
      break
    default:
      node = mix(ground, accent, dark ? 0.2 : 0.11); border = mix(mix(accent, ink, 0.4), ground, dark ? 0.3 : 0.25); line = mix(ink, ground, 0.25); frame = mix(ink, ground, 0.7); pens = [accent]
  }
  return {
    dark, paper: style.paper, panel, ground, text, muted: mix(text, ground, 0.42), accent, second,
    node: custom.node ?? node, border: custom.border ?? border, line: custom.line ?? line, frame,
    // One chosen node color replaces the turn of pens: the user asked for that color.
    pens: custom.node && (isSketchLook(look) || look === 'color') ? [custom.node] : pens,
    grid: look === 'scifi' ? mix(ground, accent, 0.09) : look === 'ink' ? mix(ground, dark ? '#9fb4c8' : '#6f8fb0', 0.2) : null,
  }
}

type Swatch = { fill: string; border: string }
type Ground = Pick<ReadingStyle, 'paper' | 'text' | 'dark' | 'tableLine'>

/** Pastel fills and their strokes, pulled toward the ground so they read as printed on it. */
function swatches(style: Ground, hues: readonly number[], saturation: number, harmony: number): Swatch[] {
  return hues.map((hue) => {
    const fill = style.dark ? fromHsl(hue, saturation * 0.7, 0.3) : fromHsl(hue, saturation, 0.84)
    const border = style.dark ? fromHsl(hue, saturation, 0.66) : fromHsl(hue, saturation * 0.9, 0.4)
    return { fill: mix(fill, style.paper, harmony), border: mix(border, style.text, 0.15) }
  })
}

/** Twelve hues, starting from the accent so a warm scheme gets a warm set. */
function accentHues(accent: string): number[] {
  const [hue] = toHsl(accent)
  return [0, 40, -40, 80, -80, 160, 120, -120, 20, -20, 60, -60].map((step) => hue + step)
}
const brightHues = [212, 150, 36, 350, 268, 186, 18, 96, 232, 320, 58, 166]

function shared(style: Ground, line: string, font: string): Record<string, unknown> {
  return {
    darkMode: style.dark, background: style.paper, fontFamily: font,
    primaryTextColor: style.text, secondaryTextColor: style.text, tertiaryTextColor: style.text, textColor: style.text, nodeTextColor: style.text,
    titleColor: style.text, actorTextColor: style.text, labelTextColor: style.text, loopTextColor: style.text, signalTextColor: style.text, classText: style.text,
    lineColor: line, defaultLinkColor: line, signalColor: line, arrowheadColor: line, actorLineColor: mix(line, style.paper, 0.35), transitionColor: line,
    edgeLabelBackground: style.paper, labelBackgroundColor: style.paper, relationLabelBackground: style.paper, relationColor: line,
    pieTitleTextColor: style.text, pieSectionTextColor: style.text, pieLegendTextColor: style.text,
    pieTitleTextSize: '18px', pieSectionTextSize: '14px', pieLegendTextSize: '14px',
    pieStrokeColor: style.paper, pieStrokeWidth: '2px', pieOuterStrokeColor: mix(line, style.paper, 0.4), pieOuterStrokeWidth: '1px', pieOpacity: '1',
    gridColor: mix(style.text, style.paper, 0.82),
  }
}

function filled(style: Ground, set: Swatch[], node: Swatch, line: string, font: string): Record<string, unknown> {
  const pies = Object.fromEntries(set.map((swatch, index) => [`pie${index + 1}`, mix(swatch.fill, swatch.border, style.dark ? 0.35 : 0.3)]))
  const note = swatches(style, [48], 0.7, 0.35)[0]
  return {
    ...shared(style, line, font), ...pies,
    primaryColor: node.fill, primaryBorderColor: node.border, mainBkg: node.fill, nodeBorder: node.border,
    secondaryColor: set[1].fill, secondaryBorderColor: set[1].border, tertiaryColor: mix(style.paper, style.text, 0.04), tertiaryBorderColor: style.tableLine,
    clusterBkg: mix(style.paper, style.text, style.dark ? 0.06 : 0.035), clusterBorder: mix(style.text, style.paper, 0.7),
    actorBkg: node.fill, actorBorder: node.border, labelBoxBkgColor: node.fill, labelBoxBorderColor: node.border,
    activationBkgColor: set[1].fill, activationBorderColor: set[1].border,
    noteBkgColor: note.fill, noteBorderColor: note.border, noteTextColor: style.text,
    xyChart: { plotColorPalette: set.map((swatch) => swatch.border).join(',') },
  }
}

/** Mermaid's base theme variables for a reading style, a look and the color options. */
export function diagramVariables(styleId: string, look: DiagramLook = defaultDiagramOptions.look, given: Partial<DiagramOptions> = {}): Record<string, unknown> {
  const options = diagramOptions({ ...given, look }), tone = diagramTone(styleId, options)
  const style: Ground = { paper: tone.ground, text: tone.text, dark: tone.dark, tableLine: mix(tone.text, tone.ground, 0.8) }
  const font = diagramFontFamily(look, options.font)
  const set = swatches(style, look === 'color' || isSketchLook(look) ? brightHues : accentHues(tone.accent), look === 'color' ? 0.62 : isSketchLook(look) ? 0.7 : 0.38, look === 'color' ? 0.22 : isSketchLook(look) ? 0.12 : 0.4)
  const node: Swatch = look === 'color' && !tone.node ? set[0] : { fill: tone.node || set[0].fill, border: tone.border || set[0].border }
  // The hands are small on the body for their size: set larger, they read as large as the document's own font.
  const written = options.font === 'auto' ? lookDefaults[look].font : options.font
  const base = { ...filled(style, set, node, tone.line, font), fontSize: written === 'longcang' ? '20px' : written === 'mashan' ? '18px' : '16px' }
  const outlined = { secondaryBorderColor: tone.border, activationBorderColor: tone.border, noteBorderColor: tone.border, pieStrokeColor: tone.border, pieStrokeWidth: '1.4px', pieOuterStrokeColor: tone.border, pieOuterStrokeWidth: '1.4px' }
  switch (look) {
    case 'ink': {
      const pies = pieColors((index) => mix(style.paper, style.text, 0.12 + (index % 6) * 0.13))
      return {
        ...base, ...pies, ...outlined,
        secondaryColor: tone.node, tertiaryColor: tone.node, tertiaryBorderColor: tone.border,
        clusterBkg: style.paper, clusterBorder: tone.frame,
        activationBkgColor: mix(style.paper, style.text, 0.08),
        noteBkgColor: style.paper, noteBorderColor: tone.border, pieStrokeWidth: '2px', pieOuterStrokeWidth: '1.5px',
        xyChart: { plotColorPalette: [0.85, 0.6, 0.4, 0.25].map((amount) => mix(style.paper, style.text, amount)).join(',') },
      }
    }
    case 'pencil':
      return { ...base, ...outlined, secondaryColor: tone.node, clusterBkg: style.paper, clusterBorder: tone.frame, noteBkgColor: style.paper, activationBkgColor: mix(style.paper, style.text, 0.08) }
    case 'chalk':
      return { ...base, ...outlined, secondaryColor: tone.node, clusterBkg: style.paper, clusterBorder: tone.frame, noteBkgColor: style.paper, activationBkgColor: style.paper, edgeLabelBackground: style.paper }
    case 'hand':
      return { ...base, ...outlined, clusterBkg: style.paper, clusterBorder: tone.frame }
    case 'program':
      return {
        ...base, secondaryColor: mix(tone.ground, tone.accent, 0.1), secondaryBorderColor: tone.accent,
        clusterBkg: style.paper, clusterBorder: tone.frame, noteBkgColor: mix(tone.ground, tone.accent, 0.1), noteBorderColor: tone.accent,
        actorLineColor: mix(tone.line, tone.ground, 0.4),
      }
    case 'scifi':
      return {
        ...base, secondaryColor: mix(tone.ground, tone.second, 0.12), secondaryBorderColor: tone.second,
        clusterBkg: mix(tone.ground, tone.accent, 0.04), clusterBorder: tone.frame,
        noteBkgColor: mix(tone.ground, tone.second, 0.12), noteBorderColor: tone.second, actorLineColor: mix(tone.accent, tone.ground, 0.5),
        ...pieColors((index) => mix(tone.ground, fromHsl(toHsl(tone.accent)[0] + index * 47, 0.9, 0.6), 0.75)),
        pieStrokeColor: tone.ground, pieOuterStrokeColor: tone.accent,
      }
    default:
      return base
  }
}

/** Shapes of nodes in the diagrams Mermaid draws; corners and outlines are set on these. */
const NODE = '.node rect, .node polygon, .node circle, .node ellipse, .node path, rect.actor, .classGroup rect, g.classGroup line, .statediagram-state rect, rect.note, .er.entityBox'
const ROUND_NODE = '.node rect, rect.actor, .classGroup rect, .statediagram-state rect, rect.note'
/** Mermaid's twelve pie colors, `pie1` to `pie12`, each from its place in the round. */
const pieColors = (color: (index: number) => string) => Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`pie${index + 1}`, color(index)]))
/** Edges drawn plain, which the edge pattern applies to. Edges the diagram itself draws dashed or dotted keep their pattern. */
const PLAIN_EDGE = '.flowchart-link.edge-pattern-solid, .messageLine0, .relation:not(.dashed-line):not(.dotted-line), .transition, .er.relationshipLine'
const EDGE = '.flowchart-link, .messageLine0, .messageLine1, .relation, .transition, .er.relationshipLine'
const LABEL = '.nodeLabel, .label text, .actor tspan, .classTitle, .cluster-label text, .messageText, .noteText'
/** Edge labels keep a solid background, so the line they sit on does not run through the words. */
const OPAQUE_EDGE_LABELS = '.edgeLabel rect,.edgeLabel .label rect{opacity:1}'

function lookCss(tone: DiagramTone, look: DiagramLook): string {
  switch (look) {
    case 'page': return `${ROUND_NODE}{rx:5px;ry:5px}${EDGE}{stroke-width:1.2px}`
    case 'color': return `${ROUND_NODE}{rx:10px;ry:10px}${NODE}{stroke-width:1.7px}${EDGE}{stroke-width:1.7px}.cluster rect{rx:14px;ry:14px;stroke-width:1.5px;stroke-dasharray:6 5}${OPAQUE_EDGE_LABELS}${LABEL}{font-weight:600}`
    case 'ink': return `${ROUND_NODE}{rx:9px;ry:9px}${NODE}{stroke-width:2.2px}${EDGE}{stroke-width:1.7px}.actor-line{stroke-width:1.2px}.cluster rect{rx:12px;ry:12px;stroke-dasharray:6 5;stroke-width:1.4px}${OPAQUE_EDGE_LABELS}${LABEL}{font-weight:700}`
    // One pen stroke: `sketch.ts` reads these widths back.
    case 'hand': return `${ROUND_NODE}{rx:9px;ry:9px}${NODE}{stroke-width:2px}${EDGE}{stroke-width:1.8px}.actor-line{stroke-width:1.3px}.cluster rect{rx:14px;ry:14px;stroke-dasharray:2 7;stroke-linecap:round;stroke-width:2.2px}${OPAQUE_EDGE_LABELS}`
    case 'pencil': return `${ROUND_NODE}{rx:3px;ry:3px}${NODE}{stroke-width:1.1px}${EDGE}{stroke-width:1.1px}.actor-line{stroke-width:0.9px}.cluster rect{rx:4px;ry:4px;stroke-dasharray:7 5;stroke-width:1px}${OPAQUE_EDGE_LABELS}`
    case 'chalk': return `${ROUND_NODE}{rx:8px;ry:8px}${NODE}{stroke-width:2.4px}${EDGE}{stroke-width:2.2px}.actor-line{stroke-width:1.6px}.cluster rect{rx:12px;ry:12px;stroke-dasharray:10 9;stroke-width:2px}${OPAQUE_EDGE_LABELS}${LABEL}{letter-spacing:0.02em}`
    // Cards on a sheet: `dress.ts` finishes the frames, the accent edges and the dark blocks.
    case 'program': return `${ROUND_NODE}{rx:7px;ry:7px}${NODE}{stroke-width:1px}${EDGE}{stroke-width:1.4px}.cluster rect{rx:11px;ry:11px;stroke-dasharray:5 4;stroke-width:1.3px;fill:none}`
      + `.cluster-label text{font-weight:700;font-size:15px}${OPAQUE_EDGE_LABELS}.nodeLabel,.label text{font-weight:500}`
    case 'scifi': {
      const glow = `drop-shadow(0 0 2px ${tone.accent}) drop-shadow(0 0 7px ${tone.accent}a0)`
      return `${NODE}{stroke-width:1.4px}${EDGE}{stroke-width:1.5px;filter:${glow}}`
        + `.cluster rect{stroke-width:1px;stroke-dasharray:1 6;stroke-linecap:round}.arrowheadPath,.marker,marker path{fill:${tone.accent}!important;stroke:${tone.accent}!important}`
        + `${LABEL}{font-weight:600;letter-spacing:0.08em;filter:drop-shadow(0 0 3px ${tone.accent}90)}.cluster-label text{font-size:12px;letter-spacing:0.18em}${OPAQUE_EDGE_LABELS}.edgeLabel text{fill:${tone.second};font-size:12px}`
        + `.actor-line{stroke-dasharray:2 5}.messageText,.noteText{fill:${tone.text}}`
    }
  }
}

function lineCss(line: Exclude<DiagramLine, 'auto'>): string {
  if (line === 'dashed') return `${PLAIN_EDGE}{stroke-dasharray:7 4!important}`
  if (line === 'dotted') return `${PLAIN_EDGE}{stroke-dasharray:0.5 4.5!important;stroke-linecap:round!important;stroke-width:2px!important}`
  return `${PLAIN_EDGE}{stroke-dasharray:none!important}`
}

/** Whether a diagram's source lays it out left to right (or right to left). */
const horizontal = /^\s*(?:(?:flowchart|graph)\s+|direction\s+)(?:LR|RL)\b/im

/**
 * Mermaid's `step` turns at the middle of each segment, which leaves a straight vertical edge with a
 * zero-length last piece and its arrowhead pointing sideways. Angular edges therefore turn first and run
 * into the node along the layout's direction: across in a left-to-right diagram, down in a top-down one.
 */
function mermaidCurve(curve: Exclude<DiagramCurve, 'auto'>, source: string): 'basis' | 'stepBefore' | 'stepAfter' | 'linear' {
  if (curve === 'curved') return 'basis'
  // Class and entity diagrams pull their arrowheads back along a straight last piece; on a step they float off the line.
  if (curve === 'straight' || /^\s*(?:classDiagram|erDiagram)/m.test(source)) return 'linear'
  return horizontal.test(source) ? 'stepBefore' : 'stepAfter'
}

/** What is done to the diagram after Mermaid has drawn it. */
export type DiagramPass = 'none' | 'sketch' | 'cards' | 'console' | 'colors'

/** The Mermaid settings for a style, the diagram options and the diagram's source, besides the theme variables. */
export function diagramConfig(styleId: string, given: Partial<DiagramOptions>, source = ''): { look: 'classic'; pass: DiagramPass; fontFamily: string; themeCSS: string; curve: 'basis' | 'stepBefore' | 'stepAfter' | 'linear' } {
  const options = diagramOptions(given), tone = diagramTone(styleId, options)
  const custom = options.colors === 'custom' && options.custom.text ? `${LABEL}{fill:${options.custom.text}}` : ''
  return {
    // Mermaid always draws the plain diagram; the other looks are made from it afterwards.
    look: 'classic',
    pass: isSketchLook(options.look) ? 'sketch' : options.look === 'program' ? 'cards' : options.look === 'scifi' ? 'console' : options.look === 'color' ? 'colors' : 'none',
    fontFamily: diagramFontFamily(options.look, options.font),
    // A node of bare text keeps an unseen box, which the looks' stroke widths would otherwise bring out.
    themeCSS: lookCss(tone, options.look) + lineCss(resolvedLine(options.look, options.line)) + custom + '.node rect.text{stroke:none!important;fill:none!important}',
    curve: mermaidCurve(resolvedCurve(options.look, options.curve), source),
  }
}

/** How the hand-drawn looks hold the pen; `sketch.ts` draws by these. */
export type SketchHand = {
  /** How far strokes stray, 1 being a steady freehand line. */
  roughness: number
  /** Whether an outline is gone over twice. */
  twice: boolean
  fill: Exclude<DiagramFill, 'auto'>
  /** Whether a node's outline, not its fill, takes the node's pen: chalk draws in color and leaves the board bare. */
  coloredOutline: boolean
  /** The texture of the tool. */
  grain: 'none' | 'pencil' | 'chalk'
  hatchGap: number
  hatchWeight: number
  /** A second, thin line inside the outline of a box, as a pen rules a frame. */
  inner: boolean
  /** Arrowheads inked in rather than left as two strokes. */
  solidArrows: boolean
  /** How far a line strays from straight and a corner from its place, in pixels: nothing drawn by hand is ruled. */
  wobble: number
  /** How far each side of a box runs past its corners, for a hand that draws the sides one by one. */
  overshoot: number
}

/** The colors and the hand the sketch pass (`sketch.ts`) draws with, besides what Mermaid's variables already carry. */
export function handPalette(styleId: string, given: Partial<DiagramOptions> = { look: 'hand' }): { fills: string[]; frames: string[]; plain: string; paper: string; hand: SketchHand } {
  const options = diagramOptions({ look: 'hand', ...given }), tone = diagramTone(styleId, options)
  const look = isSketchLook(options.look) ? options.look : 'hand'
  const fill = resolvedFill(look, options.fill)
  const [hue] = toHsl(tone.accent)
  const hand: SketchHand = look === 'pencil' ? { roughness: 1.5, twice: true, fill, coloredOutline: false, grain: 'pencil', hatchGap: 6.5, hatchWeight: 0.5, inner: false, solidArrows: false, wobble: 1.5, overshoot: 4.5 }
    : look === 'chalk' ? { roughness: 1.15, twice: true, fill, coloredOutline: true, grain: 'chalk', hatchGap: 7, hatchWeight: 1.6, inner: false, solidArrows: false, wobble: 2, overshoot: 0 }
    : look === 'ink' ? { roughness: 0.6, twice: false, fill, coloredOutline: false, grain: 'none', hatchGap: 3.6, hatchWeight: 0.7, inner: true, solidArrows: true, wobble: 1.5, overshoot: 0 }
    : { roughness: 0.85, twice: false, fill, coloredOutline: false, grain: 'none', hatchGap: 6, hatchWeight: 1.1, inner: false, solidArrows: false, wobble: 1.9, overshoot: 0 }
  return {
    fills: tone.pens,
    // A frame keeps its hue as far as the ground lets it be seen; on a mid-tone paper such as kraft it moves toward the ink.
    frames: look === 'pencil' || look === 'ink' ? [tone.frame] : look === 'chalk' ? tone.pens.slice().reverse() : [150, 350, 212, 36, 268].map((step) => {
      const pen = tone.dark ? fromHsl(hue + step, 0.5, 0.62) : fromHsl(hue + step, 0.6, 0.36)
      return [0.1, 0.25, 0.4, 0.55, 0.7].map((ink) => mix(pen, tone.text, ink)).find((color) => contrast(color, tone.ground) >= 3) ?? tone.text
    }),
    plain: String(diagramVariables(styleId, look, options).primaryColor),
    paper: tone.ground,
    hand,
  }
}
