import { EditorView } from '@codemirror/view'
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { extraSyntax, syntaxRole } from '../../core/markdown/syntaxRoles'

/**
 * Code blocks follow the reading style: every color is a CSS variable set by the style's code palette
 * (light, warm or night in src/features/reading/css.ts), so a style change needs no editor rebuild.
 * The tag list is CodeMirror's default highlight style with its colors mapped onto those variables; preview and
 * export use the same mapping (src/core/markdown/syntaxRoles.ts).
 */

const styleHighlight = HighlightStyle.define([
  ...extraSyntax.map(({ tag, role }) => ({ tag, color: `var(--syntax-${role})` })),
  ...defaultHighlightStyle.specs.map((spec) => (typeof spec.color === 'string' ? { ...spec, color: `var(--syntax-${syntaxRole(spec.color)})` } : spec)),
])

const frame = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { caretColor: 'var(--text)', fontFamily: 'var(--code-font)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-matchingBracket': { backgroundColor: 'var(--selected)', outline: 'none' },
})

export const readingCodeTheme = [frame, syntaxHighlighting(styleHighlight)]
