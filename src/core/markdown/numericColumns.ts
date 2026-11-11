/**
 * Display-only right alignment of number columns (T56). A column counts as numeric when every non-empty
 * body cell is a number (signs, currency, thousands separators, decimals and % allowed) and at least one is.
 * Columns with an explicit Markdown alignment keep it. Nothing is written back to the document.
 */
const NUMBER = /^[+\-−±]?(?:[¥$€£]\s?)?(?:\d{1,3}(?:[,，]\d{3})+|\d+)(?:\.\d+)?\s?[%‰]?$/

export const NUMERIC_CLASS = 'mino-num'

export function isNumericCell(text: string): boolean {
  return NUMBER.test(text.trim())
}

/** For each column of the body rows, whether it holds only numbers. */
export function numericColumns(bodyRows: readonly (readonly string[])[]): boolean[] {
  const width = Math.max(0, ...bodyRows.map((row) => row.length))
  return Array.from({ length: width }, (_, column) => {
    const cells = bodyRows.map((row) => (row[column] ?? '').trim()).filter((text) => text !== '')
    return cells.length > 0 && cells.every(isNumericCell)
  })
}

// Minimal HAST shapes, as in figures.ts.
type Text = { type: 'text'; value: string }
type Element = { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: Node[] }
type Node = Element | Text | { type: string; children?: Node[] }
type Root = { type: 'root'; children: Node[] }

const elements = (node: Element, tagName?: string): Element[] =>
  node.children.filter((child): child is Element => child.type === 'element' && (!tagName || (child as Element).tagName === tagName))
const textOf = (node: Node): string => node.type === 'text' ? (node as Text).value : ('children' in node ? node.children ?? [] : []).map(textOf).join('')

function markTable(table: Element) {
  const sections = elements(table).filter((child) => child.tagName === 'thead' || child.tagName === 'tbody')
  const rows = [...elements(table, 'tr'), ...sections.flatMap((section) => elements(section, 'tr'))]
  const cellsOf = (row: Element) => elements(row).filter((cell) => cell.tagName === 'td' || cell.tagName === 'th')
  const body = rows.filter((row) => cellsOf(row).some((cell) => cell.tagName === 'td'))
  const numeric = numericColumns(body.map((row) => cellsOf(row).map(textOf)))
  const aligned = new Set<number>()
  for (const row of rows) cellsOf(row).forEach((cell, column) => { if (cell.properties?.align) aligned.add(column) })
  for (const row of rows) {
    cellsOf(row).forEach((cell, column) => {
      if (!numeric[column] || aligned.has(column)) return
      const classes = cell.properties?.className
      cell.properties = { ...cell.properties, className: [...(Array.isArray(classes) ? classes : []), NUMERIC_CLASS] }
    })
  }
}

/** Runs after sanitizing and adds only a fixed class name. */
export function rehypeNumericColumns() {
  return (tree: Root) => {
    const visit = (node: Node) => {
      if (node.type === 'element' && (node as Element).tagName === 'table') { markTable(node as Element); return }
      if ('children' in node) for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}
