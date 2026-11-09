import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { insertImageCommand } from '@milkdown/kit/preset/commonmark'
import { callCommand } from '@milkdown/kit/utils'
import { commandsCtx, editorViewCtx, prosePluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import { toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand, turnIntoTextCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, insertHrCommand, createCodeBlockCommand, clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { TextSelection, NodeSelection, type Transaction } from '@milkdown/kit/prose/state'
import { deleteRow, deleteColumn } from '@milkdown/kit/prose/tables'
import { insertTableCommand, addRowAfterCommand, addColAfterCommand, setAlignCommand } from '@milkdown/kit/preset/gfm'
import { toggleLinkCommand, updateLinkCommand, updateImageCommand } from '@milkdown/kit/preset/commonmark'
import { rewriteImageUrls } from '../export/snapshot'
import { safeTextHandler } from './markdownStringify'
import { isAssetUrl, relativeFromAssetUrl } from './assetUrl'
import { findKey, findPlugin, setFind } from './find'

export type PendingAsset = { url: string; bytes: Uint8Array<ArrayBuffer>; mime: string }
type PendingImage = { file: File; validation: Promise<void>; error: string | null }
export type EditorCommand = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'bold' | 'italic' | 'strike' | 'inlineCode' | 'clearFormat' | 'bullet' | 'ordered' | 'quote' | 'rule' | 'codeBlock' | 'undo' | 'redo'
export type ToolbarState = { ready: boolean; composing: boolean; block: string; marks: string[]; canUndo: boolean; canRedo: boolean; inTable: boolean; linkHref: string | null; imageAlt: string | null }
export type TableCommand = 'insert' | 'row' | 'column' | 'deleteRow' | 'deleteColumn' | 'alignLeft' | 'alignCenter' | 'alignRight'

export class EditorAdapter {
  private readonly crepe: Crepe
  private readonly root: HTMLElement
  private readonly pending = new Map<string, PendingImage>()
  private readonly persisted = new Map<string, string>()
  private created = false
  private creation: Promise<void> | null = null
  private composing = false
  private savedSelection: { from: number; to: number; node: boolean } | null = null
  private savedLinkHref: string | null = null
  private lastToolbarState = ''
  private readonly onToolbarChange?: (state: ToolbarState) => void
  private readonly onImageError?: (message: string | null) => void
  private readonly onLinkOpen?: (href: string) => void

  constructor(root: HTMLElement, markdown: string, onChange?: () => void, imageUrls: Map<string, string> = new Map(), recoveredAssets: Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string }> = new Map(), pendingFiles: Map<string, File> = new Map(), onToolbarChange?: (state: ToolbarState) => void, onImageError?: (message: string | null) => void, onTableRequest?: (anchor: { x: number; y: number }) => void, onLinkOpen?: (href: string) => void) {
    this.root = root
    this.onLinkOpen = onLinkOpen
    this.persisted = imageUrls
    this.onToolbarChange = onToolbarChange
    this.onImageError = onImageError
    for (const [url, asset] of recoveredAssets) {
      const file = new File([asset.bytes], 'recovered-image', { type: asset.mime })
      this.pending.set(url, { file, validation: Promise.resolve(), error: null })
    }
    for (const [url, file] of pendingFiles) this.pending.set(url, { file, validation: Promise.resolve(), error: null })
    this.crepe = new Crepe({
      root,
      defaultValue: markdown,
      features: {
        [CrepeFeature.AI]: false,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.TopBar]: false,
      },
      featureConfigs: {
        [CrepeFeature.BlockEdit]: {
          buildMenu: (builder) => {
            const table = builder.getGroup('advanced').group.items.find((item) => item.key === 'table')
            if (!table) return
            table.onRun = (ctx) => {
              ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
              const view = ctx.get(editorViewCtx)
              const { from, to } = view.state.selection
              this.savedSelection = { from, to, node: false }
              const rect = view.coordsAtPos(from)
              onTableRequest?.({ x: rect.left, y: rect.bottom })
            }
          },
        },
        [CrepeFeature.ImageBlock]: {
          onUpload: async (file) => this.registerImage(file),
          maxWidth: 880,
        },
      },
    })
    this.crepe.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (plugins) => plugins.concat(findPlugin))
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: { ...options.handlers, text: safeTextHandler },
      }))
    })
    this.crepe.on((listener) => {
      // `updated` avoids the full Markdown serialization `markdownUpdated` performs on every change.
      listener.updated(() => { onChange?.(); this.emitToolbarState() })
      listener.selectionUpdated(() => this.emitToolbarState())
    })
  }

  get rootElement(): HTMLElement { return this.root }

  create(): Promise<void> {
    this.creation ??= this.start()
    return this.creation
  }

  /** Re-publishes state after this editor comes back from the pool. */
  resume(): void {
    this.lastToolbarState = ''
    this.emitToolbarState()
    this.focus()
  }

  dispose(): void {
    void (this.creation ?? Promise.resolve()).catch(() => undefined).then(() => this.destroy(false)).catch(() => undefined)
  }

  private async start(): Promise<void> {
    await this.crepe.create()
    this.root.addEventListener('error', this.onResourceError, true)
    this.root.addEventListener('paste', this.onPaste, true)
    this.root.addEventListener('drop', this.onDrop, true)
    this.root.addEventListener('dragover', this.onDragOver, true)
    this.root.addEventListener('click', this.onClick, true)
    this.root.addEventListener('compositionstart', this.onCompositionStart, true)
    this.root.addEventListener('compositionend', this.onCompositionEnd, true)
    this.root.addEventListener('keydown', this.onBackslashShortcut, true)
    this.created = true
    this.emitToolbarState()
  }

  private onCompositionStart = () => { this.composing = true; this.emitToolbarState() }
  private onCompositionEnd = () => { this.composing = false; this.emitToolbarState() }
  private onBackslashShortcut = (event: KeyboardEvent) => {
    if (event.key !== '\\' || event.metaKey || event.ctrlKey || event.altKey || this.composing || !this.created) return
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { selection } = view.state
      if (!selection.empty || selection.$from.parent.type.name !== 'paragraph' || selection.$from.parent.textContent !== '') return
      event.preventDefault()
      view.dispatch(view.state.tr.insertText('/'))
    })
  }

  private emitToolbarState(): void {
    if (!this.created || !this.onToolbarChange) return
    this.crepe.editor.action((ctx) => {
      const state = ctx.get(editorViewCtx).state
      const { $from } = state.selection
      let block = $from.parent.type.name
      if (block === 'heading') block = `heading${$from.parent.attrs.level}`
      for (let depth = $from.depth; depth > 0; depth--) {
        const type = $from.node(depth).type.name
        if (type === 'bullet_list' || type === 'ordered_list' || type === 'blockquote') { block = type; break }
      }
      const marks = (state.storedMarks ?? $from.marks()).map((mark) => mark.type.name)
      const link = (state.storedMarks ?? $from.marks()).find((mark) => mark.type.name === 'link')
      const selectedImage = state.selection instanceof NodeSelection && state.selection.node.type.name === 'image' ? state.selection.node : null
      const inTable = Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name).includes('table')
      const next: ToolbarState = { ready: true, composing: this.composing, block, marks, canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0, inTable, linkHref: link?.attrs.href ?? null, imageAlt: selectedImage?.attrs.alt ?? null }
      const serialized = JSON.stringify(next)
      if (serialized === this.lastToolbarState) return
      this.lastToolbarState = serialized
      this.onToolbarChange?.(next)
    })
  }

  captureSelection(): string | null {
    if (!this.created) return null
    let href: string | null = null
    this.crepe.editor.action((ctx) => {
      const state = ctx.get(editorViewCtx).state
      const selection = state.selection
      const { from, to, $from } = selection
      this.savedSelection = { from, to, node: selection instanceof NodeSelection }
      href = ((state.storedMarks ?? $from.marks()).find((mark) => mark.type.name === 'link')?.attrs.href as string | undefined) ?? null
      if (!href) {
        const end = Math.min(from === to ? to + 1 : to, state.doc.content.size)
        state.doc.nodesBetween(from, end, (node) => {
          const link = node.marks.find((mark) => mark.type.name === 'link')
          if (link) { href = link.attrs.href as string; return false }
          return undefined
        })
      }
      this.savedLinkHref = href
    })
    return href
  }

  focus(): void {
    if (this.created) this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
  }

  private restoreSelection(): void {
    if (!this.savedSelection) return
    const saved = this.savedSelection
    this.savedSelection = null
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const max = view.state.doc.content.size
      const from = Math.min(saved.from, max)
      const to = Math.min(saved.to, max)
      view.dispatch(view.state.tr.setSelection(saved.node && from < max ? NodeSelection.create(view.state.doc, from) : TextSelection.create(view.state.doc, from, to)))
    })
  }

  setLink(href: string): void {
    if (!this.created || this.composing) return
    const wasLinked = this.savedLinkHref !== null
    this.restoreSelection()
    this.savedLinkHref = null
    this.crepe.editor.action(callCommand((wasLinked ? updateLinkCommand : toggleLinkCommand).key, { href }))
    this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    this.emitToolbarState()
  }

  setImageAlt(alt: string): void {
    if (!this.created || this.composing) return
    this.restoreSelection()
    this.crepe.editor.action(callCommand(updateImageCommand.key, { alt }))
    this.focus()
    this.emitToolbarState()
  }

  runTableCommand(command: TableCommand, rows = 3, columns = 3): void {
    if (!this.created || this.composing) return
    if (command === 'insert') this.restoreSelection()
    const milkdown = {
      insert: () => callCommand(insertTableCommand.key, { row: rows, col: columns }),
      row: () => callCommand(addRowAfterCommand.key),
      column: () => callCommand(addColAfterCommand.key),
      alignLeft: () => callCommand(setAlignCommand.key, 'left'),
      alignCenter: () => callCommand(setAlignCommand.key, 'center'),
      alignRight: () => callCommand(setAlignCommand.key, 'right'),
    }
    if (command === 'deleteRow' || command === 'deleteColumn') {
      this.crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        ;(command === 'deleteRow' ? deleteRow : deleteColumn)(view.state, view.dispatch)
        view.focus()
      })
    } else this.crepe.editor.action(milkdown[command]())
    if (command === 'insert') this.focus()
    this.emitToolbarState()
  }

  runCommand(command: EditorCommand): void {
    if (!this.created || this.composing) return
    const commands = {
      paragraph: turnIntoTextCommand,
      heading1: wrapInHeadingCommand,
      heading2: wrapInHeadingCommand,
      heading3: wrapInHeadingCommand,
      heading4: wrapInHeadingCommand,
      heading5: wrapInHeadingCommand,
      heading6: wrapInHeadingCommand,
      bold: toggleStrongCommand,
      italic: toggleEmphasisCommand,
      strike: toggleStrikethroughCommand,
      inlineCode: toggleInlineCodeCommand,
      bullet: wrapInBulletListCommand,
      ordered: wrapInOrderedListCommand,
      quote: wrapInBlockquoteCommand,
      rule: insertHrCommand,
      codeBlock: createCodeBlockCommand,
      undo: undoCommand,
      redo: redoCommand,
    }
    if (command === 'clearFormat') {
      this.crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { from, to } = view.state.selection
        view.dispatch(view.state.tr.removeMark(from, to).setStoredMarks([]))
        view.focus()
      })
    } else {
      const level = command.startsWith('heading') ? Number(command.slice(-1)) : undefined
      this.crepe.editor.action(callCommand(commands[command].key, level as never))
      this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    }
    this.emitToolbarState()
  }

  private registerImage(file: File): string {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 和 GIF 图片')
    if (file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB 或为空')
    const url = URL.createObjectURL(file)
    const pending: PendingImage = { file, validation: Promise.resolve(), error: null }
    pending.validation = this.validateImage(file).catch((error: unknown) => { pending.error = String(error); this.onImageError?.(pending.error); throw error })
    // Validation errors are shown when saving; keep the node and bytes for a retry.
    void pending.validation.catch(() => undefined)
    this.pending.set(url, pending)
    return url
  }

  private async validateImage(file: File): Promise<void> {
    if (file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB 或为空')
    if (typeof createImageBitmap !== 'function') throw new Error('当前系统无法解码该图片')
    const decoded = await createImageBitmap(file)
    try { if (decoded.width * decoded.height > 40_000_000 || !decoded.width || !decoded.height) throw new Error('图片像素超过 4000 万或尺寸无效') }
    finally { decoded.close() }
  }

  insertFile(file: File): void {
    if (!this.created || this.composing) throw new Error('EDITOR_NOT_READY')
    const url = this.registerImage(file)
    this.crepe.editor.action(callCommand(insertImageCommand.key, { src: url, alt: file.name || '图片' }))
  }

  replaceSelectedImage(file: File): void {
    if (!this.created || this.composing) throw new Error('EDITOR_NOT_READY')
    this.restoreSelection()
    const url = this.registerImage(file)
    this.crepe.editor.action(callCommand(updateImageCommand.key, { src: url, alt: file.name || '图片' }))
  }

  async retryFailedImages(): Promise<void> {
    const failures = Array.from(this.pending.values()).filter((item) => item.error)
    this.onImageError?.(null)
    for (const item of failures) {
      item.error = null
      item.validation = this.validateImage(item.file).catch((error: unknown) => { item.error = String(error); this.onImageError?.(item.error); throw error })
      await item.validation.catch(() => undefined)
    }
  }

  // Load errors do not bubble, so this listens during capture. Attachments load lazily after the text.
  private onResourceError = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || !isAssetUrl(target.src)) return
    target.dataset.missing = 'true'
    this.onImageError?.(`图片无法读取：${relativeFromAssetUrl(target.src) ?? target.alt}`)
  }

  private onPaste = (event: ClipboardEvent): void => {
    const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'))
    if (!file || !this.created) return
    event.preventDefault()
    event.stopPropagation()
    try { this.insertFile(file) }
    catch (error) { this.onImageError?.(String(error)) }
  }

  private onDragOver = (event: DragEvent): void => {
    if (Array.from(event.dataTransfer?.files ?? []).some((item) => item.type.startsWith('image/'))) event.preventDefault()
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
    if (anchor) {
      event.preventDefault()
      event.stopPropagation()
      if (event.metaKey) this.onLinkOpen?.(anchor.getAttribute('href') ?? '')
    }
  }

  private onDrop = (event: DragEvent): void => {
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('image/'))
    if (!file || !this.created) return
    event.preventDefault()
    event.stopPropagation()
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (position) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))))
    })
    try { this.insertFile(file) }
    catch (error) { this.onImageError?.(String(error)) }
  }

  /** Highlights matches of `query` and returns the match count. */
  find(query: string): { current: number; total: number } {
    return this.updateFind((tr) => setFind(tr, { query }))
  }

  findStep(direction: 1 | -1): { current: number; total: number } {
    let total = 0
    let index = 0
    if (this.created) this.crepe.editor.action((ctx) => {
      const find = findKey.getState(ctx.get(editorViewCtx).state)
      total = find?.matches.length ?? 0
      index = find?.index ?? 0
    })
    if (total === 0) return { current: 0, total: 0 }
    return this.updateFind((tr) => setFind(tr, { index: (index + direction + total) % total }), true)
  }

  replaceCurrent(text: string): { current: number; total: number } {
    if (this.composing) return this.findCounts()
    return this.updateFind((tr, find) => {
      const match = find?.matches[find.index]
      return match ? (text ? tr.insertText(text, match.from, match.to) : tr.delete(match.from, match.to)) : tr
    }, true)
  }

  replaceAll(text: string): { current: number; total: number } {
    if (this.composing) return this.findCounts()
    return this.updateFind((tr, find) => {
      for (const match of [...(find?.matches ?? [])].reverse()) { if (text) tr.insertText(text, match.from, match.to); else tr.delete(match.from, match.to) }
      return tr
    })
  }

  private findCounts(): { current: number; total: number } {
    let result = { current: 0, total: 0 }
    if (this.created) this.crepe.editor.action((ctx) => {
      const find = findKey.getState(ctx.get(editorViewCtx).state)
      result = { current: find?.index ?? 0, total: find?.matches.length ?? 0 }
    })
    return result
  }

  private updateFind(change: (tr: Transaction, find: ReturnType<typeof findKey.getState>) => Transaction, reveal = false): { current: number; total: number } {
    if (!this.created) return { current: 0, total: 0 }
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(change(view.state.tr, findKey.getState(view.state)))
      const find = findKey.getState(view.state)
      const match = reveal ? find?.matches[find.index] : undefined
      if (match) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView())
    })
    return this.findCounts()
  }

  getMarkdown(): string {
    if (!this.created) throw new Error('Editor is not ready')
    return this.crepe.getMarkdown()
  }

  getPersistableMarkdown(): string {
    return rewriteImageUrls(this.getMarkdown(), this.persisted)
  }

  /** Image URLs in the live document, read from its nodes so no Markdown parsing is needed. */
  referencedImageUrls(): Set<string> {
    const urls = new Set<string>()
    if (!this.created) return urls
    this.crepe.editor.action((ctx) => {
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        if ((node.type.name === 'image' || node.type.name === 'image-block') && node.attrs.src) urls.add(node.attrs.src as string)
      })
    })
    return urls
  }

  /** Bytes of referenced pending images, except URLs in `skip`, which are only loaded when needed. */
  async pendingAssets(validate = true, skip: ReadonlySet<string> = new Set()): Promise<PendingAsset[]> {
    const result: PendingAsset[] = []
    const referenced = this.referencedImageUrls()
    for (const [url, pending] of this.pending) {
      if (!referenced.has(url) || skip.has(url)) continue
      if (validate) await pending.validation
      result.push({ url, mime: pending.file.type, bytes: new Uint8Array(await pending.file.arrayBuffer()) })
    }
    return result
  }

  pendingFiles(): Map<string, File> { return new Map(Array.from(this.pending, ([url, item]) => [url, item.file])) }

  hasPendingAssets(): boolean {
    if (!this.created) return this.pending.size > 0
    const referenced = this.referencedImageUrls()
    return Array.from(this.pending.keys()).some((url) => referenced.has(url))
  }

  isReady(): boolean { return this.created && !this.composing }

  markSaved(assetPaths: Record<string, string>): void {
    for (const [url, relative] of Object.entries(assetPaths)) {
      if (this.pending.has(url)) {
        this.pending.delete(url)
        this.persisted.set(url, relative)
      }
    }
  }

  async destroy(revokeUrls = true): Promise<void> {
    this.root.removeEventListener('error', this.onResourceError, true)
    this.root.removeEventListener('paste', this.onPaste, true)
    this.root.removeEventListener('drop', this.onDrop, true)
    this.root.removeEventListener('dragover', this.onDragOver, true)
    this.root.removeEventListener('click', this.onClick, true)
    this.root.removeEventListener('compositionstart', this.onCompositionStart, true)
    this.root.removeEventListener('compositionend', this.onCompositionEnd, true)
    this.root.removeEventListener('keydown', this.onBackslashShortcut, true)
    if (this.created) await this.crepe.destroy()
    if (revokeUrls) {
      for (const url of this.pending.keys()) URL.revokeObjectURL(url)
      for (const url of this.persisted.keys()) URL.revokeObjectURL(url)
    }
    this.created = false
  }
}
