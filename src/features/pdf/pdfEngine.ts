import type { PDFDocumentProxy } from 'pdfjs-dist'
import { findInText, type FindOptions } from '../editor/findText'
import type { OutlineItem } from '../outline/outline'

/**
 * Reading a PDF (T86, T87). The renderer is PDF.js, bundled with the app and loaded only when a PDF is
 * opened. This module has no IPC of its own: the workspace hook supplies `PdfSource`, whose functions go to
 * Rust. Nothing is fetched by URL — the webview's CSP allows no `connect-src` but IPC — so the file comes in
 * checked ranges and the character maps and standard fonts through `readAsset`.
 */
export type PdfSource = {
  /** Bytes in the file. */
  size: number
  /** One range of the file; rejects with an error code (`CHANGED` when the file was replaced). */
  read: (offset: number, length: number) => Promise<Uint8Array>
  /** A file bundled with the app, by absolute path such as `/pdfjs/cmaps/UniGB-UCS2-H.bcmap`. */
  readAsset: (path: string) => Promise<Uint8Array>
}

export type PdfLibrary = typeof import('pdfjs-dist')
export type PdfDocument = PDFDocumentProxy

export const PDF_ASSET_ROOT = '/pdfjs/'
/** How much of the file one request asks for. Rust serves at most 8 MiB per call. */
export const RANGE_CHUNK = 256 * 1024

export type PdfRuntime = { library: PdfLibrary; /** Starts a worker for one document. */ createWorker: () => Worker }
let browserRuntime: Promise<PdfRuntime> | null = null

/**
 * PDF.js and a way to start its worker, for the app. The legacy build runs on the WebKit of every supported
 * macOS. Each document gets a worker of its own: with one shared worker, closing a document (or switching
 * away from its tab) left the worker "being destroyed" and the next PDF could not open.
 */
export function loadPdfLibrary(): Promise<PdfRuntime> {
  browserRuntime ??= (async () => {
    const [library, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfLibrary>,
      import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker'),
    ])
    return { library, createWorker: () => new worker.default() }
  })()
  browserRuntime.catch(() => { browserRuntime = null })
  return browserRuntime
}

const closers = new WeakMap<object, () => Promise<void>>()

/** Ends a document opened by `openPdf` and stops the worker that served it. */
export function closePdf(document: PdfDocument): Promise<void> {
  return closers.get(document)?.() ?? document.loadingTask.destroy()
}

export type OpenOptions = {
  /** Called when the file is encrypted, and again after a wrong password. Resolve with the password, or null to give up. */
  onPassword?: (wrongPassword: boolean) => Promise<string | null>
  /** Called when a range could not be read; the document cannot continue after that. */
  onReadError?: (code: string) => void
  /** A worker for this document alone. Without one the library uses its own (in tests, the calling thread). */
  createWorker?: () => Worker
}

/**
 * Opens a PDF over `source`. Scripts in the file never run (`enableScripting` is a viewer feature this app
 * does not have), XFA forms are off, and WebAssembly decoders are off because the CSP forbids them; the
 * library's JavaScript decoders are used instead.
 */
