import { readingStyles, type StyleId } from '../features/reading/styles'

export type { ThemeId } from '../features/reading/styles'

/** Theme menu entries: following the system first, then every reading style in catalog order. */
export const themeOptions: readonly { id: 'system' | StyleId; label: string }[] = [{ id: 'system', label: '跟随系统' }, ...readingStyles.map((style) => ({ id: style.id, label: style.name }))]
