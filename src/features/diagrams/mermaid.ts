import DOMPurify, { type DOMPurify as Purifier } from 'dompurify'
import { diagramConfig, diagramKey, diagramVariables, parseDiagramKey, type DiagramOptions } from './looks'

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
  library ??= import('mermaid').then((module) => module.default)
  return library
}

const remoteCss = /@import[^;]*;?|url\(\s*(?!['"]?(?:#|data:))[^)]*\)/gi

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
    const style = element.getAttribute('style')
    if (style !== null) element.setAttribute('style', style.replace(remoteCss, 'none'))
    if (element.tagName.toLowerCase() === 'style' && element.textContent) element.textContent = element.textContent.replace(remoteCss, 'none')
  }
  return root.innerHTML
}

/** The style and diagram options the page shows now: `data-theme`, `data-diagram`, `data-diagram-line` and `data-diagram-curve` on `<html>`. */
export function currentDiagramKey(): Theme {
  const root = document.documentElement
  return diagramKey(root.dataset.theme ?? 'white', { look: root.dataset.diagram, line: root.dataset.diagramLine, curve: root.dataset.diagramCurve })
}

/** Mermaid sizes boxes by measuring their labels, so a look's own font must be ready before it draws. */
async function fontReady(family: string): Promise<void> {
  if (family === 'inherit' || typeof document.fonts?.load !== 'function') return
  try { await document.fonts.load(`16px ${family}`, '图Aa') } catch { /* Drawn in the fallback font. */ }
}

/** Mermaid keeps global state, so renders run strictly one at a time. */
function renderSvg(source: string, theme: Theme): Promise<string> {
  const result = renderChain.then(async () => {
    // A document with many diagrams draws them back to back. Giving up the thread before each one lets
    // scrolling and typing through while they fill in (T96).
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const mermaid = await loadMermaid()
    const { styleId, ...options } = parseDiagramKey(theme)
    const { curve, ...config } = diagramConfig(styleId, options, source)
    await fontReady(config.fontFamily)
    mermaid.initialize({
      ...config,
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base', themeVariables: diagramVariables(styleId, options.look), htmlLabels: false, flowchart: { htmlLabels: false, curve }, state: { curve } as never,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'htmlLabels'],
    })
    const { svg } = await mermaid.render(`mino-mermaid-${nextDiagramId++}`, source)
    return sanitizeDiagramSvg(svg)
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
