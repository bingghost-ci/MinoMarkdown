/** Tables stored as text (T85): CSV and TSV, read without changing them. */
export const TABLE_ROW_LIMIT = 5000
export const TABLE_COLUMN_LIMIT = 200

export type ParsedTable = { rows: string[][]; /** Rows in the file, which may be more than `rows` holds. */ total: number; columns: number }

/**
 * Splits delimited text into rows. Quoted fields may hold the delimiter, line breaks and doubled quotes;
 * TSV is read the same way. Only the first `limit` rows are kept, but all are counted.
 */
export function parseDelimited(text: string, delimiter: ',' | '\t', limit = TABLE_ROW_LIMIT): ParsedTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let total = 0
  let columns = 0
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  const endField = () => { if (row.length < TABLE_COLUMN_LIMIT) row.push(field); field = ''; fieldStarted = false }
  const endRow = () => {
    endField()
    if (row.length > 1 || row[0] !== '') {
      total++
      if (rows.length < limit) { rows.push(row); columns = Math.max(columns, row.length) }
    }
    row = []
  }
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index++ } else quoted = false
      } else field += character
    } else if (character === '"' && !fieldStarted) { quoted = true; fieldStarted = true }
    else if (character === delimiter) endField()
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index++
      endRow()
    } else { field += character; fieldStarted = true }
  }
  if (field !== '' || fieldStarted || row.length > 0) endRow()
  return { rows, total, columns }
}
