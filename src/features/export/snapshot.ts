import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

type ImageNode = { type: string; url?: string; identifier?: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }

type Parsed = { images: ImageNode[]; imageReferences: ImageNode[]; linkReferences: Set<string>; definitions: Map<string, ImageNode> }

function parse(markdown: string): Parsed {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root
  const images: ImageNode[] = []
  const imageReferences: ImageNode[] = []
  const linkReferences = new Set<string>()
  const definitions = new Map<string, ImageNode>()
  function walk(node: ImageNode) {
    if (node.type === 'image') images.push(node)
    if (node.type === 'imageReference') imageReferences.push(node)
    if (node.type === 'linkReference' && node.identifier) linkReferences.add(node.identifier.toLowerCase())
    if (node.type === 'definition' && node.identifier) definitions.set(node.identifier.toLowerCase(), node)
    for (const child of node.children ?? []) walk(child as ImageNode)
  }
  walk(tree)
  return { images, imageReferences, linkReferences, definitions }
}

export function imageUrlsIn(markdown: string): string[] {
  // Every Markdown image, inline or by reference, contains this marker.
  if (!markdown.includes('![')) return []
  return urlsOf(parse(markdown))
}

function urlsOf({ images, imageReferences, definitions }: Parsed): string[] {
  const urls = new Set(images.map((node) => node.url).filter((url): url is string => Boolean(url)))
  for (const reference of imageReferences) {
    const url = definitions.get(reference.identifier?.toLowerCase() ?? '')?.url
    if (url) urls.add(url)
  }
  return [...urls]
}

export function localAssetPath(url: string): string | null {
  const raw = url.startsWith('./') ? url.slice(2) : url
  let decoded: string
  try { decoded = decodeURIComponent(raw) } catch { return null }
  const parts = decoded.split('/')
  if (parts.length < 1 || parts.length > 8 || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0') || part.includes(':'))) return null
  return decoded
}

/**
 * Splits the images a snapshot needs into in-memory assets and files next to the document.
 * Source-protected documents have no editor, so `pending` holds only recovered assets for them.
 */
export function snapshotResources<T>(urls: readonly string[], pending: ReadonlyMap<string, T>, hasDocumentFile: boolean): { assets: T[]; diskAssets: { url: string; relative: string }[] } {
  const assets: T[] = []
  const diskAssets: { url: string; relative: string }[] = []
  for (const url of urls) {
    const staged = pending.get(url)
    if (staged) { assets.push(staged); continue }
    const relative = localAssetPath(url)
    if (!hasDocumentFile || !relative) throw new Error('EXPORT_RESOURCE_MISSING')
    diskAssets.push({ url, relative })
  }
  return { assets, diskAssets }
}

export function rewriteImageUrls(markdown: string, replacements: ReadonlyMap<string, string>): string {
  if (replacements.size === 0) return markdown
  return rewrite(markdown, replacements, parse(markdown))
}

/**
 * Finds the images of `markdown` and rewrites those `replacement` gives a new URL for, parsing once (T92).
 * `replaced` maps each new URL to the one it stands for.
 */
export function replaceImageUrls(markdown: string, replacement: (url: string) => string | null): { markdown: string; replaced: Map<string, string> } {
  const replaced = new Map<string, string>()
  if (!markdown.includes('![')) return { markdown, replaced }
  const parsed = parse(markdown)
  const replacements = new Map<string, string>()
  for (const url of urlsOf(parsed)) {
    const next = replacement(url)
    if (next === null) continue
    replaced.set(next, url)
    replacements.set(url, next)
  }
  return { markdown: replacements.size ? rewrite(markdown, replacements, parsed) : markdown, replaced }
}

function rewrite(markdown: string, replacements: ReadonlyMap<string, string>, { images, imageReferences, linkReferences, definitions }: Parsed): string {
  const edits: { start: number; end: number; value: string }[] = []
  function position(node: ImageNode): { start: number; end: number } {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) throw new Error('INVALID_ASSET')
    return { start, end }
  }
  for (const image of images) {
    if (!image.url || !replacements.has(image.url)) continue
    const span = position(image)
    const source = markdown.slice(span.start, span.end)
    const marker = source.indexOf('](')
    if (marker < 0) throw new Error('INVALID_ASSET')
    let at = marker + 2
    while (/\s/.test(source[at] ?? '') && at < source.length) at++
    const angled = source[at] === '<'
    if (angled) at++
    if (source.slice(at, at + image.url.length) !== image.url) throw new Error('INVALID_ASSET')
    const after = source[at + image.url.length]
    if (angled ? after !== '>' : after !== ')' && !/\s/.test(after ?? '')) throw new Error('INVALID_ASSET')
    const start = span.start + at
    edits.push({ start, end: start + image.url.length, value: replacements.get(image.url)! })
  }
  const usedDefinitions = new Set(imageReferences.map((node) => node.identifier?.toLowerCase()).filter((id): id is string => Boolean(id)))
  for (const id of usedDefinitions) {
    const definition = definitions.get(id)
    if (!definition?.url || !replacements.has(definition.url)) continue
    if (linkReferences.has(id)) throw new Error('INVALID_ASSET')
    const span = position(definition)
    const source = markdown.slice(span.start, span.end)
    const labelEnd = source.indexOf(']:')
    if (labelEnd < 0) throw new Error('INVALID_ASSET')
    const at = source.indexOf(definition.url, labelEnd + 2)
    if (at < 0) throw new Error('INVALID_ASSET')
    const start = span.start + at
    edits.push({ start, end: start + definition.url.length, value: replacements.get(definition.url)! })
  }
  let output = markdown
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end)
  return output
}
