import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { insertImageCommand } from '@milkdown/kit/preset/commonmark'
import { callCommand } from '@milkdown/kit/utils'
import { editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import { toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand, turnIntoTextCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, insertHrCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
import { deleteRow, deleteColumn } from '@milkdown/kit/prose/tables'
import { insertTableCommand, addRowAfterCommand, addColAfterCommand, setAlignCommand } from '@milkdown/kit/preset/gfm'
import { toggleLinkCommand, updateLinkCommand, updateImageCommand } from '@milkdown/kit/preset/commonmark'
import { imageUrlsIn, rewriteImageUrls } from '../export/snapshot'
import { safeTextHandler } from './markdownStringify'

export type PendingAsset = { url: string; bytes: number[]; mime: string }
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
  private composing = false
  private savedSelection: { from: number; to: number; node: boolean } | null = null
  private savedLinkHref: string | null = null
  private readonly onToolbarChange?: (state: ToolbarState) => void
  private readonly onImageError?: (message: string | null) => void

  constructor(root: HTMLElement, markdown: string, onChange?: () => void, imageUrls: Map<string, string> = new Map(), recoveredAssets: Map<string, { bytes: number[]; mime: string }> = new Map(), pendingFiles: Map<string, File> = new Map(), onToolbarChange?: (state: ToolbarState) => void, onImageError?: (message: string | null) => void) {
    this.root = root
    this.persisted = imageUrls
    this.onToolbarChange = onToolbarChange
    this.onImageError = onImageError
    for (const [url, asset] of recoveredAssets) {
      const file = new File([new Uint8Array(asset.bytes)], 'recovered-image', { type: asset.mime })
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
        [CrepeFeature.ImageBlock]: {
          onUpload: async (file) => this.registerImage(file),
        },
      },
    })
    this.crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: { ...options.handlers, text: safeTextHandler },
      }))
    })
    this.crepe.on((listener) => {
      listener.markdownUpdated(() => { onChange?.(); this.emitToolbarState() })
      listener.selectionUpdated(() => this.emitToolbarState())
    })
  }

  async create(): Promise<void> {
    await this.crepe.create()
    this.root.addEventListener('paste', this.onPaste, true)
    this.root.addEventListener('drop', this.onDrop, true)
    this.root.addEventListener('dragover', this.onDragOver, true)
    this.root.addEventListener('click', this.onClick, true)
    this.root.addEventListener('compositionstart', this.onCompositionStart, true)
    this.root.addEventListener('compositionend', this.onCompositionEnd, true)
    this.created = true
    this.emitToolbarState()
  }

  private onCompositionStart = () => { this.composing = true; this.emitToolbarState() }
  private onCompositionEnd = () => { this.composing = false; this.emitToolbarState() }

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
      this.onToolbarChange?.({ ready: true, composing: this.composing, block, marks, canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0, inTable, linkHref: link?.attrs.href ?? null, imageAlt: selectedImage?.attrs.alt ?? null })
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

  runTableCommand(command: TableCommand): void {
    if (!this.created || this.composing) return
    const milkdown = {
      insert: () => callCommand(insertTableCommand.key, { row: 3, col: 3 }),
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
    if (target instanceof Element && target.closest('a[href]')) {
      event.preventDefault()
      event.stopPropagation()
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

  getMarkdown(): string {
    if (!this.created) throw new Error('Editor is not ready')
    return this.crepe.getMarkdown()
  }

  getPersistableMarkdown(): string {
    return rewriteImageUrls(this.getMarkdown(), this.persisted)
  }

  async pendingAssets(markdown: string, validate = true): Promise<PendingAsset[]> {
    const result: PendingAsset[] = []
    const referenced = new Set(imageUrlsIn(markdown))
    for (const [url, pending] of this.pending) {
      if (!referenced.has(url)) continue
      if (validate) await pending.validation
      result.push({ url, mime: pending.file.type, bytes: Array.from(new Uint8Array(await pending.file.arrayBuffer())) })
    }
    return result
  }

  pendingFiles(): Map<string, File> { return new Map(Array.from(this.pending, ([url, item]) => [url, item.file])) }

  hasPendingAssets(): boolean {
    if (!this.created) return this.pending.size > 0
    const referenced = new Set(imageUrlsIn(this.getMarkdown()))
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
    this.root.removeEventListener('paste', this.onPaste, true)
    this.root.removeEventListener('drop', this.onDrop, true)
    this.root.removeEventListener('dragover', this.onDragOver, true)
    this.root.removeEventListener('click', this.onClick, true)
    this.root.removeEventListener('compositionstart', this.onCompositionStart, true)
    this.root.removeEventListener('compositionend', this.onCompositionEnd, true)
    if (this.created) await this.crepe.destroy()
    if (revokeUrls) {
      for (const url of this.pending.keys()) URL.revokeObjectURL(url)
      for (const url of this.persisted.keys()) URL.revokeObjectURL(url)
    }
    this.created = false
  }
}