export async function openPdf(library: PdfLibrary, source: PdfSource, options: OpenOptions = {}): Promise<PdfDocument> {
  let failed = false
  // A failed read ends the opening at once; the library itself would keep waiting for the range.
  let fail: (error: Error) => void = () => undefined
  const failure = new Promise<never>((_, reject) => { fail = reject })
  class Transport extends library.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      if (failed) return
      source.read(begin, end - begin).then((chunk) => this.onDataRange(begin, chunk), (error: unknown) => {
        if (failed) return
        failed = true
        const code = error instanceof Error ? error.message : String(error)
        options.onReadError?.(code)
        fail(new Error(code))
        void stop()
      })
    }
  }
  /** Stands in for the library's `fetch`-based factory, which the CSP would stop. */
  class BinaryData {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const folder = kind === 'cMapUrl' ? 'cmaps/' : kind === 'standardFontDataUrl' ? 'standard_fonts/' : null
      if (folder === null || !/^[\w.-]+$/.test(filename)) throw new Error(`Unable to load ${kind} data: ${filename}`)
      return source.readAsset(`${PDF_ASSET_ROOT}${folder}${filename}`)
    }
  }
  const base = typeof location === 'undefined' ? PDF_ASSET_ROOT : new URL(PDF_ASSET_ROOT, location.href).href
  const port = options.createWorker?.() ?? null
  const worker = port ? library.PDFWorker.create({ port }) : undefined
  const stop = async () => {
    await task.destroy().catch(() => undefined)
    worker?.destroy()
    port?.terminate()
  }
  const task = library.getDocument({
    worker,
    range: new Transport(source.size, null),
    rangeChunkSize: RANGE_CHUNK,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    BinaryDataFactory: BinaryData,
  })
  task.onPassword = (update: (password: string | Error) => void, reason: number) => {
    const ask = options.onPassword
    if (!ask) { update(new Error('PDF_PASSWORD')); return }
    void ask(reason === library.PasswordResponses.INCORRECT_PASSWORD).then((password) => update(password ?? new Error('PDF_PASSWORD')), () => update(new Error('PDF_PASSWORD')))
  }
  task.promise.then((document) => { closers.set(document, stop) }, () => { void stop() })
  return Promise.race([task.promise, failure])
}

type TextItem = { str: string; hasEOL?: boolean }

/** The text of a page as one string, with where each text item starts in it (for highlighting matches). */
export function joinTextItems(items: readonly unknown[]): { text: string; starts: number[] } {
  const starts: number[] = []
  let text = ''
  for (const item of items) {
    const { str, hasEOL } = item as TextItem
    if (typeof str !== 'string') { starts.push(-1); continue }
    starts.push(text.length)
    text += str
    if (hasEOL) text += '\n'
  }
  return { text, starts }
}

export async function pageText(document: PdfDocument, pageNumber: number): Promise<string> {
  const page = await document.getPage(pageNumber)
  try { return joinTextItems((await page.getTextContent()).items).text }
  finally { page.cleanup() }
}

export type PdfText = { text: string; pages: number; /** Pages that had any text. */ textPages: number; /** Stopped at the character budget. */ truncated: boolean; /** No text layer to speak of: a scan. */ scanned: boolean }

/** A document with almost no characters per page is a scan; there is nothing to search or to send. */
export function looksScanned(pages: number, characters: number): boolean {
  return pages > 0 && characters < pages * 12
}

export function pageHeading(pageNumber: number): string {
  return `[第 ${pageNumber} 页 / Page ${pageNumber}]`
}

/** Joins page texts for the AI assistant, each page under a marker line, up to `maxChars`. */
export function assemblePdfText(pages: readonly string[], total: number, maxChars: number): PdfText {
  const parts: string[] = []
  let length = 0
  let characters = 0
  let textPages = 0
  let truncated = pages.length < total
  for (const [index, raw] of pages.entries()) {
    const body = raw.trim()
    characters += body.replace(/\s+/g, '').length
    if (!body) continue
    textPages++
    const part = `${pageHeading(index + 1)}\n${body}`
    if (length + part.length > maxChars) { truncated = true; parts.push(part.slice(0, Math.max(0, maxChars - length))); break }
    parts.push(part)
    length += part.length + 2
  }
  return { text: parts.join('\n\n'), pages: total, textPages, truncated, scanned: looksScanned(pages.length, characters) }
}

/** A reader for page texts that fetches each page once. Extraction runs in order and can be stopped. */
export class PdfTextCache {
  private readonly texts = new Map<number, Promise<string>>()
  private stopped = false
  constructor(private readonly document: PdfDocument) {}

  page(pageNumber: number): Promise<string> {
    let text = this.texts.get(pageNumber)
    if (!text) {
      text = pageText(this.document, pageNumber).catch(() => '')
      this.texts.set(pageNumber, text)
    }
    return text
  }

