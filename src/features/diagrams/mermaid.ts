import DOMPurify, { type DOMPurify as Purifier } from 'dompurify'
import { diagramConfig, diagramKey, diagramTone, diagramVariables, handPalette, parseCustomColorsKey, parseDiagramKey, type DiagramOptions, type DiagramPass } from './looks'

export { diagramVariables } from './looks'

/** A reading style and a diagram look, as `diagramKey` writes them; diagrams take their colors from both. */
type Theme = string
type Job = { content: string; theme: Theme; apply: (value: HTMLElement) => void; typing: boolean }

const MAX_CACHED = 200
const TYPING_DELAY_MS = 250
const cache = new Map<string, HTMLElement>()
let purifier: Purifier | null = null
let library: Promise<typeof import('mermaid').default> | null = null
let renderChain: Promise<unknown> = Promise.resolve()
let pending: Job[] = []
let timer: number | undefined
let nextDiagramId = 1

// Mermaid only loads when a document actually has a diagram.
function loadMermaid() {
  library ??= import('mermaid').then((module) => {
    // Icons for `@{ icon: "lucide:name" }` nodes, read from the app itself when a diagram first asks for one.
    // Optional, so a Mermaid without icon packs still draws everything else.
    (module.default.registerIconPacks as typeof module.default.registerIconPacks | undefined)?.([{ name: 'lucide', loader: () => import('./icons').then((icons) => icons.loadIconPack()) }])
    return module.default
  })
  return library
}

/**
 * CSS that can only point inside the SVG. Escapes are dropped first, so `\75rl(` or `@\69mport` cannot
 * spell a function the filters below would miss; then every `url()` that is not a `#fragment`, every
 * image function that takes a bare string, and every `@import` is replaced.
 */
