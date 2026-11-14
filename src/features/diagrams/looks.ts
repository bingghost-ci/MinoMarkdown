import { fromHsl, mix, toHsl } from '../reading/color'
import { INTER_FAMILY, KAI_FAMILY, MONO_FAMILY } from '../reading/fonts'
import { readingStyle, type ReadingStyle } from '../reading/styles'

/**
 * How Mermaid diagrams are drawn. A look decides the drawing — font, stroke width, corners, glow, how edges
 * run and whether they are dashed — and takes every color from the reading style, so a diagram sits on the
 * page the way text does and changes with it. Edges can also be set apart from the look: their pattern
 * (`DiagramLine`) and their route (`DiagramCurve`).
 * This module does not import Mermaid, so the settings dialog can list the looks without loading it.
 */
export const diagramLooks = ['page', 'hand', 'program', 'scifi', 'ink', 'color'] as const
export type DiagramLook = (typeof diagramLooks)[number]
export const diagramLines = ['auto', 'solid', 'dashed', 'dotted'] as const
export type DiagramLine = (typeof diagramLines)[number]
export const diagramCurves = ['auto', 'curved', 'angular', 'straight'] as const
export type DiagramCurve = (typeof diagramCurves)[number]
export type DiagramOptions = { look: DiagramLook; line: DiagramLine; curve: DiagramCurve }
export const defaultDiagramOptions: DiagramOptions = { look: 'page', line: 'auto', curve: 'auto' }

/** Names and notes for the settings dialog, in Chinese; `i18n.ts` translates them. */
export const diagramLookLabels: Record<DiagramLook, { name: string; note: string }> = {
  page: { name: '纸面', note: '节点染上纸张的强调色，圆角、曲线，安静地印在纸上' },
  hand: { name: '手绘', note: '铅笔草图：抖动的笔画、斜线填充、手写字体' },
  program: { name: '程序', note: '工程图：等宽字体、直角方框、粗线、横平竖直的折线' },
  scifi: { name: '科幻', note: '全息界面：强调色描边并发光、半透明节点、虚线数据流' },
  ink: { name: '线描', note: '只有墨线，不填色，像书里的插图' },
  color: { name: '彩色', note: '柔和的多色色块，颜色向纸色靠拢' },
}
export const diagramLineLabels: Record<DiagramLine, string> = { auto: '随风格', solid: '实线', dashed: '虚线', dotted: '点线' }
export const diagramCurveLabels: Record<DiagramCurve, string> = { auto: '随风格', curved: '曲线', angular: '折线', straight: '直线' }

const isOneOf = <T extends string>(list: readonly T[]) => (value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)
export const isDiagramLook = isOneOf(diagramLooks)
export const isDiagramLine = isOneOf(diagramLines)
export const isDiagramCurve = isOneOf(diagramCurves)

/** A style and the diagram options together; drawn diagrams and the cache are keyed by it. */
export function diagramKey(styleId: string, options: Partial<Record<keyof DiagramOptions, unknown>> = {}): string {
  const look = isDiagramLook(options.look) ? options.look : defaultDiagramOptions.look
  const line = isDiagramLine(options.line) ? options.line : 'auto'
  const curve = isDiagramCurve(options.curve) ? options.curve : 'auto'
  return `${styleId}:${look}:${line}:${curve}`
}

/** Reads `diagramKey`; a bare style ID means that style with the default options. */
export function parseDiagramKey(key: string): { styleId: string } & DiagramOptions {
  const [styleId, look, line, curve] = key.split(':')
  return {
    styleId: styleId || 'white',
    look: isDiagramLook(look) ? look : defaultDiagramOptions.look,
    line: isDiagramLine(line) ? line : 'auto',
    curve: isDiagramCurve(curve) ? curve : 'auto',
  }
}

/** What `auto` means for each look. */
const lookDefaults: Record<DiagramLook, { line: Exclude<DiagramLine, 'auto'>; curve: Exclude<DiagramCurve, 'auto'> }> = {
  page: { line: 'solid', curve: 'curved' },
  hand: { line: 'solid', curve: 'curved' },
  program: { line: 'solid', curve: 'angular' },
  scifi: { line: 'dashed', curve: 'straight' },
  ink: { line: 'solid', curve: 'curved' },
  color: { line: 'solid', curve: 'curved' },
}
export function resolvedLine(look: DiagramLook, line: DiagramLine): Exclude<DiagramLine, 'auto'> { return line === 'auto' ? lookDefaults[look].line : line }
export function resolvedCurve(look: DiagramLook, curve: DiagramCurve): Exclude<DiagramCurve, 'auto'> { return curve === 'auto' ? lookDefaults[look].curve : curve }