  /** All pages up to a character budget. */
  async all(maxChars: number): Promise<string[]> {
    const pages: string[] = []
    let length = 0
    for (let pageNumber = 1; pageNumber <= this.document.numPages; pageNumber++) {
      if (this.stopped || length > maxChars) break
      const text = await this.page(pageNumber)
      pages.push(text)
      length += text.length
    }
    return pages
  }

  stop() { this.stopped = true }
}

export type PdfMatch = { page: number; from: number; to: number }

/** Matches of a query in page texts, in reading order. `texts[0]` is page 1. */
export function searchPages(texts: readonly string[], query: string, options: FindOptions, limit = 5000): PdfMatch[] {
  const matches: PdfMatch[] = []
  if (!query) return matches
  for (const [index, text] of texts.entries()) {
    for (const match of findInText(text, query, options)) {
      matches.push({ page: index + 1, from: match.from, to: match.to })
      if (matches.length >= limit) return matches
    }
  }
  return matches
}

type OutlineNode = { title: string; dest: string | unknown[] | null; items?: OutlineNode[] }

/** The page a link or bookmark destination leads to, counted from 1. */
export async function resolveDestination(document: PdfDocument, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await document.getDestination(dest) : dest
    const target = Array.isArray(explicit) ? explicit[0] : null
    if (typeof target === 'number' && Number.isInteger(target)) return target + 1
    if (target && typeof target === 'object') return await document.getPageIndex(target as Parameters<PdfDocument['getPageIndex']>[0]) + 1
  } catch { /* A bookmark that points nowhere is left out. */ }
  return null
}

export const OUTLINE_LIMIT = 2000

/** The file's bookmarks as outline items whose `target` is a page number. */
export async function pdfOutline(document: PdfDocument): Promise<OutlineItem[]> {
  const items: OutlineItem[] = []
  const walk = async (nodes: OutlineNode[], level: number): Promise<void> => {
    for (const node of nodes) {
      if (items.length >= OUTLINE_LIMIT) return
      const text = (node.title ?? '').replace(/\s+/g, ' ').trim()
      const page = await resolveDestination(document, node.dest)
      if (text && page !== null) items.push({ level: Math.min(level, 6), text, target: page })
      if (node.items?.length) await walk(node.items, level + 1)
    }
  }
  const outline = await document.getOutline().catch(() => null) as OutlineNode[] | null
  if (outline) await walk(outline, 1)
  return items
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 4
/** Canvas pixels per page are capped so that a large zoom on a Retina screen cannot exhaust memory. */
export const MAX_CANVAS_PIXELS = 16_000_000

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : 1))
}

/** The scale at which a page of `pageWidth` points fills `available` CSS pixels. */
export function fitWidthScale(available: number, pageWidth: number): number {
  return clampScale(pageWidth > 0 && available > 0 ? available / pageWidth : 1)
}

export function zoomedScale(scale: number, action: 'zoom-in' | 'zoom-out'): number {
  const next = action === 'zoom-in' ? scale * 1.15 : scale / 1.15
  return clampScale(Math.round(next * 100) / 100)
}

/** How many device pixels to draw per CSS pixel: the screen's ratio, less when the page would be too large. */
export function outputScale(width: number, height: number, devicePixelRatio: number): number {
  const ratio = Math.max(1, devicePixelRatio || 1)
  const pixels = width * height * ratio * ratio
  return pixels > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (width * height)) : ratio
}

/** The page at a scroll offset, given where each page starts (ascending), and how far into it. */
export function pageAtOffset(tops: readonly number[], heights: readonly number[], offset: number): { page: number; fraction: number } {
  if (tops.length === 0) return { page: 1, fraction: 0 }
  let low = 0
  let high = tops.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (tops[middle] <= offset) low = middle
    else high = middle - 1
  }
  const height = heights[low] || 1
  return { page: low + 1, fraction: Math.min(1, Math.max(0, (offset - tops[low]) / height)) }
}
