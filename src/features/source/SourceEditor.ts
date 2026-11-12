import { Annotation, Compartment, EditorState, Transaction, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { detectLineEndings, offsetToPosition, positionToOffset, sourceDoc, sourceValue, type LineEndings } from './sourceText'

type Callbacks = { onChange: () => void; onSelect: () => void }
/** `markdown` for Markdown source; `plain` for text and source files, whose language (if any) is set after it loads. */
export type SourceLanguage = 'markdown' | 'plain'

/** Changes the app makes itself. As with assigning to a textarea, these do not count as user edits. */
const programmatic = Annotation.define<boolean>()

const theme = EditorView.theme({
  '&': { flex: '1', minHeight: '0', color: 'var(--text)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { padding: 'var(--source-padding-block) var(--source-padding-inline)', fontFamily: 'var(--code-font, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 'var(--editor-font-size)', lineHeight: 'var(--editor-line-height)' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { border: 'none', backgroundColor: 'transparent', color: 'var(--muted)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selected)' },
})

const highlight = (dark: boolean): Extension => syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true })
const lineHandling = (endings: LineEndings): Extension => endings.mixed ? [EditorState.lineSeparator.of('\n'), highlightSpecialChars()] : []

/** Exposes the textarea-shaped surface the workspace uses, with offsets into the exact saved text. */
export class SourceEditor {
  private readonly view: EditorView
  private readonly readOnlyMode = new Compartment()
  private readonly highlightMode = new Compartment()
  private readonly lineMode = new Compartment()
  private readonly languageMode = new Compartment()
  private endings: LineEndings
  private cachedValue: string | null

  constructor(parent: HTMLElement, text: string, label: string, dark: boolean, callbacks: Callbacks, language: SourceLanguage = 'markdown', readOnly = false) {
    this.endings = detectLineEndings(text)
    this.cachedValue = text
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: sourceDoc(text, this.endings),
        extensions: [
          this.lineMode.of(lineHandling(this.endings)),
          this.readOnlyMode.of(EditorState.readOnly.of(readOnly)),
          this.highlightMode.of(highlight(dark)),
          lineNumbers(),
          history(),
          drawSelection(),
          this.languageMode.of(language === 'markdown' ? markdown() : []),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.cachedValue = null
              if (!update.transactions.some((transaction) => transaction.annotation(programmatic))) callbacks.onChange()
            }
            if (update.selectionSet) callbacks.onSelect()
          }),
        ],
      }),
    })
  }

  get value(): string {
    this.cachedValue ??= sourceValue(this.view.state.doc, this.endings)
    return this.cachedValue
  }

  set value(text: string) {
    if (text === this.value) return
    this.endings = detectLineEndings(text)
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: sourceDoc(text, this.endings) },
      effects: this.lineMode.reconfigure(lineHandling(this.endings)),
      annotations: [programmatic.of(true), Transaction.addToHistory.of(false)],
    })
    this.cachedValue = text
  }

  get selectionStart(): number { return positionToOffset(this.view.state.doc, this.view.state.selection.main.from, this.endings) }
  get selectionEnd(): number { return positionToOffset(this.view.state.doc, this.view.state.selection.main.to, this.endings) }

  setSelectionRange(start: number, end: number): void {
    const { doc } = this.view.state
    this.view.dispatch({ selection: { anchor: offsetToPosition(doc, start, this.endings), head: offsetToPosition(doc, end, this.endings) } })
  }

  set readOnly(locked: boolean) {
    this.view.dispatch({ effects: this.readOnlyMode.reconfigure(EditorState.readOnly.of(locked)) })
  }

  focus(): void { this.view.focus() }

  /** Scrolls the offset to the top of the viewport, leaving `marginLines` of context above it. */
  reveal(offset: number, marginLines: number): void {
    const position = offsetToPosition(this.view.state.doc, offset, this.endings)
    this.view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: marginLines * this.view.defaultLineHeight }) })
  }

  /** Applies all replacements as one undo step. The caller reports the edit to the session. */
  replaceRanges(ranges: { from: number; to: number; insert: string }[]): void {
    const { doc } = this.view.state
    this.view.dispatch({
      changes: ranges.map(({ from, to, insert }) => ({ from: offsetToPosition(doc, from, this.endings), to: offsetToPosition(doc, to, this.endings), insert })),
      annotations: programmatic.of(true),
    })
  }

  /** Colors a source file once its language package has loaded (T85). */
  setLanguage(language: Extension): void {
    this.view.dispatch({ effects: this.languageMode.reconfigure(language) })
  }

  setDark(dark: boolean): void {
    this.view.dispatch({ effects: this.highlightMode.reconfigure(highlight(dark)) })
  }

  destroy(): void { this.view.destroy() }
}
