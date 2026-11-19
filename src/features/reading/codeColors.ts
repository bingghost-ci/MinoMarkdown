import { contrast, fromHsl, toHsl } from './color'
import type { SyntaxRole } from '../../core/markdown/syntaxRoleNames'
import type { CodeTheme, ReadingStyle } from './styles'

/**
 * Code color schemes (T110). `auto` is Mino's own set for the paper, `quiet` takes every color from the reading
 * style, and the others follow well-known editor palettes, each with a day and a night half. A scheme never
 * changes the code background: its colors are fitted to the style's, so any scheme stays readable on any paper.
 * `custom` is the user's own choice per role (T111), one set for day styles and one for night styles; a role
 * not chosen yet shows as in `auto`, and a chosen color is used exactly as picked.
 * `settings.rs` keeps the same list of IDs.
 */
export const codeColorIds = ['auto', 'quiet', 'github', 'one', 'solarized', 'gruvbox', 'tokyo', 'custom'] as const
export type CodeColors = (typeof codeColorIds)[number]
export type SyntaxPalette = Record<SyntaxRole, string>

export const codeColorLabels: Record<CodeColors, { name: string; note: string }> = {
  auto: { name: '随风格', note: '按纸张配好的一套：紫色关键字、红色字符串、蓝色定义' },
  quiet: { name: '素墨', note: '只用纸张的墨色和强调色，代码不抢正文的注意力' },
  github: { name: 'GitHub', note: '红色关键字、深蓝字符串、紫色函数' },
  one: { name: 'One', note: 'Atom 的配色：绿色字符串、蓝色函数、红色变量' },
  solarized: { name: 'Solarized', note: '柔和的低对比配色：绿色关键字、青色字符串' },
  gruvbox: { name: 'Gruvbox', note: '复古暖色：红色关键字、绿色字符串、蓝色变量' },
  tokyo: { name: 'Tokyo Night', note: '偏冷的蓝紫色调' },
  custom: { name: '自定义', note: '每种记号的颜色自己选；白天和夜间的风格各记一套' },
}

export function isCodeColors(id: unknown): id is CodeColors {
  return typeof id === 'string' && (codeColorIds as readonly string[]).includes(id)
}

/**
 * Mino's own sets spread the roles over the hue circle so neighbors in code differ: purple keywords, red strings,
 * green numbers, blue definitions, ochre calls, slate variables, teal properties. `deep` is for kraft paper, whose
 * code background is too dark for the `warm` set.
 */
const ownPalettes: Record<CodeTheme, SyntaxPalette> = {
  light: { keyword: '#8a2f9e', operator: '#5a6270', atom: '#4a44c4', number: '#4d6b0a', string: '#a2302a', definition: '#0b4fae', function: '#855000', variable: '#2f5a7d', property: '#0d6a6f', type: '#0a6b52', comment: '#6a6f78', meta: '#8a5a00', invalid: '#c0392b', heading: '#0b4fae' },
  warm: { keyword: '#7a2a7a', operator: '#6a5a48', atom: '#3f4a9e', number: '#506000', string: '#a0321a', definition: '#1f4f8a', function: '#7d4a00', variable: '#2c5a70', property: '#16645a', type: '#3d6626', comment: '#7a6a52', meta: '#8a5a00', invalid: '#b03a2e', heading: '#1f4f8a' },
  deep: { keyword: '#5a1560', operator: '#4a3a28', atom: '#262f78', number: '#334000', string: '#741a08', definition: '#0f3566', function: '#5a3000', variable: '#173f52', property: '#0a463e', type: '#244a12', comment: '#5a4a34', meta: '#5c3a00', invalid: '#8a1a10', heading: '#0f3566' },
  night: { keyword: '#d7a8e8', operator: '#a9b0bb', atom: '#b4b2f8', number: '#b5d08e', string: '#e8a48a', definition: '#7fbaff', function: '#e3c986', variable: '#a9cbe6', property: '#8fd4cf', type: '#8fd6b6', comment: '#9a9fa8', meta: '#e3c27a', invalid: '#ff8f80', heading: '#7fbaff' },
}

