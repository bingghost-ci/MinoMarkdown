import { mix } from './color'
import type { TextureId } from './textures'

/**
 * Reading styles are data. The app, the source-protected preview, HTML export and print all build their
 * CSS from these records (see `css.ts`), so a style looks the same everywhere.
 *
 * Since T61 the window around the page is a neutral gray that does not take the page's hue: the page is a
 * rounded card on a quiet desk, and a style's color shows on the page and in its accent only.
 */
export type { TextureId }
export type StyleGroup = 'plain' | 'paper' | 'eye' | 'night'
/** The Chinese font a style recommends; see `fonts.ts` for the faces behind each. */
export type StyleFont = 'song' | 'kai' | 'hei'
export type CodeTheme = 'light' | 'warm' | 'night'

export type UiColors = { sidebar: string; chrome: string; raised: string; line: string; hover: string; selected: string; accent: string; accentInk: string; danger: string }

export type ReadingStyleSource = {
  id: StyleId
  name: string
  group: StyleGroup
  dark: boolean
  paper: string
  text: string
  secondary: string
  /** The style's one accent: links, first- and second-level headings, and the selected state of controls. */
  link: string
  texture: TextureId | null
  font: StyleFont
  codeTheme: CodeTheme
  /** Large opening quote mark on block quotes. */
  quoteMark?: boolean
  /** Centered first-level headings and an ornament instead of a plain rule. */
  ornament?: boolean
  /** Darkened page edges and corners, kept off the text area; scaled by the texture strength. */
  aging?: boolean
  /** Overrides for derived colors when the derivation does not suit a style. */
  overrides?: Partial<Omit<ReadingStyle, keyof ReadingStyleSource | 'ui'>> & { ui?: Partial<UiColors> }
}

export type ReadingStyle = ReadingStyleSource & {
  /** Third-level headings and below, and table headers: the body ink, a little stronger. */
  heading: string
  /** First- and second-level headings. */
  title: string
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
  ui: UiColors
}

export const styleIds = ['white', 'mist', 'paper', 'xuan', 'parchment', 'kraft', 'mint', 'charcoal', 'dark', 'gray', 'slate', 'dusk'] as const
export type StyleId = (typeof styleIds)[number]
/** `system` follows the macOS appearance and picks the day or night style. */
export type ThemeId = StyleId | 'system'
export const themeIds: readonly ThemeId[] = ['system', ...styleIds]

/**
 * Style IDs of earlier versions (T51's fourteen styles, and T62's pure black) and the style that replaces each. `settings.rs`
 * holds the same table, so a settings file written by an older version keeps a matching look.
 */
export const legacyStyleIds: Readonly<Record<string, StyleId>> = {
  light: 'white', blueprint: 'white', newsprint: 'mist', eink: 'mist', butter: 'paper', amber: 'paper', graphite: 'dark', ink: 'charcoal', black: 'charcoal',
}

const sources: ReadingStyleSource[] = [
  { id: 'white', name: '白', group: 'plain', dark: false, paper: '#ffffff', text: '#2a2d33', secondary: '#666c76', link: '#1a6fc4', texture: null, font: 'hei', codeTheme: 'light' },
  { id: 'mist', name: '灰白', group: 'plain', dark: false, paper: '#ebecee', text: '#26282c', secondary: '#575b63', link: '#3d5570', texture: null, font: 'song', codeTheme: 'light', overrides: { desk: '#dcdde1', edge: '#d3d4d8' } },
  { id: 'paper', name: '书页', group: 'paper', dark: false, paper: '#f6efe0', text: '#2e261d', secondary: '#6a5b4a', link: '#8a4a24', texture: 'paper', font: 'song', codeTheme: 'warm', quoteMark: true },
  { id: 'xuan', name: '宣纸', group: 'paper', dark: false, paper: '#f5f3ea', text: '#211f1b', secondary: '#5f5850', link: '#a8382a', texture: 'xuan', font: 'kai', codeTheme: 'warm', quoteMark: true, ornament: true },
  { id: 'parchment', name: '羊皮卷', group: 'paper', dark: false, paper: '#ead6a8', text: '#3b2a17', secondary: '#5e4829', link: '#6f3410', texture: 'parchment', font: 'song', codeTheme: 'warm', quoteMark: true, ornament: true, aging: true },
  { id: 'kraft', name: '牛皮纸', group: 'paper', dark: false, paper: '#c9a878', text: '#2a1c0f', secondary: '#49361f', link: '#5c210b', texture: 'kraft', font: 'kai', codeTheme: 'warm' },
  { id: 'mint', name: '豆沙绿', group: 'eye', dark: false, paper: '#cce8cf', text: '#23342a', secondary: '#44584a', link: '#1d6140', texture: null, font: 'hei', codeTheme: 'light' },
  { id: 'charcoal', name: '淡黑', group: 'night', dark: true, paper: '#18191b', text: '#c8cbd0', secondary: '#9397a0', link: '#8ab4e8', texture: null, font: 'hei', codeTheme: 'night', overrides: { desk: '#111113', edge: '#27282b', ui: { sidebar: '#141416', chrome: '#17171a', raised: '#232326', line: '#28282b', hover: '#1f1f22' } } },
  { id: 'dark', name: '深灰', group: 'night', dark: true, paper: '#242427', text: '#d0d3d8', secondary: '#9a9fa8', link: '#8fc1f2', texture: null, font: 'hei', codeTheme: 'night' },
  { id: 'gray', name: '中灰', group: 'night', dark: true, paper: '#3a3c40', text: '#e3e5e9', secondary: '#b4b8bf', link: '#a3cdf6', texture: null, font: 'hei', codeTheme: 'night', overrides: { desk: '#2a2b2e', edge: '#47494e', ui: { sidebar: '#2d2e31', chrome: '#303134', raised: '#3f4044', line: '#434449', hover: '#3a3b3f' } } },
  { id: 'slate', name: '青灰', group: 'night', dark: true, paper: '#2a303a', text: '#d3d8e0', secondary: '#9fa8b5', link: '#8cc8e8', texture: null, font: 'hei', codeTheme: 'night' },
  { id: 'dusk', name: '暖灰', group: 'night', dark: true, paper: '#2e2a26', text: '#dad3c9', secondary: '#a89e91', link: '#e2b17c', texture: null, font: 'song', codeTheme: 'night' },
]