export function localOnlyCss(css: string): string {
  return css
    .replace(/\\/g, '')
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/url\(\s*("[^"]*"|'[^']*'|[^"')]*)\s*\)/gi, (match, inner: string) => /^["']?#/.test(inner.trim()) ? match : 'none')
    // An unbalanced `url(` left over could still open a request.
    .replace(/url\(\s*(?!["']?#)/gi, 'none(')
    .replace(/\b(?:-webkit-)?(?:image-set|cross-fade|image|element|src)\s*\(/gi, 'none(')
}

/** Keeps drawing primitives and removes scripts, external references and anything that could load a remote file. */
export function sanitizeDiagramSvg(svg: string): string {
  purifier ??= DOMPurify(window)
  const root = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'use'],
    FORBID_TAGS: ['img', 'image', 'a', 'iframe', 'object', 'embed', 'video', 'audio', 'link', 'script', 'animate', 'set'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    RETURN_DOM: true,
  }) as unknown as HTMLElement
  for (const element of root.querySelectorAll('*')) {
    for (const name of ['href', 'xlink:href']) {
      const value = element.getAttribute(name)
      if (value !== null && !value.trim().startsWith('#')) element.removeAttribute(name)
    }
    // Presentation attributes (`fill`, `filter`, `mask`, `clip-path`, `marker-end`…) take CSS values too.
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'style') element.setAttribute('style', localOnlyCss(attribute.value))
      else if (attribute.value.includes('(') && localOnlyCss(attribute.value) !== attribute.value) element.removeAttribute(attribute.name)
    }
    if (element.tagName.toLowerCase() === 'style' && element.textContent) element.textContent = localOnlyCss(element.textContent)
  }
  return root.innerHTML
}

/** The style and diagram options the page shows now: `data-theme` and the `data-diagram…` attributes on `<html>`. */
export function currentDiagramKey(): Theme {
  const root = document.documentElement
  return diagramKey(root.dataset.theme ?? 'white', {
    look: root.dataset.diagram, line: root.dataset.diagramLine, curve: root.dataset.diagramCurve, fill: root.dataset.diagramFill,
    colors: root.dataset.diagramColors, font: root.dataset.diagramFont, custom: parseCustomColorsKey(root.dataset.diagramCustom),
  })
}

/**
 * Mermaid sizes boxes by measuring their labels, so a look's own font must be ready before it draws. A font
 * cut into unicode-range subsets loads only the ones the given text needs, hence the diagram's own text.
 */
async function fontReady(family: string, text: string): Promise<void> {
  if (family === 'inherit' || typeof document.fonts?.load !== 'function') return
  try { await document.fonts.load(`16px ${family}`, `图Aa${text}`) } catch { /* Drawn in the fallback font. */ }
}

/**
 * What is done to a drawn diagram in the document, where its style sheet applies and its text is laid out:
* icons are put into labels and remarks get their labels centered (T116), the hand-drawn looks redraw every
 * shape (T115), and the cards and the console are finished and given their board (T117). The SVG is put there, out of sight, while that happens.
 */
async function finished(svg: string, styleId: string, options: DiagramOptions, pass: DiagramPass, iconNames: readonly string[], remarks: ReadonlySet<string>): Promise<string> {
  const icons = await import('./icons')
  const pack = iconNames.length ? await icons.loadIconPack() : null
  const drawing = pass === 'sketch' ? await Promise.all([import('roughjs'), import('./sketch')]) : null
  const dress = await import('./dress')
  const tone = diagramTone(styleId, options)
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px;opacity:0;pointer-events:none'
  host.innerHTML = svg
  document.body.append(host)
  try {
    const root = host.querySelector('svg')
    if (root) {
      icons.centerRemarkLabels(root, remarks)
      if (pack) icons.placeLabelIcons(root, iconNames, pack)
      if (drawing) drawing[1].sketchDiagram(root, drawing[0].default.generator(), { ...handPalette(styleId, options), remarks: icons.remarkNodes(root, remarks) })
      if (pass === 'cards') dress.dressCards(root, tone)
      if (pass === 'console') dress.dressConsole(root, tone)
      if (pass === 'colors') dress.dressColors(root, tone)
      // Squared paper under the pen, a grid on the console's screen; the other boards are plain.
      dress.layBoard(root, tone, options.look === 'ink' ? 22 : options.look === 'scifi' ? 16 : 0, options.look === 'scifi')
    }
    return host.innerHTML
  } finally {
    host.remove()
  }
}

/** Mermaid keeps global state, so renders run strictly one at a time. */
function renderSvg(source: string, theme: Theme): Promise<string> {
  const result = renderChain.then(async () => {
    // A document with many diagrams draws them back to back. Giving up the thread before each one lets
    // scrolling and typing through while they fill in (T96).
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const mermaid = await loadMermaid()
    const { styleId, ...options } = parseDiagramKey(theme)
    const { curve, pass, ...config } = diagramConfig(styleId, options, source)
    await fontReady(config.fontFamily, source)
    const variables = diagramVariables(styleId, options.look, options)
    mermaid.initialize({
      ...config,
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables: variables, htmlLabels: false, flowchart: { htmlLabels: false, curve }, state: { curve } as never,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'htmlLabels'],
    })
    // `:name:` in a label is an icon; Mermaid is given a one-character place for each (T116).
    const icons = await import('./icons')
    const placed = icons.mayHoldIconTokens(source) ? icons.withIconPlaces(source, await icons.loadIconPack()) : { source, names: [] }
    const remarks = icons.remarkIds(source)
    const { svg } = await mermaid.render(`mino-mermaid-${nextDiagramId++}`, placed.source)
    const safe = sanitizeDiagramSvg(svg)
    if (pass === 'none' && !placed.names.length && !remarks.size) return safe
    // A diagram that cannot be finished is still a diagram.
    try { return await finished(safe, styleId, options, pass, placed.names, remarks) } catch { return safe }
  })
  renderChain = result.catch(() => undefined)
  return result
}

function diagramElement(svg: string): HTMLElement {
  const element = document.createElement('div')
  element.className = 'mermaid-preview'
  element.innerHTML = svg
  return element
}

function errorElement(source: string, error: unknown): HTMLElement {
  const element = document.createElement('div')
  element.className = 'mermaid-preview mermaid-error'
  const message = document.createElement('p')
  const title = document.documentElement.lang === 'en-US' ? 'Diagram syntax error' : '图表语法错误'
  message.textContent = `${title}: ${error instanceof Error ? error.message : String(error)}`
  const code = document.createElement('pre')
  code.textContent = source
  element.append(message, code)
  return element
}

