import type { Root } from 'mdast'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { looksLikeFrontMatter } from '../../core/markdown/frontMatter'
import { remarkDemoteCurrency } from '../../core/markdown/math'
import { loadMathRenderer, rehypeRenderMath, withMathClasses } from '../../core/markdown/renderMath'
import { rehypeEmbedDiagrams } from '../../core/markdown/diagrams'
import { rehypeFigures } from '../../core/markdown/figures'
import { rehypeAlerts } from '../../core/markdown/alerts'
import { remarkInlineTags, withInlineTags } from '../../core/markdown/inlineTags'
import { rehypeNumericColumns } from '../../core/markdown/numericColumns'
import { loadCodeParsers, rehypeCodeLabels, rehypeHighlightCode } from '../../core/markdown/highlight'
import { base64 } from './appAssets'
import { collectImageNodes, type ImageNode } from './snapshot'
import { escapeHtml } from '../text/textDocument'
import { htmlImageSources, isInlineImageData, parseHtmlImages, remarkHtmlImages } from '../../core/markdown/htmlImages'

export type ResolvedImage = { bytes: Uint8Array; mime: string }
export type ImageResolver = (url: string) => Promise<ResolvedImage | null>

/** Used when no reading style is passed in; the app always passes the stylesheet from src/features/reading/css.ts. */
const fallbackStylesheet = `
  :root { color-scheme: light; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; color: #242824; }
  body { max-width: 760px; margin: 0 auto; padding: 40px 28px 72px; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.3; break-after: avoid; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; }
  img { max-width: 100%; max-height: 240mm; height: auto; object-fit: contain; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f3f4f2; padding: 14px; border-radius: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  table { border-collapse: collapse; width: 100%; } th,td { border: 1px solid #bcc5bd; padding: 6px 9px; text-align: left; }
  .mermaid-diagram { margin: 1.2em 0; text-align: center; break-inside: avoid; } .mermaid-diagram svg { max-width: 100%; height: auto; }
  blockquote { border-left: 3px solid #91a395; padding-left: 1em; margin-left: 0; color: #56625a; }
  @page { size: A4; margin: 18mm; }
  @media print { body { max-width: none; padding: 0; } thead { display: table-header-group; } img,blockquote,tr { break-inside: avoid; } pre { break-inside: auto; } }
`



// SVG reaches an export only from a file beside the document, and a page shows it only as an `<img>`, where it can
// neither run script nor load anything.
const EMBEDDABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
const EMBED_LIMIT = 70 * 1024 * 1024

function embedImages(resolveImage: ImageResolver) {
  return () => async (tree: Root) => {
    const tasks: Promise<void>[] = []
    let embeddedBytes = 0
    type Node = ImageNode
    // The first definition of a label is the one that renders, so it is the one embedded.
    const found = collectImageNodes(tree as Node)
    const { definitions, linkReferences } = found
    const imageReferences = new Set(found.imageReferences.flatMap((node) => node.identifier ? [node.identifier.toLowerCase()] : []))
    function embed(node: Node) {
      if (node.url) {
        tasks.push((async () => {
          const image = await resolveImage(node.url!)
          if (!image || !EMBEDDABLE.includes(image.mime)) {
            throw new Error(`图片无法内嵌：${node.url}`)
          }
          embeddedBytes += image.bytes.byteLength
          if (embeddedBytes > EMBED_LIMIT) throw new Error('EXPORT_TOO_LARGE')
          node.url = `data:${image.mime};base64,${base64(image.bytes)}`
        })())
      }
    }
    for (const image of found.images) embed(image)
    for (const id of imageReferences) {
      if (linkReferences.has(id)) throw new Error('EXPORT_RESOURCE_SHARED_REFERENCE')
      const definition = definitions.get(id)
      if (definition) embed(definition)
    }
    // Raw HTML that is only layout around images is exported as those images, each file read once. One that is
    // missing shows its alt text, as in the editor, rather than stopping the export.
    const htmlValues: string[] = []
    const collectHtml = (node: Node & { value?: string }) => {
      if (node.type === 'html' && node.value && /<img/i.test(node.value)) htmlValues.push(node.value)
      for (const child of node.children ?? []) collectHtml(child as typeof node)
    }
    collectHtml(tree as never)
    const embedded = new Map<string, string | null>()
    for (const value of htmlValues) {
      for (const src of htmlImageSources(parseHtmlImages(value) ?? [])) {
        if (embedded.has(src)) continue
        if (isInlineImageData(src)) { embedded.set(src, src); continue }
        embedded.set(src, null)
        tasks.push((async () => {
          const image = await resolveImage(src)
          if (!image || !EMBEDDABLE.includes(image.mime)) return
          embeddedBytes += image.bytes.byteLength
          if (embeddedBytes > EMBED_LIMIT) throw new Error('EXPORT_TOO_LARGE')
          embedded.set(src, `data:${image.mime};base64,${base64(image.bytes)}`)
        })())
      }
    }
    await Promise.all(tasks)
    if (htmlValues.length) remarkHtmlImages((src) => embedded.get(src) ?? null)()(tree as never)
  }
}

