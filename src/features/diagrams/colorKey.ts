/**
 * The part of the diagram options the app shell needs at startup: the roles of the user's own colors and
 * the one word they are written as. It is apart from `looks.ts` so that the shell does not carry the looks.
 */
export const diagramColorRoles = ['accent', 'node', 'border', 'line', 'text'] as const
export type DiagramColorRole = (typeof diagramColorRoles)[number]
export type DiagramCustomColors = Partial<Record<DiagramColorRole, string>>
export const noDiagramColors: DiagramCustomColors = Object.freeze({})

/** The custom colors as one word, for a data attribute and the key: the five roles in order, each six hex digits or empty. */
export function customColorsKey(custom: DiagramCustomColors): string { return diagramColorRoles.map((role) => custom[role]?.slice(1) ?? '').join('.') }