/** Fonts the looks draw labels in; `inherit` is the document's own. Mermaid measures labels in them, so they are loaded first. */
export const diagramFonts: Record<DiagramLook, string> = {
  page: 'inherit',
  hand: `'${KAI_FAMILY}', 'Kaiti SC', cursive`,
  program: `'${MONO_FAMILY}', 'PingFang SC', monospace`,
  scifi: `'${INTER_FAMILY}', 'PingFang SC', sans-serif`,
  ink: 'inherit',
  color: 'inherit',
}

type Swatch = { fill: string; border: string }

/** Pastel fills and their strokes, pulled toward the paper so they read as printed on it. */
function swatches(style: ReadingStyle, hues: readonly number[], saturation: number, harmony: number): Swatch[] {
  return hues.map((hue) => {
    const fill = style.dark ? fromHsl(hue, saturation * 0.7, 0.3) : fromHsl(hue, saturation, 0.84)
    const border = style.dark ? fromHsl(hue, saturation, 0.66) : fromHsl(hue, saturation * 0.9, 0.4)
    return { fill: mix(fill, style.paper, harmony), border: mix(border, style.text, 0.15) }
  })
}

/** Twelve hues, starting from the style's accent so a warm paper gets a warm set. */
function accentHues(style: ReadingStyle): number[] {
  const [hue] = toHsl(style.link)
  return [0, 40, -40, 80, -80, 160, 120, -120, 20, -20, 60, -60].map((step) => hue + step)
}
const brightHues = [212, 150, 36, 350, 268, 186, 18, 96, 232, 320, 58, 166]

function shared(style: ReadingStyle, line: string, font: string): Record<string, unknown> {
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

function filled(style: ReadingStyle, set: Swatch[], node: Swatch, line: string, font: string): Record<string, unknown> {
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

/** Mermaid's base theme variables for a reading style and a look. */
export function diagramVariables(styleId: string, look: DiagramLook = defaultDiagramOptions.look): Record<string, unknown> {
  const style = readingStyle(styleId)
  const font = diagramFonts[look]
  const line = mix(style.text, style.paper, 0.25)
  if (look === 'ink') {
    const ink = mix(style.text, style.paper, 0.12)
    const pies = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`pie${index + 1}`, mix(style.paper, style.text, 0.12 + (index % 6) * 0.13)]))
    return {
      ...shared(style, ink, font), ...pies,
      primaryColor: style.paper, primaryBorderColor: ink, mainBkg: style.paper, nodeBorder: ink,
      secondaryColor: style.paper, secondaryBorderColor: ink, tertiaryColor: style.paper, tertiaryBorderColor: ink,
      clusterBkg: style.paper, clusterBorder: mix(ink, style.paper, 0.4),
      actorBkg: style.paper, actorBorder: ink, labelBoxBkgColor: style.paper, labelBoxBorderColor: ink,
      activationBkgColor: mix(style.paper, style.text, 0.08), activationBorderColor: ink,
      noteBkgColor: style.paper, noteBorderColor: mix(ink, style.paper, 0.3), noteTextColor: style.text,
      pieStrokeColor: ink, pieOuterStrokeColor: ink, pieOuterStrokeWidth: '1.5px',
      xyChart: { plotColorPalette: [0.85, 0.6, 0.4, 0.25].map((amount) => mix(style.paper, style.text, amount)).join(',') },
    }
  }
  if (look === 'color') {
    const set = swatches(style, brightHues, 0.62, 0.22)
    return filled(style, set, set[0], line, font)
  }
  const set = swatches(style, accentHues(style), 0.38, 0.4)
  if (look === 'scifi') {
    // Thin accent outlines over a faint tint of the accent: the nodes look lit rather than printed.
    const glow = style.link
    const node = { fill: mix(style.paper, glow, style.dark ? 0.14 : 0.07), border: glow }
    return {
      ...filled(style, set, node, glow, font),
      secondaryColor: mix(style.paper, glow, style.dark ? 0.22 : 0.12), secondaryBorderColor: glow,
      clusterBkg: mix(style.paper, glow, style.dark ? 0.05 : 0.025), clusterBorder: mix(glow, style.paper, 0.3),
      noteBkgColor: mix(style.paper, glow, style.dark ? 0.1 : 0.05), noteBorderColor: mix(glow, style.paper, 0.2),
      actorLineColor: mix(glow, style.paper, 0.4),
    }
  }
  if (look === 'program') {
    // A schematic: the code block's tint for nodes and the ink for every stroke.
    const ink = mix(style.text, style.paper, 0.15)
    const node = { fill: style.codeBg, border: ink }
    return { ...filled(style, set, node, ink, font), secondaryColor: mix(style.codeBg, style.link, style.dark ? 0.15 : 0.1), secondaryBorderColor: ink, clusterBorder: mix(ink, style.paper, 0.35) }
  }
  // `page` and `hand`: the accent tints the nodes and its neighbouring hues fill the charts.
  const node = { fill: mix(style.paper, style.link, style.dark ? 0.2 : 0.11), border: mix(mix(style.link, style.text, 0.4), style.paper, style.dark ? 0.3 : 0.25) }
  return filled(style, set, node, line, font)
}

