import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Moon, ZoomIn, ZoomOut } from 'lucide-react'
import type { FindOptions } from '../editor/find'
import type { OutlineItem } from '../outline/outline'
import { assemblePdfText, clampScale, fitWidthScale, joinTextItems, loadPdfLibrary, openPdf, outputScale, pageAtOffset, pdfOutline, PdfTextCache, resolveDestination, searchPages, zoomedScale, type PdfDocument, type PdfLibrary, type PdfMatch, type PdfSource, type PdfText } from './pdfEngine'

export type PdfPosition = { page: number; offset: number }
export type PdfZoomAction = 'zoom-in' | 'zoom-out' | 'zoom-reset'
export type FindCount = { current: number; total: number }

/** What the workspace can ask of the PDF on screen. */
export type PdfHandle = {
  scroller: HTMLElement | null
  zoom: (action: PdfZoomAction) => void
  goToPage: (page: number) => void
  find: (query: string, options: FindOptions) => Promise<FindCount>
  findStep: (direction: 1 | -1) => FindCount
  /** The text of the document for the AI assistant, up to `maxChars`. */
  text: (maxChars: number) => Promise<PdfText>
}

/** What the PDF view needs from the workspace; every function that reaches Rust lives there. */
export type PdfBridge = {
  source: PdfSource
  loadPosition: () => Promise<PdfPosition | null>
  savePosition: (position: PdfPosition) => void
  register: (handle: PdfHandle | null) => void
  onOutline: (items: OutlineItem[]) => void
  onPages: (pages: number) => void
  openLink: (href: string) => void
  onStatus: (message: string) => void
}

type Props = { bridge: PdfBridge; name: string; dark: boolean; t: (text: string) => string }
type PageSize = { width: number; height: number }
type Rendered = { scale: number; cancel: () => void; divs: HTMLElement[]; starts: number[] }

const PAGE_GAP = 14
const VIEW_PADDING = 24
const DIM_KEY = 'mino-pdf-dim'
const HIGHLIGHT = 'mino-pdf-find'
const HIGHLIGHT_CURRENT = 'mino-pdf-find-current'

function storedDim(): boolean {
  try { return window.localStorage.getItem(DIM_KEY) !== '0' } catch { return true }
}

type HighlightRegistry = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void }
function highlights(): { registry: HighlightRegistry; make: (ranges: Range[]) => unknown } | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
  const Constructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  return registry && Constructor ? { registry, make: (ranges) => new Constructor(...ranges) } : null
}

