import { defaultHighlightStyle } from '@codemirror/language'
import { tagHighlighter, tags, type Highlighter, type Tag } from '@lezer/highlight'
import { tokenClass, type SyntaxRole } from './syntaxRoleNames'

/**
 * Code colors come from the reading style's syntax palette (the roles in `syntaxRoleNames.ts`).
 * The tag list is CodeMirror's default highlight style; its colors are mapped onto these roles, so the
 * editor (`codeTheme.ts`) and the preview and export highlighter color the same tokens the same way.
 */

const roleByColor: Record<string, SyntaxRole> = {
  '#708': 'keyword', '#219': 'atom', '#164': 'number', '#a11': 'string', '#e40': 'string', '#00f': 'definition', '#00c': 'definition',
  '#30a': 'variable', '#256': 'variable', '#085': 'type', '#167': 'type', '#940': 'comment', '#404740': 'meta', '#888': 'comment', '#f00': 'invalid',
}

export function syntaxRole(color: string): SyntaxRole {
  return roleByColor[color] ?? 'heading'
}

/**
 * Tokens CodeMirror's default style leaves uncolored, which left most of a program in the text color: plain
 * variable names, calls, property names (JSON keys too), option flags and attributes, operators, and built-ins.
 * A more specific tag wins over a general one, so a called name is a `function` and not a `variable`.
 */
export const extraSyntax: readonly { tag: Tag; role: SyntaxRole }[] = [
  { tag: tags.variableName, role: 'variable' },
  { tag: tags.propertyName, role: 'property' },
  { tag: tags.attributeName, role: 'property' },
  { tag: tags.function(tags.variableName), role: 'function' },
  { tag: tags.function(tags.propertyName), role: 'function' },
  { tag: tags.function(tags.definition(tags.variableName)), role: 'function' },
  { tag: tags.standard(tags.variableName), role: 'atom' },
  { tag: tags.self, role: 'atom' },
  { tag: tags.operator, role: 'operator' },
]

/** Gives tokens the class of their role, for static highlighting outside CodeMirror. */
export const syntaxClassHighlighter: Highlighter = tagHighlighter([
  ...extraSyntax.map(({ tag, role }) => ({ tag, class: tokenClass(role) })),
  ...defaultHighlightStyle.specs
    .filter((spec) => typeof spec.color === 'string')
    .map((spec) => ({ tag: spec.tag, class: tokenClass(syntaxRole(spec.color as string)) })),
])
