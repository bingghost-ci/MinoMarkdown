/**
 * The token roles a reading style colors (`--syntax-<role>` in src/features/reading/css.ts). They are kept apart
 * from `syntaxRoles.ts`, which maps CodeMirror's tags onto them: the style sheet is built at startup and needs
 * only the names, and importing the mapping pulled all of CodeMirror into the app's entry bundle (T98).
 */
export const syntaxRoles = ['keyword', 'atom', 'number', 'definition', 'variable', 'type', 'string', 'comment', 'meta', 'invalid', 'heading'] as const
export type SyntaxRole = (typeof syntaxRoles)[number]

/** CSS class of a token role in preview and export markup. */
export const tokenClass = (role: SyntaxRole) => `tok-${role}`
