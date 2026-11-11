import { fromHsl, mix, toHsl } from './color'

/**
 * Reading styles are data. The app, the source-protected preview, HTML export and print all build their
 * CSS from these records (see `css.ts`), so a style looks the same everywhere.
 */
export type StyleGroup = 'paper' | 'eye' | 'night' | 'other'
export type TextureId = 'paper' | 'xuan' | 'kraft' | 'parchment' | 'newsprint' | 'butter'
export type FontPresetId = 'song' | 'kai' | 'hei'
export type CodeTheme = 'light' | 'warm' | 'night'

export type ReadingStyleSource = {
  id: StyleId
  name: string
  group: StyleGroup
  dark: boolean
  paper: string
  text: string
  secondary: string
  link: string
  texture: TextureId | null
  font: FontPresetId
  codeTheme: CodeTheme
  /** Large opening quote mark on block quotes. */
  quoteMark?: boolean
  /** Centered first-level headings and an ornament instead of a plain rule. */
  ornament?: boolean
  /** Links are told apart by their underline alone. */
  monochrome?: boolean
  /** Darkened page corners, kept off the text area. */
  aging?: boolean
  /** Overrides for derived colors when the derivation does not suit a style. */
  overrides?: Partial<Omit<ReadingStyle, keyof ReadingStyleSource>>
}

export type ReadingStyle = ReadingStyleSource & {
  heading: string
  muted: string
  codeInk: string
  codeBg: string
  quoteLine: string
  rule: string
  tableLine: string
  tableRule: string
  selection: string
  desk: string
  edge: string
  shadow: string
  imageMat: 'mat' | 'line'
  ui: { sidebar: string; chrome: string; raised: string; line: string; hover: string; selected: string; accent: string; accentInk: string; danger: string }
}

export const styleIds = ['light', 'paper', 'xuan', 'kraft', 'parchment', 'newsprint', 'mint', 'butter', 'eink', 'amber', 'graphite', 'dark', 'ink', 'blueprint'] as const
export type StyleId = (typeof styleIds)[number]
/** `system` follows the macOS appearance and picks the day or night style. */
export type ThemeId = StyleId | 'system'
export const themeIds: readonly ThemeId[] = ['system', ...styleIds]

const sources: ReadingStyleSource[] = [
  { id: 'light', name: '素白', group: 'paper', dark: false, paper: '#ffffff', text: '#24292f', secondary: '#5b636c', link: '#2f5f8f', texture: null, font: 'hei', codeTheme: 'light', overrides: { desk: '#eceef1', edge: '#dde1e6' } },
  { id: 'paper', name: '书页', group: 'paper', dark: false, paper: '#f7f1e3', text: '#2e261d', secondary: '#6a5b4a', link: '#7a4e22', texture: 'paper', font: 'song', codeTheme: 'warm', quoteMark: true },
  { id: 'xuan', name: '宣纸', group: 'paper', dark: false, paper: '#f6f2e6', text: '#211f1b', secondary: '#5f5850', link: '#a23b2a', texture: 'xuan', font: 'kai', codeTheme: 'warm', quoteMark: true, ornament: true },
  { id: 'kraft', name: '牛皮纸', group: 'paper', dark: false, paper: '#dcc49c', text: '#2b1d10', secondary: '#4f3b25', link: '#6a2a10', texture: 'kraft', font: 'kai', codeTheme: 'warm' },
  { id: 'parchment', name: '羊皮卷', group: 'paper', dark: false, paper: '#f1e2bd', text: '#3a2a16', secondary: '#614a2c', link: '#7a3a14', texture: 'parchment', font: 'song', codeTheme: 'warm', quoteMark: true, ornament: true, aging: true },
  { id: 'newsprint', name: '再生纸', group: 'paper', dark: false, paper: '#ecebe5', text: '#262626', secondary: '#555550', link: '#384a5e', texture: 'newsprint', font: 'song', codeTheme: 'light' },
  { id: 'mint', name: '豆沙绿', group: 'eye', dark: false, paper: '#d4e8cf', text: '#22332a', secondary: '#45594b', link: '#2b5e3c', texture: null, font: 'hei', codeTheme: 'light' },
  { id: 'butter', name: '暖黄', group: 'eye', dark: false, paper: '#f4e8cb', text: '#3f311d', secondary: '#665536', link: '#80511a', texture: 'butter', font: 'song', codeTheme: 'warm' },
  { id: 'eink', name: '水墨屏', group: 'eye', dark: false, paper: '#f0efea', text: '#1e1e1e', secondary: '#4c4c4a', link: '#1e1e1e', texture: null, font: 'song', codeTheme: 'light', monochrome: true },
  { id: 'amber', name: '低蓝光', group: 'eye', dark: false, paper: '#f5e3bf', text: '#3b2812', secondary: '#634b2b', link: '#844813', texture: null, font: 'kai', codeTheme: 'warm' },
  { id: 'graphite', name: '夜读', group: 'night', dark: true, paper: '#26221d', text: '#d9cfbe', secondary: '#a99c86', link: '#d6a35e', texture: null, font: 'song', codeTheme: 'night' },
  { id: 'dark', name: '深色', group: 'night', dark: true, paper: '#1e1f22', text: '#d7dadf', secondary: '#9ea4ad', link: '#8fb7e3', texture: null, font: 'hei', codeTheme: 'night' },
  { id: 'ink', name: '墨黑', group: 'night', dark: true, paper: '#0e0e0e', text: '#b9b9b9', secondary: '#8a8a8a', link: '#9fb3c8', texture: null, font: 'hei', codeTheme: 'night' },
  { id: 'blueprint', name: '科技蓝白', group: 'other', dark: false, paper: '#fbfdff', text: '#172b43', secondary: '#4b647e', link: '#165ea8', texture: null, font: 'hei', codeTheme: 'light', overrides: { desk: '#e4ecf6', edge: '#d0dceb' } },
]