const named: Record<Exclude<CodeColors, 'auto' | 'quiet' | 'custom'>, { day: SyntaxPalette; night: SyntaxPalette }> = {
  github: {
    day: { keyword: '#cf222e', operator: '#0550ae', atom: '#0550ae', number: '#0550ae', string: '#0a3069', definition: '#953800', function: '#8250df', variable: '#24292f', property: '#0550ae', type: '#953800', comment: '#6e7781', meta: '#8250df', invalid: '#82071e', heading: '#0550ae' },
    night: { keyword: '#ff7b72', operator: '#79c0ff', atom: '#79c0ff', number: '#79c0ff', string: '#a5d6ff', definition: '#ffa657', function: '#d2a8ff', variable: '#c9d1d9', property: '#79c0ff', type: '#ffa657', comment: '#8b949e', meta: '#d2a8ff', invalid: '#ffa198', heading: '#79c0ff' },
  },
  one: {
    day: { keyword: '#a626a4', operator: '#0184bc', atom: '#986801', number: '#986801', string: '#50a14f', definition: '#4078f2', function: '#4078f2', variable: '#e45649', property: '#e45649', type: '#c18401', comment: '#a0a1a7', meta: '#a626a4', invalid: '#ca1243', heading: '#4078f2' },
    night: { keyword: '#c678dd', operator: '#56b6c2', atom: '#d19a66', number: '#d19a66', string: '#98c379', definition: '#61afef', function: '#61afef', variable: '#e06c75', property: '#e06c75', type: '#e5c07b', comment: '#7f848e', meta: '#c678dd', invalid: '#f44747', heading: '#61afef' },
  },
  solarized: {
    day: { keyword: '#859900', operator: '#859900', atom: '#cb4b16', number: '#d33682', string: '#2aa198', definition: '#268bd2', function: '#268bd2', variable: '#657b83', property: '#6c71c4', type: '#b58900', comment: '#93a1a1', meta: '#cb4b16', invalid: '#dc322f', heading: '#268bd2' },
    night: { keyword: '#859900', operator: '#859900', atom: '#cb4b16', number: '#d33682', string: '#2aa198', definition: '#268bd2', function: '#268bd2', variable: '#93a1a1', property: '#6c71c4', type: '#b58900', comment: '#657b83', meta: '#cb4b16', invalid: '#dc322f', heading: '#268bd2' },
  },
  gruvbox: {
    day: { keyword: '#9d0006', operator: '#af3a03', atom: '#8f3f71', number: '#8f3f71', string: '#79740e', definition: '#b57614', function: '#427b58', variable: '#076678', property: '#076678', type: '#b57614', comment: '#928374', meta: '#af3a03', invalid: '#cc241d', heading: '#b57614' },
    night: { keyword: '#fb4934', operator: '#fe8019', atom: '#d3869b', number: '#d3869b', string: '#b8bb26', definition: '#fabd2f', function: '#8ec07c', variable: '#83a598', property: '#83a598', type: '#fabd2f', comment: '#928374', meta: '#fe8019', invalid: '#fb4934', heading: '#fabd2f' },
  },
  tokyo: {
    day: { keyword: '#7847bd', operator: '#006a83', atom: '#b15c00', number: '#b15c00', string: '#587539', definition: '#2e7de9', function: '#2e7de9', variable: '#3760bf', property: '#387068', type: '#007197', comment: '#848cb5', meta: '#8c6c3e', invalid: '#f52a65', heading: '#2e7de9' },
    night: { keyword: '#bb9af7', operator: '#89ddff', atom: '#ff9e64', number: '#ff9e64', string: '#9ece6a', definition: '#7aa2f7', function: '#7aa2f7', variable: '#c0caf5', property: '#73daca', type: '#2ac3de', comment: '#737aa2', meta: '#e0af68', invalid: '#f7768e', heading: '#7aa2f7' },
  },
}