/** A PDF as a column of pages. Only the pages near the screen hold a canvas and a text layer. */
export default function PdfView({ bridge, name, dark, t }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const pageElements = useRef(new Map<number, HTMLDivElement>())
  const library = useRef<PdfLibrary | null>(null)
  const pdf = useRef<PdfDocument | null>(null)
  const texts = useRef<PdfTextCache | null>(null)
  const rendered = useRef(new Map<number, Rendered>())
  const visible = useRef(new Set<number>())
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge
  const [phase, setPhase] = useState<'loading' | 'password' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [sizes, setSizes] = useState<PageSize[]>([])
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes
  const [zoom, setZoom] = useState<{ fit: boolean; scale: number }>({ fit: true, scale: 1 })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [dim, setDim] = useState(storedDim)
  const [password, setPassword] = useState('')
  const [wrongPassword, setWrongPassword] = useState(false)
  const passwordReply = useRef<((value: string | null) => void) | null>(null)
  const search = useRef<{ matches: PdfMatch[]; index: number; pageTexts: string[] }>({ matches: [], index: 0, pageTexts: [] })
  const pendingPosition = useRef<PdfPosition | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)

  function layout(): { tops: number[]; heights: number[] } {
    const tops: number[] = []
    const heights: number[] = []
    let top = VIEW_PADDING
    for (const size of sizesRef.current) {
      const height = Math.floor(size.height * zoomRef.current.scale)
      tops.push(top)
      heights.push(height)
      top += height + PAGE_GAP
    }
    return { tops, heights }
  }

  function scrollToPage(pageNumber: number, fraction = 0) {
    const root = scroller.current
    const { tops, heights } = layout()
    const index = Math.min(tops.length, Math.max(1, Math.round(pageNumber))) - 1
    if (!root || tops.length === 0) return
    root.scrollTop = Math.max(0, tops[index] - 8 + heights[index] * Math.min(1, Math.max(0, fraction)))
  }

  function release(pageNumber: number) {
    const entry = rendered.current.get(pageNumber)
    if (!entry) return
    entry.cancel()
    rendered.current.delete(pageNumber)
    const host = pageElements.current.get(pageNumber)
    if (!host) return
    for (const canvas of host.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0 }
    host.replaceChildren()
  }

  async function render(pageNumber: number) {
    const lib = library.current
    const document = pdf.current
    const host = pageElements.current.get(pageNumber)
    const scale = zoomRef.current.scale
    if (!lib || !document || !host) return
    if (rendered.current.get(pageNumber)?.scale === scale) return
    release(pageNumber)
    let cancelled = false
    const cancels: (() => void)[] = []
    const entry: Rendered = { scale, cancel: () => { cancelled = true; for (const cancel of cancels) cancel() }, divs: [], starts: [] }
    rendered.current.set(pageNumber, entry)
    try {
      const pdfPage = await document.getPage(pageNumber)
      if (cancelled) return
      const viewport = pdfPage.getViewport({ scale })
      const actual = pdfPage.getViewport({ scale: 1 })
      const known = sizesRef.current[pageNumber - 1]
      // Pages are laid out with the first page's size until their own is known.
      if (known && (Math.abs(known.width - actual.width) > 0.5 || Math.abs(known.height - actual.height) > 0.5)) setSizes((current) => current.map((size, index) => index === pageNumber - 1 ? { width: actual.width, height: actual.height } : size))
      const ratio = outputScale(viewport.width, viewport.height, window.devicePixelRatio)
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.setAttribute('aria-hidden', 'true')
      const textLayer = window.document.createElement('div')
      textLayer.className = 'textLayer'
      const linkLayer = window.document.createElement('div')
      linkLayer.className = 'pdf-links'
      host.replaceChildren(canvas, textLayer, linkLayer)
      const task = pdfPage.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      cancels.push(() => task.cancel())
      const content = await pdfPage.getTextContent()
      if (cancelled) return
      const layer = new lib.TextLayer({ textContentSource: content, container: textLayer, viewport })
      cancels.push(() => layer.cancel())
      await Promise.all([task.promise, layer.render()])
      if (cancelled) return
      // `textDivs` has one element per text item that produced one; match them back to the items by their text.
      const joined = joinTextItems(content.items)
      const strings = layer.textContentItemsStr
      let cursor = 0
      for (const [index, div] of layer.textDivs.entries()) {
        const wanted = strings[index]
        while (cursor < content.items.length && (joined.starts[cursor] < 0 || (content.items[cursor] as { str?: string }).str !== wanted)) cursor++
        entry.divs.push(div)
        entry.starts.push(cursor < content.items.length ? joined.starts[cursor] : -1)
        cursor++
      }
      for (const annotation of await pdfPage.getAnnotations({ intent: 'display' }) as { subtype?: string; url?: string; unsafeUrl?: string; dest?: string | unknown[] | null; rect?: number[] }[]) {
        if (cancelled) return
        if (annotation.subtype !== 'Link' || !annotation.rect || (!annotation.url && !annotation.dest)) continue
        const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]) as number[]
        const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]) as number[]
        const link = window.document.createElement('button')
        link.type = 'button'
        link.className = 'pdf-link'
        link.title = annotation.url ?? ''
        link.style.left = `${Math.min(x1, x2)}px`
        link.style.top = `${Math.min(y1, y2)}px`
        link.style.width = `${Math.abs(x2 - x1)}px`
        link.style.height = `${Math.abs(y2 - y1)}px`
        // The address goes through the same check and confirmation as a link in a Markdown document.
        link.addEventListener('click', () => {
          if (annotation.url) bridgeRef.current.openLink(annotation.url)
          else void resolveDestination(document, annotation.dest ?? null).then((target) => { if (target !== null) scrollToPage(target) })
        })
        linkLayer.append(link)
      }
      paintMatches()
    } catch (reason) {
      if (rendered.current.get(pageNumber) === entry) rendered.current.delete(pageNumber)
      if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) { host.dataset.failed = 'true'; host.dataset.reason = String(reason instanceof Error ? `${reason.name}: ${reason.message}` : reason) }
    }
  }

  function renderVisible() {
    const wanted = new Set<number>()
    for (const pageNumber of visible.current) for (const near of [pageNumber - 1, pageNumber, pageNumber + 1]) if (near >= 1 && near <= sizesRef.current.length) wanted.add(near)
    for (const pageNumber of [...rendered.current.keys()]) if (!wanted.has(pageNumber)) release(pageNumber)
    for (const pageNumber of wanted) void render(pageNumber)
  }

  /** Marks the matches on the pages that are drawn, with the CSS highlight API where the WebView has it. */
  function paintMatches() {
    const api = highlights()
    if (!api) return
    const all: Range[] = []
    const current: Range[] = []
    const { matches, index } = search.current
    for (const [at, match] of matches.entries()) {
      const entry = rendered.current.get(match.page)
      if (!entry) continue
      for (const [position, div] of entry.divs.entries()) {
        const start = entry.starts[position]
        const node = div.firstChild
        if (start < 0 || !node || node.nodeType !== Node.TEXT_NODE) continue
        const length = node.textContent?.length ?? 0
        const from = Math.max(match.from, start)
        const to = Math.min(match.to, start + length)
        if (from >= to) continue
        const range = window.document.createRange()
        range.setStart(node, from - start)
        range.setEnd(node, to - start)
        ;(at === index ? current : all).push(range)
      }
    }
    api.registry.set(HIGHLIGHT, api.make(all))
    api.registry.set(HIGHLIGHT_CURRENT, api.make(current))
  }

  function count(): FindCount {
    return { current: search.current.index, total: search.current.matches.length }
  }

  function showMatch() {
    const match = search.current.matches[search.current.index]
    if (!match) { paintMatches(); return }
    const text = search.current.pageTexts[match.page - 1] ?? ''
    scrollToPage(match.page, text.length > 0 ? Math.max(0, match.from / text.length - 0.15) : 0)
    paintMatches()
  }

  // Open the document. Everything it needs comes through `bridge.source`.
  useEffect(() => {
    let disposed = false
    let opened: PdfDocument | null = null
    void (async () => {
      try {
        const lib = await loadPdfLibrary()
        if (disposed) return
        library.current = lib
        const document = await openPdf(lib, bridgeRef.current.source, {
          onPassword: (wrong) => new Promise((resolve) => { if (disposed) { resolve(null); return } passwordReply.current = resolve; setWrongPassword(wrong); setPassword(''); setPhase('password') }),
          onReadError: (code) => { if (!disposed) { setError(code === 'CHANGED' ? t('磁盘上的 PDF 已经变化，正在重新载入…') : t('读取 PDF 失败，文件可能已被移动或删除。')); setPhase('error') } },
        })
        opened = document
        if (disposed) { void document.loadingTask.destroy().catch(() => undefined); return }
        pdf.current = document
        texts.current = new PdfTextCache(document)
        const first = (await document.getPage(1)).getViewport({ scale: 1 })
        if (disposed) return
        pendingPosition.current = await bridgeRef.current.loadPosition().catch(() => null)
        if (disposed) return
        setSizes(Array.from({ length: document.numPages }, () => ({ width: first.width, height: first.height })))
        setPhase('ready')
        bridgeRef.current.onPages(document.numPages)
        void pdfOutline(document).then((items) => { if (!disposed) bridgeRef.current.onOutline(items) })
      } catch (reason) {
        if (disposed) return
        const message = reason instanceof Error ? reason.message : String(reason)
        const kind = reason instanceof Error ? reason.name : ''
        setError(message === 'PDF_PASSWORD' || kind === 'PasswordException' ? t('没有输入密码，无法打开这个加密的 PDF。') : kind === 'InvalidPDFException' || kind === 'FormatError' ? t('这个文件已损坏或不是有效的 PDF，无法显示。') : `${t('无法打开这个 PDF：')}${message}`)
        setPhase('error')
      }
    })()
    return () => {
      disposed = true
      passwordReply.current?.(null)
      texts.current?.stop()
      for (const pageNumber of [...rendered.current.keys()]) release(pageNumber)
      const api = highlights()
      api?.registry.delete(HIGHLIGHT)
      api?.registry.delete(HIGHLIGHT_CURRENT)
      void (pdf.current ?? opened)?.loadingTask.destroy().catch(() => undefined)
      pdf.current = null
      bridgeRef.current.onOutline([])
    }
  }, [])

  // Fit-width follows the pane; a fixed zoom does not.
  useEffect(() => {
    const root = scroller.current
    if (!root || phase !== 'ready') return
    const fit = () => {
      if (!zoomRef.current.fit) return
      const widest = sizesRef.current.reduce((width, size) => Math.max(width, size.width), 0)
      const scale = Math.round(fitWidthScale(Math.min(root.clientWidth - 2 * VIEW_PADDING, 1400), widest) * 100) / 100
      if (scale !== zoomRef.current.scale) setZoom({ fit: true, scale })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(root)
    return () => observer.disconnect()
  }, [phase, zoom.fit, sizes.length])

  // Which pages are on screen. The observer is rebuilt when the pages change size, so its targets are current.
  useEffect(() => {
    const root = scroller.current
    if (!root || phase !== 'ready') return
    visible.current.clear()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageNumber = Number((entry.target as HTMLElement).dataset.page)
        if (entry.isIntersecting) visible.current.add(pageNumber)
        else visible.current.delete(pageNumber)
      }
      renderVisible()
    }, { root, rootMargin: '400px 0px' })
    for (const element of pageElements.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [phase, sizes, zoom.scale])

  // Return to where the reader was, once, after the first layout.
  useEffect(() => {
    if (phase !== 'ready' || sizes.length === 0 || !pendingPosition.current) return
    const position = pendingPosition.current
    pendingPosition.current = null
    requestAnimationFrame(() => scrollToPage(position.page, position.offset))
  }, [phase, sizes.length])

  function onScroll() {
    const root = scroller.current
    if (!root) return
    const { tops, heights } = layout()
    const at = pageAtOffset(tops, heights, root.scrollTop + 8)
    if (at.page !== page) { setPage(at.page); setPageInput(String(at.page)) }
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => bridgeRef.current.savePosition({ page: at.page, offset: Math.round(at.fraction * 1000) / 1000 }), 1200)
  }
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  function changeZoom(action: PdfZoomAction) {
    const root = scroller.current
    const { tops, heights } = layout()
    const anchor = root ? pageAtOffset(tops, heights, root.scrollTop + 8) : { page, fraction: 0 }
    setZoom(action === 'zoom-reset' ? { fit: true, scale: zoomRef.current.scale } : { fit: false, scale: zoomedScale(zoomRef.current.scale, action) })
    // Keep the same place on the same page under the top of the view.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToPage(anchor.page, anchor.fraction)))
  }

  useEffect(() => {
    const handle: PdfHandle = {
      get scroller() { return scroller.current },
      zoom: changeZoom,
      goToPage: (target) => scrollToPage(target),
      find: async (query, options) => {
        const cache = texts.current
        if (!cache || !query) { search.current = { matches: [], index: 0, pageTexts: [] }; paintMatches(); return count() }
        bridgeRef.current.onStatus(t('正在读取 PDF 文字…'))
        const pageTexts = await cache.all(Number.MAX_SAFE_INTEGER)
        const matches = searchPages(pageTexts, query, options)
        // Start from the first match at or after the page being read.
        const start = matches.findIndex((match) => match.page >= page)
        search.current = { matches, index: Math.max(0, start), pageTexts }
        bridgeRef.current.onStatus(matches.length ? `${t('找到')} ${matches.length} ${t('处')}` : pageTexts.every((text) => !text.trim()) ? t('这个 PDF 没有文字层，无法查找。') : t('没有找到'))
        showMatch()
        return count()
      },
      findStep: (direction) => {
        const { matches } = search.current
        if (matches.length === 0) return count()
        search.current.index = (search.current.index + direction + matches.length) % matches.length
        showMatch()
        return count()
      },
      text: async (maxChars) => {
        const document = pdf.current
        const cache = texts.current
        if (!document || !cache) throw new Error('PDF_NOT_READY')
        return assemblePdfText(await cache.all(maxChars), document.numPages, maxChars)
      },
    }
    bridgeRef.current.register(handle)
    return () => bridgeRef.current.register(null)
  })

  function submitPage(event: FormEvent) {
    event.preventDefault()
    const target = Number.parseInt(pageInput, 10)
    if (Number.isFinite(target)) scrollToPage(target)
    else setPageInput(String(page))
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    const reply = passwordReply.current
    passwordReply.current = null
    setPhase('loading')
    reply?.(password)
    setPassword('')
  }

  function toggleDim() {
    setDim((current) => {
      try { window.localStorage.setItem(DIM_KEY, current ? '0' : '1') } catch { /* The choice then lasts for this window only. */ }
      return !current
    })
  }

  const widest = sizes.reduce((width, size) => Math.max(width, size.width), 0)
  return <div className="pdf-view" data-dim={dark && dim}>
    <div ref={scroller} className="editor-root pdf-scroller" tabIndex={0} aria-label={`${t('PDF 文档')} ${name}`} onScroll={onScroll}>
      {phase === 'loading' && <p className="pdf-message" role="status">{t('正在打开 PDF…')}</p>}
      {phase === 'error' && <p className="pdf-message" role="alert">{error}</p>}
      {phase === 'password' && <form className="pdf-message pdf-password" onSubmit={submitPassword}>
        <label>{wrongPassword ? t('密码不正确，请重新输入') : t('这个 PDF 已加密，请输入密码')}<input type="password" autoFocus autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button type="submit" disabled={!password}>{t('打开')}</button>
      </form>}
      {phase === 'ready' && <div className="pdf-pages" style={{ width: Math.floor(widest * zoom.scale), ['--total-scale-factor' as string]: zoom.scale, ['--scale-factor' as string]: zoom.scale, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}>
        {sizes.map((size, index) => <div key={index} className="pdf-page" data-page={index + 1} aria-label={`${t('页码')} ${index + 1}`} ref={(element) => { if (element) pageElements.current.set(index + 1, element); else pageElements.current.delete(index + 1) }} style={{ width: Math.floor(size.width * zoom.scale), height: Math.floor(size.height * zoom.scale) }} />)}
      </div>}
    </div>
    {phase === 'ready' && <div className="pdf-bar" role="toolbar" aria-label={t('PDF 控制')}>
      <button type="button" className="icon-button" title={t('上一页')} aria-label={t('上一页')} disabled={page <= 1} onClick={() => scrollToPage(page - 1)}><ChevronUp aria-hidden="true" /></button>
      <form onSubmit={submitPage}><input aria-label={t('页码')} inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, '').slice(0, 6))} onBlur={() => setPageInput(String(page))} /><span>/ {sizes.length}</span></form>
      <button type="button" className="icon-button" title={t('下一页')} aria-label={t('下一页')} disabled={page >= sizes.length} onClick={() => scrollToPage(page + 1)}><ChevronDown aria-hidden="true" /></button>
      <span className="pdf-bar-divider" aria-hidden="true" />
      <button type="button" className="icon-button" title={t('缩小')} aria-label={t('缩小')} disabled={clampScale(zoom.scale / 1.15) === zoom.scale} onClick={() => changeZoom('zoom-out')}><ZoomOut aria-hidden="true" /></button>
      <span className="pdf-zoom" aria-live="polite">{Math.round(zoom.scale * 100)}%</span>
      <button type="button" className="icon-button" title={t('放大')} aria-label={t('放大')} disabled={clampScale(zoom.scale * 1.15) === zoom.scale} onClick={() => changeZoom('zoom-in')}><ZoomIn aria-hidden="true" /></button>
      <button type="button" className="icon-button" title={t('适应宽度')} aria-label={t('适应宽度')} aria-pressed={zoom.fit} onClick={() => changeZoom('zoom-reset')}><Maximize2 aria-hidden="true" /></button>
      {dark && <button type="button" className="icon-button" title={t('页面调暗')} aria-label={t('页面调暗')} aria-pressed={dim} onClick={toggleDim}><Moon aria-hidden="true" /></button>}
    </div>}
  </div>
}