/** §4.3: chrome uses the page hue at under half its saturation, so the eye rests on the page. */
function deriveUi(source: ReadingStyleSource) {
  const [h, s, l] = toHsl(source.paper)
  const tone = (shift: number) => fromHsl(h, s * 0.45, l + shift)
  const accentInk = source.dark ? source.paper : '#ffffff'
  if (source.dark) {
    return { sidebar: tone(-0.02), chrome: tone(0.01), raised: tone(0.06), line: tone(0.1), hover: tone(0.08), selected: mix(tone(0.04), source.link, 0.22), accent: source.link, accentInk, danger: '#e59a8c' }
  }
  return { sidebar: tone(-0.025), chrome: tone(-0.012), raised: tone(-0.05), line: tone(-0.1), hover: tone(-0.06), selected: mix(tone(-0.03), source.link, 0.14), accent: source.link, accentInk: source.monochrome ? source.paper : accentInk, danger: source.monochrome ? '#3a3a3a' : '#a43737' }
}

function derive(source: ReadingStyleSource): ReadingStyle {
  const [h, s, l] = toHsl(source.paper)
  const dark = source.dark
  const style: ReadingStyle = {
    ...source,
    heading: dark ? mix(source.text, '#ffffff', 0.12) : mix(source.text, '#000000', 0.3),
    muted: mix(source.secondary, source.paper, 0.22),
    codeInk: source.link,
    codeBg: dark ? mix(source.paper, '#ffffff', 0.05) : mix(source.paper, '#000000', 0.04),
    quoteLine: mix(source.text, source.paper, 0.72),
    rule: mix(source.text, source.paper, 0.78),
    tableLine: mix(source.text, source.paper, 0.82),
    tableRule: mix(source.text, source.paper, 0.35),
    selection: mix(source.link, source.paper, dark ? 0.62 : 0.78),
    desk: dark ? fromHsl(h, s * 0.6, l * 0.62) : fromHsl(h, s * 0.6, l - 0.075),
    edge: mix(source.paper, source.text, dark ? 0.1 : 0.12),
    shadow: dark ? '0 1px 3px #0007, 0 10px 28px #0006' : `0 1px 2px ${mix(source.text, source.paper, 0.5)}12, 0 8px 24px ${mix(source.text, source.paper, 0.5)}14`,
    imageMat: source.group === 'paper' ? 'mat' : 'line',
    ui: deriveUi(source),
  }
  return { ...style, ...source.overrides }
}

export const readingStyles: readonly ReadingStyle[] = sources.map(derive)
const byId = new Map(readingStyles.map((style) => [style.id, style]))

export function readingStyle(id: string): ReadingStyle {
  return byId.get(id as StyleId) ?? byId.get('light')!
}

export function isStyleId(id: string): id is StyleId {
  return byId.has(id as StyleId)
}

export const dayStyleIds = styleIds.filter((id) => !readingStyle(id).dark)
export const nightStyleIds = styleIds.filter((id) => readingStyle(id).dark)

/** The style in effect: `system` resolves to the day or night choice by the macOS appearance. */
export function resolveStyleId(theme: string, dayTheme: string, nightTheme: string, systemDark: boolean): StyleId {
  const id = theme === 'system' ? (systemDark ? nightTheme : dayTheme) : theme
  return isStyleId(id) ? id : systemDark ? 'dark' : 'light'
}

export const groupLabels: Record<StyleGroup, string> = { paper: '纸张', eye: '护眼', night: '夜间', other: '其他' }
