import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { insertImageCommand } from '@milkdown/kit/preset/commonmark'
import { callCommand, insert } from '@milkdown/kit/utils'
import { commandsCtx, editorViewCtx, inputRulesCtx, prosePluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { closeHistory, undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import { toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInHeadingCommand, turnIntoTextCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, insertHrCommand, createCodeBlockCommand, clearTextInCurrentBlockCommand, wrapInBlockTypeCommand, listItemSchema, sinkListItemCommand, liftListItemCommand } from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history'
import { TextSelection, NodeSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { keymap as proseKeymap } from '@milkdown/kit/prose/keymap'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Prec } from '@codemirror/state'
import { keymap as codeKeymap } from '@codemirror/view'
import { deleteRow, deleteColumn } from '@milkdown/kit/prose/tables'
import { insertTableCommand, addRowAfterCommand, addColAfterCommand, setAlignCommand } from '@milkdown/kit/preset/gfm'
import { toggleLinkCommand, updateLinkCommand, updateImageCommand } from '@milkdown/kit/preset/commonmark'
import { rewriteImageUrls } from '../export/snapshot'
import { safeTextHandler } from './markdownStringify'
import { renderMermaidPreview } from '../diagrams/mermaid'
import { remarkDemoteCurrencyPlugin } from './mathEditor'
import { numericColumnsPlugin } from './numericColumns'
import { CREPE_INLINE_MATH_RULE, STRICT_INLINE_MATH_RULE } from '../../core/markdown/math'
import { isAssetUrl, relativeFromAssetUrl } from './assetUrl'
import { findKey, findPlugin, replacementFor, setFind, type FindOptions } from './find'
import { duplicateBlock, moveBlock } from './blockCommands'
import { textTransformTransaction, type TextTransform } from './textTransform'
import { linkPasteTransaction, parseTabularText, pastedLinkHref, tablePasteTransaction } from './smartPaste'
import { outlineFromDoc, type OutlineItem } from '../outline/outline'
import { readingCodeTheme } from './codeTheme'

export type PendingAsset = { url: string; bytes: Uint8Array<ArrayBuffer>; mime: string }
type PendingImage = { file: File; validation: Promise<void>; error: string | null }
export type EditorCommand = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'bold' | 'italic' | 'strike' | 'inlineCode' | 'clearFormat' | 'bullet' | 'ordered' | 'task' | 'indent' | 'outdent' | 'quote' | 'rule' | 'codeBlock' | 'undo' | 'redo'
export type ToolbarState = { ready: boolean; composing: boolean; block: string; marks: string[]; canUndo: boolean; canRedo: boolean; inTable: boolean; inList: boolean; linkHref: string | null; imageAlt: string | null }
export type TableCommand = 'insert' | 'row' | 'column' | 'deleteRow' | 'deleteColumn' | 'alignLeft' | 'alignCenter' | 'alignRight'

export class EditorAdapter {
  private readonly crepe: Crepe
  private readonly root: HTMLElement
  private readonly pending = new Map<string, PendingImage>()
  private readonly persisted = new Map<string, string>()
  private created = false
  /** Reading mode: the view is not editable, and every path this adapter adds that writes is closed too. */
  private readOnly = false
  private creation: Promise<void> | null = null
  private composing = false
  /** The document as the editor left it after loading, before any edit; see the `updated` listener. */
  private loadedDoc: ProseNode | null = null
  private edited = false
  private savedSelection: { from: number; to: number; node: boolean } | null = null
  private savedLinkHref: string | null = null
  private lastToolbarState = ''
  private readonly onToolbarChange?: (state: ToolbarState) => void
  private readonly onImageError?: (message: string | null) => void
  private readonly onLinkOpen?: (href: string) => void
  private readonly onSelectionChange?: () => void

  constructor(root: HTMLElement, markdown: string, onChange?: () => void, imageUrls: Map<string, string> = new Map(), recoveredAssets: Map<string, { bytes: Uint8Array<ArrayBuffer>; mime: string }> = new Map(), pendingFiles: Map<string, File> = new Map(), onToolbarChange?: (state: ToolbarState) => void, onImageError?: (message: string | null) => void, onTableRequest?: (anchor: { x: number; y: number }) => void, onLinkOpen?: (href: string) => void, onSelectionChange?: () => void) {
    this.root = root
    this.onSelectionChange = onSelectionChange
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
        [CrepeFeature.Latex]: true,
        [CrepeFeature.TopBar]: false,
      },
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          theme: readingCodeTheme,
          renderPreview: renderMermaidPreview,
          // Inside a code block these keys would otherwise never reach the document.
          extensions: [Prec.high(codeKeymap.of([
            { key: 'Alt-ArrowUp', run: () => this.runBlockCommand(moveBlock(-1)) },
            { key: 'Alt-ArrowDown', run: () => this.runBlockCommand(moveBlock(1)) },
            { key: 'Mod-Shift-d', run: () => this.runBlockCommand(duplicateBlock) },
          ]))],
        },
        [CrepeFeature.Latex]: { katexOptions: { trust: false, strict: 'ignore' } },
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
    this.crepe.editor.use(remarkDemoteCurrencyPlugin).config((ctx) => {
      ctx.update(prosePluginsCtx, (plugins) => plugins.concat(findPlugin, numericColumnsPlugin, proseKeymap({ 'Alt-ArrowUp': moveBlock(-1), 'Alt-ArrowDown': moveBlock(1), 'Mod-Shift-d': duplicateBlock })))
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: { ...options.handlers, text: safeTextHandler },
      }))
    })
    this.crepe.on((listener) => {
      // `updated` avoids the full Markdown serialization `markdownUpdated` performs on every change.
      listener.updated((_ctx, doc) => {
        // The editor changes the document by itself while it loads: heading IDs, and an empty paragraph after a
        // closing code block, list or table. Those are not edits, and neither is anything in reading mode, where
        // every writing path is closed; reporting them marked an untouched document as modified.
        if (!this.edited && (this.readOnly || (this.loadedDoc !== null && doc.eq(this.loadedDoc)))) { this.emitToolbarState(); return }
        this.edited = true
        onChange?.()
        this.emitToolbarState()
      })
      listener.selectionUpdated(() => { this.emitToolbarState(); this.onSelectionChange?.() })
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
    // Crepe's rule turns typed prices such as "$5 and $" into a formula.
    this.crepe.editor.action((ctx) => {
      for (const rule of ctx.get(inputRulesCtx) as unknown as { match: RegExp }[]) if (rule.match.source === CREPE_INLINE_MATH_RULE) rule.match = STRICT_INLINE_MATH_RULE
    })
    this.root.addEventListener('error', this.onResourceError, true)
    this.root.addEventListener('paste', this.onPaste, true)
    this.root.addEventListener('drop', this.onDrop, true)
    this.root.addEventListener('dragover', this.onDragOver, true)
    this.root.addEventListener('click', this.onClick, true)
    this.root.addEventListener('compositionstart', this.onCompositionStart, true)
    this.root.addEventListener('compositionend', this.onCompositionEnd, true)
    this.root.addEventListener('keydown', this.onBackslashShortcut, true)
    this.crepe.editor.action((ctx) => { this.loadedDoc = ctx.get(editorViewCtx).state.doc })
    this.created = true
    this.emitToolbarState()
  }

  private onCompositionStart = () => { this.composing = true; this.emitToolbarState() }
  private onCompositionEnd = () => { this.composing = false; this.emitToolbarState() }
  private onBackslashShortcut = (event: KeyboardEvent) => {
    if (event.key !== '\\' || event.metaKey || event.ctrlKey || event.altKey || this.composing || !this.created || this.readOnly) return
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
        if (type === 'list_item' && $from.node(depth).attrs.checked != null) { block = 'task_list'; break }
        if (type === 'bullet_list' || type === 'ordered_list' || type === 'blockquote') { block = type; break }
      }
      const marks = (state.storedMarks ?? $from.marks()).map((mark) => mark.type.name)
      const link = (state.storedMarks ?? $from.marks()).find((mark) => mark.type.name === 'link')
      const selectedImage = state.selection instanceof NodeSelection && state.selection.node.type.name === 'image' ? state.selection.node : null
      const inTable = Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name).includes('table')
      const inList = Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name).includes('list_item')
      const next: ToolbarState = { ready: true, composing: this.composing, block, marks, canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0, inTable, inList, linkHref: link?.attrs.href ?? null, imageAlt: selectedImage?.attrs.alt ?? null }
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

  /** Menu commands act on the body only while it holds focus, not a code block, the find bar or a dialog. */
  hasEditorFocus(): boolean {
    let focused = false
    if (this.created && !this.composing) this.crepe.editor.action((ctx) => { focused = ctx.get(editorViewCtx).hasFocus() })
    return focused
  }

  /** Switches reading mode without rebuilding Crepe, so undo history, selection and dirty state are kept. */
  setReadonly(value: boolean): void {
    if (this.readOnly === value && this.created) return
    this.readOnly = value
    this.crepe.setReadonly(value)
  }

  isReadonly(): boolean { return this.readOnly }

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
    if (!this.created || this.composing || this.readOnly) return
    const wasLinked = this.savedLinkHref !== null
    this.restoreSelection()
    this.savedLinkHref = null
    this.crepe.editor.action(callCommand((wasLinked ? updateLinkCommand : toggleLinkCommand).key, { href }))
    this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    this.emitToolbarState()
  }

  setImageAlt(alt: string): void {
    if (!this.created || this.composing || this.readOnly) return
    this.restoreSelection()
    this.crepe.editor.action(callCommand(updateImageCommand.key, { alt }))
    this.focus()
    this.emitToolbarState()
  }

  runTableCommand(command: TableCommand, rows = 3, columns = 3): void {
    if (!this.created || this.composing || this.readOnly) return
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
    if (!this.created || this.composing || this.readOnly) return
    if (command === 'task') { this.toggleTaskList(); this.emitToolbarState(); return }
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
      indent: sinkListItemCommand,
      outdent: liftListItemCommand,
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

  /** Flips the selected list items between task and plain; outside a list it wraps the block as a task. */
  private toggleTaskList(): void {
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc, selection } = view.state
      const items = new Set<number>()
      doc.nodesBetween(selection.from, selection.to, (node, position, parent) => {
        if (node.isTextblock && parent?.type.name === 'list_item') items.add(doc.resolve(position).before())
        return !node.isTextblock
      })
      if (items.size === 0) ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType: listItemSchema.type(ctx), attrs: { checked: false } })
      else {
        const positions = [...items]
        const checked = doc.nodeAt(positions[0])?.attrs.checked == null ? false : null
        const tr = view.state.tr
        for (const position of positions) tr.setNodeAttribute(position, 'checked', checked)
        view.dispatch(tr)
      }
      view.focus()
    })
  }

  runTextTransform(kind: TextTransform): void {
    if (!this.created || this.composing || this.readOnly) return
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = textTransformTransaction(view.state, kind)
      if (tr) view.dispatch(tr)
      view.focus()
    })
    this.emitToolbarState()
  }

  private runBlockCommand(command: Command): boolean {
    if (!this.created || this.composing) return false
    let handled = false
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      handled = command(view.state, view.dispatch, view)
      if (handled) view.focus()
    })
    return handled
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

  /**
   * Inserts Markdown as rich content (T72): `replace` puts it in place of the selection, `after` leaves
   * the selection and adds it behind. Closing the history first makes the insertion its own undo step.
   */
  insertMarkdown(markdown: string, placement: 'replace' | 'after'): void {
    if (this.readOnly) throw new Error('READING_MODE')
    if (!this.created || this.composing) throw new Error('EDITOR_NOT_READY')
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let tr = closeHistory(view.state.tr)
      if (placement === 'after') tr = tr.setSelection(TextSelection.near(tr.doc.resolve(view.state.selection.to), 1))
      view.dispatch(tr)
    })
    this.crepe.editor.action(insert(markdown))
    this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    this.emitToolbarState()
  }

  /** The selected text with the text just before and after it; null when nothing is selected. */
  selectionContext(span = 1500): { selection: string; before: string; after: string } | null {
    let result: { selection: string; before: string; after: string } | null = null
    if (this.created) this.crepe.editor.action((ctx) => {
      const { doc, selection } = ctx.get(editorViewCtx).state
      if (selection.empty) return
      const text = (from: number, to: number) => doc.textBetween(Math.max(0, from), Math.min(doc.content.size, to), '\n', ' ')
      result = { selection: text(selection.from, selection.to), before: text(selection.from - span, selection.from), after: text(selection.to, selection.to + span) }
    })
    return result
  }

  insertFile(file: File): void {
    if (this.readOnly) throw new Error('READING_MODE')
    if (!this.created || this.composing) throw new Error('EDITOR_NOT_READY')
    const url = this.registerImage(file)
    this.crepe.editor.action(callCommand(insertImageCommand.key, { src: url, alt: file.name || '图片' }))
  }

  replaceSelectedImage(file: File): void {
    if (this.readOnly) throw new Error('READING_MODE')
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
    if (!this.created || this.readOnly) return
    const text = event.clipboardData?.getData('text/plain') ?? ''
    // Spreadsheets also offer a picture of the cells, so regular tabular text wins over that image.
    if (this.applyPaste(event, (state) => { const rows = parseTabularText(text); return rows && tablePasteTransaction(state, rows) })) return
    const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith('image/'))
    if (file) {
      event.preventDefault()
      event.stopPropagation()
      try { this.insertFile(file) }
      catch (error) { this.onImageError?.(String(error)) }
      return
    }
    this.applyPaste(event, (state) => { const href = pastedLinkHref(text); return href && linkPasteTransaction(state, href) })
  }

  /** Runs a paste rule while the body itself has focus; pastes into a code block stay verbatim. */
  private applyPaste(event: ClipboardEvent, rule: (state: EditorState) => Transaction | null | ''): boolean {
    if (this.composing) return false
    let applied = false
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (!view.hasFocus()) return
      const tr = rule(view.state)
      if (!tr) return
      event.preventDefault()
      event.stopPropagation()
      view.dispatch(tr)
      applied = true
    })
    return applied
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
      // While reading, a plain click follows the link as in a book viewer; while editing it takes ⌘.
      if (event.metaKey || this.readOnly) this.onLinkOpen?.(anchor.getAttribute('href') ?? '')
    }
  }

  private onDrop = (event: DragEvent): void => {
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('image/'))
    if (!file || !this.created || this.readOnly) return
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
  find(query: string, options?: FindOptions): { current: number; total: number } {
    return this.updateFind((tr) => setFind(tr, { query, options }))
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
    if (this.composing || this.readOnly) return this.findCounts()
    return this.updateFind((tr, find) => {
      const match = find?.matches[find.index]
      if (!match) return tr
      const replacement = replacementFor(match, text)
      return replacement ? tr.insertText(replacement, match.from, match.to) : tr.delete(match.from, match.to)
    }, true)
  }

  replaceAll(text: string): { current: number; total: number } {
    if (this.composing || this.readOnly) return this.findCounts()
    return this.updateFind((tr, find) => {
      for (const match of [...(find?.matches ?? [])].reverse()) {
        const replacement = replacementFor(match, text)
        if (replacement) tr.insertText(replacement, match.from, match.to); else tr.delete(match.from, match.to)
      }
      return closeHistory(tr)
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

  /** The document's readable text and, when text is selected, that selection. No Markdown is involved. */
  plainText(): { text: string; selected: string | null } {
    let result: { text: string; selected: string | null } = { text: '', selected: null }
    if (this.created) this.crepe.editor.action((ctx) => {
      const { doc, selection } = ctx.get(editorViewCtx).state
      result = { text: doc.textBetween(0, doc.content.size, '\n', ' '), selected: selection.empty ? null : doc.textBetween(selection.from, selection.to, '\n', ' ') }
    })
    return result
  }

  outline(): OutlineItem[] {
    if (!this.created) return []
    let items: OutlineItem[] = []
    this.crepe.editor.action((ctx) => { items = outlineFromDoc(ctx.get(editorViewCtx).state.doc) })
    return items
  }

  /** Moves the view and caret to a heading. A selection change adds nothing to the undo history. */
  revealHeading(pos: number): void {
    if (!this.created) return
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (pos > view.state.doc.content.size || view.state.doc.nodeAt(pos)?.type.name !== 'heading') return
      if (!this.composing) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)))
      const element = view.nodeDOM(pos)
      if (element instanceof HTMLElement) element.scrollIntoView({ block: 'start' })
      if (!this.composing) view.focus()
    })
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
