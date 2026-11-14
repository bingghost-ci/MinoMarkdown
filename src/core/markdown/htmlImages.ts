// Raw HTML that is only layout around images, such as `<p align="center"><img src="images/a.svg" width="860"></p>`,
// is shown as those images by the editor, the preview and exports. Everything else in raw HTML stays out, as before.
//
// This is a small single-pass reader of exactly that subset, not an HTML parser: it needs no DOM, so the analysis
// worker can use it, and it costs one scan of the fragment. A fragment with anything it does not know is refused
// whole, and the caller keeps its old behaviour.

export type HtmlPiece =
  | { type: 'text'; value: string }
  | { type: 'br' }
  | { type: 'img'; src: string; alt: string; title?: string; width?: string; height?: string }
  | { type: 'box'; tag: 'p' | 'div' | 'center' | 'span'; align?: 'left' | 'center' | 'right'; children: HtmlPiece[] }

const MAX_FRAGMENT = 20_000
const MAX_IMAGES = 64
const BOXES = new Set(['p', 'div', 'center', 'span'])
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const SIZE = /^\d{1,5}(?:%|px)?$/
const ALIGN = /^(?:left|center|right)$/i
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? whole
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
  })
}

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase()
    if (!found.has(name)) found.set(name, decode(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return found
}

/** The pieces of a fragment made only of `p`, `div`, `center`, `span`, `br`, `img`, comments and text, with at least one image; otherwise null. */
export function parseHtmlImages(value: string): HtmlPiece[] | null {
  if (value.length > MAX_FRAGMENT || !/<img[\s/>]/i.test(value)) return null
  const root: HtmlPiece[] = []
  const stack: Extract<HtmlPiece, { type: 'box' }>[] = []
  const into = () => stack.length ? stack[stack.length - 1].children : root
  let images = 0
  let at = 0
  while (at < value.length) {
    const open = value.indexOf('<', at)
    const textEnd = open < 0 ? value.length : open
    if (textEnd > at) { into().push({ type: 'text', value: decode(value.slice(at, textEnd)) }); at = textEnd; continue }
    if (value.startsWith('<!--', at)) {
      const end = value.indexOf('-->', at + 4)
      if (end < 0) return null
      at = end + 3
      continue
    }
    TAG.lastIndex = at
    const match = TAG.exec(value)
    if (!match) return null
    at = TAG.lastIndex
    const [, closing, rawName, rawAttributes] = match
    const name = rawName.toLowerCase()
    if (closing) {
      if (name === 'br' || name === 'img') continue
      if (stack.pop()?.tag !== name) return null
      continue
    }
    const found = attributes(rawAttributes)
    if (name === 'br') { into().push({ type: 'br' }); continue }
    if (name === 'img') {
      if (++images > MAX_IMAGES) return null
      const image: Extract<HtmlPiece, { type: 'img' }> = { type: 'img', src: (found.get('src') ?? '').trim(), alt: found.get('alt') ?? '' }
      const title = found.get('title')
      if (title) image.title = title
      for (const size of ['width', 'height'] as const) {
        const given = found.get(size)?.trim()
        if (given && SIZE.test(given)) image[size] = given.replace(/px$/, '')
      }
      into().push(image)
      continue
    }
    if (!BOXES.has(name)) return null
    const box: Extract<HtmlPiece, { type: 'box' }> = { type: 'box', tag: name as 'p', children: [] }
    const align = found.get('align')
    if (name === 'center') box.align = 'center'
    else if (align && ALIGN.test(align)) box.align = align.toLowerCase() as 'center'
    into().push(box)
    stack.push(box)
  }
  return images ? root : null
}

/** Every image address in the pieces, in order. */
export function htmlImageSources(pieces: readonly HtmlPiece[]): string[] {
  const found: string[] = []
  const walk = (list: readonly HtmlPiece[]) => {
    for (const piece of list) {
      if (piece.type === 'img') found.push(piece.src)
      else if (piece.type === 'box') walk(piece.children)
    }
  }
  walk(pieces)
  return found
}

/** A relative address of a file beside the document (`images/a.svg`, `./a.png`), or null for anything else. */
export function localHtmlImagePath(src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('/') || src.startsWith('#') || /[?#]/.test(src)) return null
  const raw = src.startsWith('./') ? src.slice(2) : src
  let decoded: string
  try { decoded = decodeURIComponent(raw) } catch { return null }
  const parts = decoded.split('/')
  if (parts.length > 8 || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0') || part.includes(':'))) return null
  return decoded
}

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/

/** Inline image data a page may show as it is. SVG data is left out: only files beside the document may be SVG. */
export function isInlineImageData(src: string): boolean {
  return DATA_IMAGE.test(src)
}

type Hast = { type: 'element'; tagName: string; properties: Record<string, string | string[]>; children: Hast[] } | { type: 'text'; value: string }

/**
 * The pieces as HTML syntax-tree nodes. `resolve` gives the address an image loads from, or null to show its alt text
 * instead. Inside an inline fragment every box is a `span`; otherwise `p` stays `p` and `center` becomes a centered `div`.
 */
export function htmlImagesToHast(pieces: readonly HtmlPiece[], resolve: (src: string) => string | null, inline: boolean): Hast[] {
  return pieces.map((piece): Hast => {
    if (piece.type === 'text') return { type: 'text', value: piece.value }
    if (piece.type === 'br') return { type: 'element', tagName: 'br', properties: {}, children: [] }
    if (piece.type === 'img') {
      const src = resolve(piece.src)
      if (src === null) return { type: 'element', tagName: 'span', properties: { className: ['mino-html-missing'] }, children: [{ type: 'text', value: `[图片: ${piece.alt || '未命名'}]` }] }
      const properties: Record<string, string> = { src, alt: piece.alt }
      if (piece.title) properties.title = piece.title
      if (piece.width) properties.width = piece.width
      if (piece.height) properties.height = piece.height
      return { type: 'element', tagName: 'img', properties, children: [] }
    }
    const tagName = inline || piece.tag === 'span' ? 'span' : piece.tag === 'p' ? 'p' : 'div'
    return { type: 'element', tagName, properties: piece.align ? { align: piece.align } : {}, children: htmlImagesToHast(piece.children, resolve, inline) }
  })
}

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> }

/**
 * A remark plugin: raw HTML nodes that are layout around images become those images, through `resolve`; other raw
 * HTML is left alone. A fragment is checked with a plain string test before it is read, so a document without
 * images in raw HTML pays one `includes` per raw HTML node.
 */
export function remarkHtmlImages(resolve: (src: string) => string | null) {
  return () => (tree: MdNode) => {
    const walk = (node: MdNode, inline: boolean) => {
      if (!node.children) return
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index]
        if (child.type === 'html' && child.value && /<img/i.test(child.value)) {
          const pieces = parseHtmlImages(child.value)
          if (pieces) {
            node.children[index] = { type: 'minoHtmlImages', data: { hName: inline ? 'span' : 'div', hProperties: { className: ['mino-html-images'] }, hChildren: htmlImagesToHast(pieces, resolve, inline) } }
            continue
          }
        }
        walk(child, inline || child.type === 'paragraph' || child.type === 'heading' || child.type === 'tableCell')
      }
    }
    walk(tree, false)
  }
}