/** §4.3 (v0.4): two neutral chrome palettes. Only the accent comes from the style. */
const lightUi = { desk: '#f2f3f5', sidebar: '#f7f8fa', chrome: '#fbfbfc', raised: '#eceef1', line: '#e2e4e8', hover: '#eceef1' }
const darkUi = { desk: '#1c1c1e', sidebar: '#202022', chrome: '#232325', raised: '#303033', line: '#343437', hover: '#2c2c2f' }

function deriveUi(source: ReadingStyleSource): UiColors {
  const base = source.dark ? darkUi : lightUi
  return {
    sidebar: base.sidebar, chrome: base.chrome, raised: base.raised, line: base.line, hover: base.hover,
    selected: mix(base.raised, source.link, source.dark ? 0.2 : 0.12),
    accent: source.link,
    accentInk: source.dark ? '#16171a' : '#ffffff',
    danger: source.dark ? '#e59a8c' : '#a43737',
  }
}

function derive(source: ReadingStyleSource): ReadingStyle {
  const dark = source.dark
  const ink = mix(source.text, source.paper, 0.5)
  const { ui, ...overrides } = source.overrides ?? {}
  const style: ReadingStyle = {
    ...source,
    heading: dark ? mix(source.text, '#ffffff', 0.14) : mix(source.text, '#000000', 0.25),
    title: source.link,
    muted: mix(source.secondary, source.paper, 0.22),
    codeInk: source.link,
    codeBg: dark ? mix(source.paper, '#ffffff', 0.06) : mix(source.paper, '#000000', 0.04),
    quoteLine: mix(source.text, source.paper, 0.72),
    rule: mix(source.text, source.paper, 0.8),
    tableLine: mix(source.text, source.paper, 0.84),
    tableRule: mix(source.text, source.paper, 0.4),
    selection: mix(source.link, source.paper, dark ? 0.62 : 0.78),
    desk: dark ? darkUi.desk : lightUi.desk,
    edge: dark ? mix(source.paper, '#ffffff', 0.07) : mix(source.paper, source.text, 0.08),
    shadow: dark ? '0 1px 2px #0006, 0 12px 32px #0005' : `0 1px 2px ${ink}14, 0 10px 30px ${ink}1c`,
    imageMat: source.group === 'paper' ? 'mat' : 'line',
    ui: { ...deriveUi(source), ...ui },
  }
  return { ...style, ...overrides }
}

export const readingStyles: readonly ReadingStyle[] = sources.map(derive)
const byId = new Map(readingStyles.map((style) => [style.id, style]))

/** The current ID for a style ID of any version, or null for an unknown one. */
export function migrateStyleId(id: string): StyleId | null {
  if (byId.has(id as StyleId)) return id as StyleId
  return Object.hasOwn(legacyStyleIds, id) ? legacyStyleIds[id] : null
}

export function readingStyle(id: string): ReadingStyle {
  return byId.get(migrateStyleId(id) ?? 'white')!
}

export function isStyleId(id: string): id is StyleId {
  return byId.has(id as StyleId)
}

export const dayStyleIds = styleIds.filter((id) => !readingStyle(id).dark)
export const nightStyleIds = styleIds.filter((id) => readingStyle(id).dark)

/** The style in effect: `system` resolves to the day or night choice by the macOS appearance. */
export function resolveStyleId(theme: string, dayTheme: string, nightTheme: string, systemDark: boolean): StyleId {
  const id = theme === 'system' ? (systemDark ? nightTheme : dayTheme) : theme
  return migrateStyleId(id) ?? (systemDark ? 'dark' : 'white')
}
