import type { Root } from 'mdast'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { remarkDemoteCurrency } from '../../core/markdown/math'
import { rehypeRenderMath, withMathClasses } from '../../core/markdown/renderMath'
import { rehypeEmbedDiagrams } from '../../core/markdown/diagrams'
import { rehypeFigures } from '../../core/markdown/figures'
import { rehypeNumericColumns } from '../../core/markdown/numericColumns'
import { loadCodeParsers, rehypeHighlightCode } from '../../core/markdown/highlight'

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

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function base64(bytes: Uint8Array): string {
  let output = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(output)
}

function embedImages(resolveImage: ImageResolver) {
  return () => async (tree: Root) => {
    const tasks: Promise<void>[] = []
    let embeddedBytes = 0
    type Node = { type: string; url?: string; identifier?: string; children?: unknown[] }
    const definitions = new Map<string, Node>()
    const imageReferences = new Set<string>()
    const linkReferences = new Set<string>()
    function collect(node: Node) {
      const id = node.identifier?.toLowerCase()
      if (node.type === 'definition' && id) definitions.set(id, node)
      if (node.type === 'imageReference' && id) imageReferences.add(id)
      if (node.type === 'linkReference' && id) linkReferences.add(id)
      for (const child of node.children ?? []) collect(child as Node)
    }
    collect(tree)
    function embed(node: Node) {
      if (node.url) {
        tasks.push((async () => {
          const image = await resolveImage(node.url!)
          if (!image || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mime)) {
            throw new Error(`图片无法内嵌：${node.url}`)
          }
          embeddedBytes += image.bytes.byteLength
          if (embeddedBytes > 70 * 1024 * 1024) throw new Error('EXPORT_TOO_LARGE')
          node.url = `data:${image.mime};base64,${base64(image.bytes)}`
        })())
      }
    }
    function walk(node: Node) {
      if (node.type === 'image') embed(node)
      for (const child of node.children ?? []) walk(child as typeof node)
    }
    walk(tree)
    for (const id of imageReferences) {
      if (linkReferences.has(id)) throw new Error('EXPORT_RESOURCE_SHARED_REFERENCE')
      const definition = definitions.get(id)
      if (definition) embed(definition)
    }
    await Promise.all(tasks)
  }
}

/** HTML and PDF carry the document body only; metadata stays in the Markdown file. */
export function exportBody(markdown: string): string {
  const text = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown
  return text.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, '')
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
export type ExportPageOptions = { stylesheet?: string; fontsEmbedded?: boolean; captions?: boolean; /** `en` for a mostly-Western document, so its words hyphenate (T68). */ lang?: 'zh-CN' | 'en' }

/** Renders a page and reports how many raw HTML fragments sanitizing left out. */
export async function renderExport(markdown: string, title: string, resolveImage: ImageResolver, diagrams: ReadonlyMap<string, string> = new Map(), page: ExportPageOptions = {}): Promise<RenderedExport> {
  const report = { omittedHtml: 0, hasMath: false, failedDiagrams: 0 }
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDemoteCurrency)
    .use(countRawHtml(report))
    .use(embedImages(resolveImage))
    .use(remarkRehype)
    .use(rehypeSanitize, withMathClasses({ ...defaultSchema, protocols: { ...defaultSchema.protocols, src: ['data'] } }))
    .use(rehypeRenderMath, report)
    .use(rehypeEmbedDiagrams, { diagrams, report })
    .use(rehypeHighlightCode, { parsers: await loadCodeParsers(markdown) })
    .use(rehypeNumericColumns)
    .use(rehypeFigures, { captions: page.captions ?? true })
    .use(rehypeStringify, { allowDangerousHtml: true })
  const body = String(await processor.process(exportBody(markdown)))
  // `</style` cannot occur in generated CSS, but escape it anyway so the stylesheet can never end early.
  const css = (page.stylesheet ?? fallbackStylesheet).replace(/<\/style/gi, '<\\/style')
  const html = `<!doctype html>\n<html lang="${page.lang === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src ${page.fontsEmbedded ? 'data:' : "'none'"}"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main class="mino-page"><article class="mino-doc">${body}</article></main></body></html>`
  return { html, omittedHtml: report.omittedHtml, hasMath: report.hasMath, failedDiagrams: report.failedDiagrams }
}

export async function renderHtml(markdown: string, title: string, resolveImage: ImageResolver): Promise<string> {
  return (await renderExport(markdown, title, resolveImage)).html
}
