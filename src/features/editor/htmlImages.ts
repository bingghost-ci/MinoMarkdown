import { parseHtmlImages, type HtmlPiece } from '../../core/markdown/htmlImages'
import { htmlImageSource } from './assetUrl'

// Raw HTML stays raw text in the document; the editor only draws a picture of it (see core/markdown/htmlImages.ts).

export { htmlImageSource }

function append(pieces: readonly HtmlPiece[], assetKey: string, out: HTMLElement): void {
  for (const piece of pieces) {
    if (piece.type === 'text') { out.append(piece.value); continue }
    if (piece.type === 'br') { out.append(document.createElement('br')); continue }
    if (piece.type === 'img') {
      const src = htmlImageSource(piece.src, assetKey)
      if (src === null) {
        const missing = document.createElement('span')
        missing.className = 'mino-html-missing'
        missing.textContent = `[图片: ${piece.alt || '未命名'}]`
        out.append(missing)
        continue
      }
      const image = document.createElement('img')
      image.src = src
      image.alt = piece.alt
      image.draggable = false
      image.decoding = 'async'
      image.loading = 'lazy'
      if (piece.title) image.title = piece.title
      if (piece.width) image.style.width = /%$/.test(piece.width) ? piece.width : `${piece.width}px`
      if (piece.height) image.style.height = /%$/.test(piece.height) ? piece.height : `${piece.height}px`
      out.append(image)
      continue
    }
    // The editor node is inline, so every box is a span; a block box is made to lay out as one.
    const box = document.createElement('span')
    box.className = piece.tag === 'span' ? 'mino-html-inline' : 'mino-html-block'
    if (piece.align) box.style.textAlign = piece.align
    append(piece.children, assetKey, box)
    out.append(box)
  }
}

/** A safe drawing of a raw HTML fragment made only of layout and images, or null to keep showing its source. */
export function renderHtmlImages(value: string, assetKey: string): HTMLElement | null {
  const pieces = parseHtmlImages(value)
  if (!pieces) return null
  const out = document.createElement('span')
  out.className = 'mino-html-images'
  append(pieces, assetKey, out)
  return out
}
