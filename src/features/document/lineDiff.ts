export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }

const MAX_CELLS = 4_000_000

/** Line diff from `before` to `after`, or null when the changed region is too large to compare interactively. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const rows = endA - start
  const columns = endB - start
  if (rows * columns > MAX_CELLS) return null
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1))
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row][column] = a[start + row] === b[start + column] ? table[row + 1][column + 1] + 1 : Math.max(table[row + 1][column], table[row][column + 1])
    }
  }
  const result: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  let row = 0
  let column = 0
  while (row < rows || column < columns) {
    if (row < rows && column < columns && a[start + row] === b[start + column]) { result.push({ kind: 'same', text: a[start + row] }); row++; column++ }
    else if (row < rows && (column === columns || table[row + 1][column] >= table[row][column + 1])) result.push({ kind: 'removed', text: a[start + row++] })
    else result.push({ kind: 'added', text: b[start + column++] })
  }
  return result.concat(a.slice(endA).map((text) => ({ kind: 'same', text })))
}
