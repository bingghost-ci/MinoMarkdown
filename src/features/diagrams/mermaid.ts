import DOMPurify, { type DOMPurify as Purifier } from 'dompurify'

type Theme = 'default' | 'dark'
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

/** Mermaid keeps global state, so renders run strictly one at a time. */
function renderSvg(source: string, theme: Theme): Promise<string> {
  const result = renderChain.then(async () => {
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme, htmlLabels: false, flowchart: { htmlLabels: false },
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
      job.apply(element.cloneNode(true) as HTMLElement)
    }, (error: unknown) => job.apply(errorElement(job.content, error)))
  }
}

/** Crepe's code block preview hook. Returning `undefined` tells it the result will arrive through `apply`. */
export function renderMermaidPreview(language: string, content: string, apply: (value: HTMLElement) => void): HTMLElement | null | undefined {
  if (language.toLowerCase() !== 'mermaid' || !content.trim()) return null
  const theme: Theme = ['dark', 'graphite'].includes(document.documentElement.dataset.theme ?? '') ? 'dark' : 'default'
  const cached = cache.get(`${theme}\0${content}`)
  if (cached) return cached.cloneNode(true) as HTMLElement
  // Only one block can be focused, so older pending edits from typing are already out of date.
  const typing = document.activeElement?.closest('.cm-editor') != null
  if (typing) pending = pending.filter((job) => !job.typing)
  pending.push({ content, theme, apply, typing })
  window.clearTimeout(timer)
  timer = window.setTimeout(flush, typing ? TYPING_DELAY_MS : 0)
  return undefined
}

/** Exports always use the light theme. A diagram that fails is left out, and the page keeps its code. */
export async function renderDiagramsForExport(sources: readonly string[]): Promise<Map<string, string>> {
  const diagrams = new Map<string, string>()
  for (const source of sources) {
    try { diagrams.set(source, await renderSvg(source, 'default')) }
    catch { /* The export reports how many diagrams stayed as code. */ }
  }
  return diagrams
}