/** Ink and accent only: structure in the heading ink, literals in the style's accent, comments faded. */
function quietPalette(style: ReadingStyle): SyntaxPalette {
  const { text, heading, link, muted, secondary } = style
  return { keyword: heading, operator: secondary, atom: link, number: link, string: link, definition: heading, function: text, variable: text, property: text, type: secondary, comment: muted, meta: secondary, invalid: style.ui.danger, heading }
}

/** Least contrast with the code background: body-text level for code, a lower one for comments, which may recede. */
export const CODE_CONTRAST = 4.5
export const COMMENT_CONTRAST = 3.2

/** Moves a color's lightness away from the background, keeping its hue, until it reaches the contrast. */
function fitted(color: string, background: string, dark: boolean, least: number): string {
  if (contrast(color, background) >= least) return color
  const [h, s, l] = toHsl(color)
  for (let step = 1; step <= 50; step += 1) {
    const next = fromHsl(h, s, dark ? Math.min(1, l + step * 0.02) : Math.max(0, l - step * 0.02))
    if (contrast(next, background) >= least) return next
  }
  return dark ? '#ffffff' : '#000000'
}

/** The user's colors: only the roles they changed, for day and for night styles. */
export type CustomCodeColors = { day: Partial<SyntaxPalette>; night: Partial<SyntaxPalette> }
export const noCustomCodeColors: CustomCodeColors = { day: {}, night: {} }

/** The roles in the order the settings list them, with the names shown there. */
export const syntaxRoleLabels: readonly (readonly [SyntaxRole, string])[] = [
  ['keyword', '关键字'], ['variable', '变量名'], ['function', '函数名'], ['definition', '定义的名字'], ['property', '属性名'], ['type', '类型名'], ['string', '字符串'],
  ['number', '数字'], ['atom', '常量与内置名'], ['operator', '运算符'], ['comment', '注释'], ['meta', '修饰与标注'], ['heading', '标题'], ['invalid', '错误'],
]

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function chosen(custom: CustomCodeColors | undefined, dark: boolean): Partial<SyntaxPalette> {
  const half = (dark ? custom?.night : custom?.day) ?? {}
  return Object.fromEntries(Object.entries(half).filter(([role, color]) => Object.hasOwn(ownPalettes.light, role) && isHexColor(color)).map(([role, color]) => [role, color.toLowerCase()]))
}

/** The custom set with one role changed for day or night styles; `null` takes the role back to its default. */
export function withCustomColor(custom: CustomCodeColors | undefined, dark: boolean, role: SyntaxRole, color: string | null): CustomCodeColors {
  const next = { day: { ...custom?.day }, night: { ...custom?.night } }
  const half = dark ? next.night : next.day
  if (color === null) delete half[role]
  else if (isHexColor(color)) half[role] = color.toLowerCase()
  return next
}

/** The colors a scheme gives code on a reading style. An unknown scheme is `auto`. */
export function codePalette(scheme: string | undefined, style: ReadingStyle, custom?: CustomCodeColors): SyntaxPalette {
  const base = scheme === 'quiet' ? quietPalette(style)
    : scheme && Object.hasOwn(named, scheme) ? named[scheme as keyof typeof named][style.dark ? 'night' : 'day']
    : ownPalettes[style.codeTheme]
  const fit = Object.fromEntries(Object.entries(base).map(([role, color]) => [role, fitted(color, style.codeBg, style.dark, role === 'comment' ? COMMENT_CONTRAST : CODE_CONTRAST)])) as SyntaxPalette
  return scheme === 'custom' ? { ...fit, ...chosen(custom, style.dark) } : fit
}

export function syntaxVariables(scheme: string | undefined, style: ReadingStyle, custom?: CustomCodeColors): Record<string, string> {
  return Object.fromEntries(Object.entries(codePalette(scheme, style, custom)).map(([role, color]) => [`--syntax-${role}`, color]))
}
