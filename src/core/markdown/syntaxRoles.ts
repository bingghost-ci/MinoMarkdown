import { defaultHighlightStyle } from '@codemirror/language'
import { tagHighlighter, type Highlighter } from '@lezer/highlight'

/**
 * Code colors come from the reading style's syntax palette (`--syntax-<role>` in src/features/reading/css.ts).
 * The tag list is CodeMirror's default highlight style; its colors are mapped onto these roles, so the
 * editor (`codeTheme.ts`) and the preview and export highlighter color the same tokens the same way.
 */
export const syntaxRoles = ['keyword', 'atom', 'number', 'definition', 'variable', 'type', 'string', 'comment', 'meta', 'invalid', 'heading'] as const
export type SyntaxRole = (typeof syntaxRoles)[number]

const roleByColor: Record<string, SyntaxRole> = {
  '#708': 'keyword', '#219': 'atom', '#164': 'number', '#a11': 'string', '#e40': 'string', '#00f': 'definition', '#00c': 'definition',
  '#30a': 'variable', '#256': 'variable', '#085': 'type', '#167': 'type', '#940': 'comment', '#404740': 'meta', '#888': 'comment', '#f00': 'invalid',
}

export function syntaxRole(color: string): SyntaxRole {
  return roleByColor[color] ?? 'heading'
}

/** CSS class of a token role in preview and export markup. */
export const tokenClass = (role: SyntaxRole) => `tok-${role}`

/** Gives tokens the class of their role, for static highlighting outside CodeMirror. */
export const syntaxClassHighlighter: Highlighter = tagHighlighter(defaultHighlightStyle.specs
  .filter((spec) => typeof spec.color === 'string')
  .map((spec) => ({ tag: spec.tag, class: tokenClass(syntaxRole(spec.color as string)) })))