/** Shapes of nodes in the diagrams Mermaid draws; corners and outlines are set on these. */
const NODE = '.node rect, .node polygon, .node circle, .node ellipse, .node path, rect.actor, .classGroup rect, g.classGroup line, .statediagram-state rect, rect.note, .er.entityBox'
const ROUND_NODE = '.node rect, rect.actor, .classGroup rect, .statediagram-state rect, rect.note'
/** Edges drawn plain, which the edge pattern applies to. Edges the diagram itself draws dashed or dotted keep their pattern. */
const PLAIN_EDGE = '.flowchart-link.edge-pattern-solid, .messageLine0, .relation:not(.dashed-line):not(.dotted-line), .transition, .er.relationshipLine'
const EDGE = '.flowchart-link, .messageLine0, .messageLine1, .relation, .transition, .er.relationshipLine'

function lookCss(style: ReadingStyle, look: DiagramLook): string {
  switch (look) {
    case 'page': return `${ROUND_NODE}{rx:5px;ry:5px}${EDGE}{stroke-width:1.2px}`
    case 'color': return `${ROUND_NODE}{rx:7px;ry:7px}${NODE}{stroke-width:1.2px}${EDGE}{stroke-width:1.3px}`
    case 'ink': return `${NODE}{stroke-width:1.2px}${EDGE}{stroke-width:1.1px}`
    case 'hand': return `${NODE},.rough-node path{stroke-width:1.4px}${EDGE}{stroke-width:1.6px;stroke-linecap:round}.cluster rect{stroke-dasharray:8 5}`
    case 'program': return `${ROUND_NODE}{rx:0!important;ry:0!important}${NODE}{stroke-width:1.6px}${EDGE}{stroke-width:1.6px}.cluster rect{rx:0!important;ry:0!important;stroke-dasharray:5 3;stroke-width:1.2px}.edgeLabel rect,.labelBkg{rx:0}`
    case 'scifi': {
      const glow = `drop-shadow(0 0 ${style.dark ? 3 : 2}px ${style.link}${style.dark ? 'cc' : '99'})`
      return `${ROUND_NODE}{rx:2px;ry:2px}${NODE}{stroke-width:1.3px;filter:${glow}}${EDGE}{stroke-width:1.3px;filter:${glow}}`
        + `.cluster rect{stroke-dasharray:2 4;stroke-width:1.2px}.arrowheadPath,.marker,marker path{fill:${style.link}!important;stroke:${style.link}!important}`
        + `.nodeLabel,.label text,.actor tspan,.classTitle{font-weight:600}`
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

/** The Mermaid settings for a style, the diagram options and the diagram's source, besides the theme variables. */
export function diagramConfig(styleId: string, options: DiagramOptions, source = ''): { look: 'classic' | 'handDrawn'; handDrawnSeed?: number; fontFamily: string; themeCSS: string; curve: 'basis' | 'stepBefore' | 'stepAfter' | 'linear' } {
  const style = readingStyle(styleId)
  return {
    look: options.look === 'hand' ? 'handDrawn' : 'classic',
    // A fixed seed draws the same strokes every time, so the cache and restyling stay stable.
    ...(options.look === 'hand' ? { handDrawnSeed: 7 } : {}),
    fontFamily: diagramFonts[options.look],
    themeCSS: lookCss(style, options.look) + lineCss(resolvedLine(options.look, options.line)),
    curve: mermaidCurve(resolvedCurve(options.look, options.curve), source),
  }
}
