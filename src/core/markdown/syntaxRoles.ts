import { defaultHighlightStyle } from '@codemirror/language'
import { tagHighlighter, tags, type Highlighter, type Tag } from '@lezer/highlight'

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

/**
 * Tokens CodeMirror's default style leaves uncolored, which left shell commands and JSON almost plain:
 * option flags and attributes, property names (JSON keys), and built-in commands.
 */
export const extraSyntax: readonly { tag: Tag; role: SyntaxRole }[] = [
  { tag: tags.attributeName, role: 'variable' },
  { tag: tags.propertyName, role: 'definition' },
  { tag: tags.standard(tags.variableName), role: 'atom' },
]

/** CSS class of a token role in preview and export markup. */
export const tokenClass = (role: SyntaxRole) => `tok-${role}`

/** Gives tokens the class of their role, for static highlighting outside CodeMirror. */
export const syntaxClassHighlighter: Highlighter = tagHighlighter([
  ...extraSyntax.map(({ tag, role }) => ({ tag, class: tokenClass(role) })),
  ...defaultHighlightStyle.specs
    .filter((spec) => typeof spec.color === 'string')
    .map((spec) => ({ tag: spec.tag, class: tokenClass(syntaxRole(spec.color as string)) })),
])