/**
 * HTML and PDF carry the document body only; metadata stays in the Markdown file. What counts as front matter
 * is decided by the same check as in the editor and the outline, so a paragraph between two rules is exported.
 */
export function exportBody(markdown: string): string {
  const text = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text)
  return match && looksLikeFrontMatter(match[1].split(/\r?\n/)) ? text.slice(match[0].length) : text
}

/**
 * After sanitizing: an image whose address is not a data URI was not embedded, and a relative or
 * protocol-relative address would survive the sanitizer's protocol check. It is left out, so the page
 * never refers to anything outside itself.
 */
function onlyEmbeddedImages() {
  type Hast = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Hast[] }
  return (tree: Hast) => {
    const walk = (node: Hast) => {
      if (!node.children) return
      node.children = node.children.filter((child) => !(child.type === 'element' && child.tagName === 'img' && !String(child.properties?.src ?? '').startsWith('data:')))
      for (const child of node.children) walk(child)
    }
    walk(tree)
  }
}

function countRawHtml(report: { omittedHtml: number }) {
  return () => (tree: Root) => {
    function walk(node: { type: string; value?: string; children?: unknown[] }) {
      if (node.type === 'html' && !node.value?.trimStart().startsWith('<!--')) report.omittedHtml++
      for (const child of node.children ?? []) walk(child as typeof node)
    }
    walk(tree)
  }
}

export type RenderedExport = { html: string; omittedHtml: number; hasMath: boolean; failedDiagrams: number }

/**
 * The page around the body. `stylesheet` is built on the main thread by `exportStylesheet`, so this
 * renderer (which also runs in the worker) never loads fonts or textures. `fontsEmbedded` opens the
 * page CSP to `font-src data:` and nothing else.
 */
export type ExportPageOptions = { stylesheet?: string; fontsEmbedded?: boolean; captions?: boolean; /** The finished body of a text or source file (T88), already escaped by its own renderer; `markdown` is then not parsed. */ bodyHtml?: string; /** `en` for a mostly-Western document, so its words hyphenate (T68). */ lang?: 'zh-CN' | 'en' }

/** Renders a page and reports how many raw HTML fragments sanitizing left out. */
export async function renderExport(markdown: string, title: string, resolveImage: ImageResolver, diagrams: ReadonlyMap<string, string> = new Map(), page: ExportPageOptions = {}): Promise<RenderedExport> {
  const report = { omittedHtml: 0, hasMath: false, failedDiagrams: 0 }
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDemoteCurrency)
    .use(embedImages(resolveImage))
    .use(remarkInlineTags)
    .use(countRawHtml(report))
    .use(remarkRehype)
    .use(rehypeSanitize, withInlineTags(withMathClasses({ ...defaultSchema, protocols: { ...defaultSchema.protocols, src: ['data'] } })))
    .use(onlyEmbeddedImages)
    .use(rehypeRenderMath, await loadMathRenderer(markdown), report)
    .use(rehypeEmbedDiagrams, { diagrams, report })
    .use(rehypeHighlightCode, { parsers: await loadCodeParsers(markdown) })
    .use(rehypeCodeLabels)
    .use(rehypeAlerts)
    .use(rehypeNumericColumns)
    .use(rehypeFigures, { captions: page.captions ?? true })
    .use(rehypeStringify, { allowDangerousHtml: true })
  const body = page.bodyHtml ?? String(await processor.process(exportBody(markdown)))
  // `</style` cannot occur in generated CSS, but escape it anyway so the stylesheet can never end early.
  const css = (page.stylesheet ?? fallbackStylesheet).replace(/<\/style/gi, '<\\/style')
  const html = `<!doctype html>\n<html lang="${page.lang === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src ${page.fontsEmbedded ? 'data:' : "'none'"}"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main class="mino-page"><article class="mino-doc">${body}</article></main></body></html>`
  return { html, omittedHtml: report.omittedHtml, hasMath: report.hasMath, failedDiagrams: report.failedDiagrams }
}
