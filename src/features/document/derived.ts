import type { OutlineItem } from '../outline/outline'

/** Whether two outlines show the same thing, so an unchanged one need not be rendered again. */
export function sameOutline(a: readonly OutlineItem[], b: readonly OutlineItem[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index) => item.level === b[index].level && item.target === b[index].target && item.text === b[index].text))
}

/**
 * Counts a document and its selection. Moving the caret changes only the selection, so the count of the whole
 * text is kept until the text itself changes (T93).
 */
export function createWordCounter(count: (text: string) => Promise<number>): (text: string, selected: string | null) => Promise<{ total: number; selected: number | null }> {
  let last: { text: string; total: number } | null = null
  return async (text, selected) => {
    const [total, selectedTotal] = await Promise.all([last?.text === text ? last.total : count(text), selected === null ? null : count(selected)])
    last = { text, total }
    return { total, selected: selectedTotal }
  }
}