/**
 * A drawn diagram carries its source and the key it was drawn with as attributes, so a change of style can
 * redraw it in place. Crepe does not show the element the preview hook returns: it serializes it, sanitizes
 * the markup and shows a copy, so the copy has to carry this itself. `data-*` survives its sanitizer, but an
 * attribute holding `-->` (every arrow) does not, so the source is stored URI-encoded.
 */
function tracked(element: HTMLElement, content: string, theme: Theme): HTMLElement {
  element.dataset.diagramSource = encodeURIComponent(content)
  element.dataset.diagramKey = theme
  return element
}

/**
 * Redraws the diagrams under `root` in the current reading style and diagram options (T56, T107). Crepe only
 * calls the preview hook when a code block changes, so a change of style updates the shown elements in place:
 * the document, the editor and its history are untouched. Diagrams with syntax errors do not depend on the style.
 */
export async function restyleDiagrams(root: ParentNode, requested: Theme = currentDiagramKey()): Promise<number> {
  // A bare style ID means that style with the default diagram options.
  const { styleId, ...options } = parseDiagramKey(requested)
  const theme = diagramKey(styleId, options)
  let redrawn = 0
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('.mermaid-preview[data-diagram-source]'))) {
    const stored = element.dataset.diagramSource ?? ''
    let content: string
    try { content = decodeURIComponent(stored) } catch { continue }
    const drawnWith = element.dataset.diagramKey
    if (drawnWith === theme) continue
    const key = `${theme}\0${content}`
    try {
      let svg = cache.get(key)?.innerHTML
      if (svg === undefined) {
        svg = await renderSvg(content, theme)
        remember(key, diagramElement(svg))
      }
      // The block may have been edited, replaced or restyled again while this diagram was drawing.
      if (element.dataset.diagramSource !== stored || element.dataset.diagramKey !== drawnWith) continue
      element.innerHTML = svg
      element.dataset.diagramKey = theme
      redrawn++
    } catch {
      // The diagram keeps its previous colors.
    }
  }
  return redrawn
}

function remember(key: string, element: HTMLElement): void {
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(key, element)
}

function flush(): void {
  const jobs = pending
  pending = []
  for (const job of jobs) {
    renderSvg(job.content, job.theme).then((svg) => {
      const element = diagramElement(svg)
      remember(`${job.theme}\0${job.content}`, element)
      job.apply(tracked(element.cloneNode(true) as HTMLElement, job.content, job.theme))
    }, (error: unknown) => job.apply(errorElement(job.content, error)))
  }
}

/** Crepe's code block preview hook. Returning `undefined` tells it the result will arrive through `apply`. */
export function renderMermaidPreview(language: string, content: string, apply: (value: HTMLElement) => void): HTMLElement | null | undefined {
  if (language.toLowerCase() !== 'mermaid' || !content.trim()) return null
  const theme = currentDiagramKey()
  const cached = cache.get(`${theme}\0${content}`)
  if (cached) return tracked(cached.cloneNode(true) as HTMLElement, content, theme)
  // Only one block can be focused, so older pending edits from typing are already out of date.
  const typing = document.activeElement?.closest('.cm-editor') != null
  if (typing) pending = pending.filter((job) => !job.typing)
  pending.push({ content, theme, apply, typing })
  window.clearTimeout(timer)
  timer = window.setTimeout(flush, typing ? TYPING_DELAY_MS : 0)
  return undefined
}

/** Exports draw diagrams in the export's style and the chosen diagram options. A diagram that fails is left out, and the page keeps its code. */
export async function renderDiagramsForExport(sources: readonly string[], styleId = 'white', options: Partial<DiagramOptions> = {}): Promise<Map<string, string>> {
  const diagrams = new Map<string, string>()
  const theme = diagramKey(styleId, options)
  for (const source of sources) {
    try { diagrams.set(source, await renderSvg(source, theme)) }
    catch { /* The export reports how many diagrams stayed as code. */ }
  }
  return diagrams
}
