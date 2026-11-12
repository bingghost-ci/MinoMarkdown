import { useRef, useState, type PointerEvent } from 'react'

const COLUMNS = 10
const ROWS = 8

type Size = { rows: number; columns: number }

export function TableSizePicker({ anchor, label, onSelect, onClose }: {
  anchor: { x: number; y: number }
  label: (text: string) => string
  onSelect: (size: Size) => void
  onClose: () => void
}) {
  const [hover, setHover] = useState<Size>({ rows: 3, columns: 3 })
  const grid = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const left = Math.min(Math.max(12, anchor.x), Math.max(12, window.innerWidth - 304))
  const top = anchor.y + 274 > window.innerHeight ? Math.max(12, anchor.y - 274) : anchor.y + 8

  function cellAt(event: PointerEvent<HTMLDivElement>): Size | null {
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-table-cell]')
    if (!cell || !grid.current?.contains(cell)) return null
    return { rows: Number(cell.dataset.row), columns: Number(cell.dataset.column) }
  }

  return <div className="table-size-picker" role="dialog" aria-label={label('插入表格')} style={{ left, top }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="table-size-title"><strong>{label('插入表格')}</strong><span>{hover.columns} × {hover.rows}</span></div>
    <div ref={grid} className="table-size-grid" role="grid" aria-label={label('选择表格列数和行数')}
      onPointerDown={(event) => { const size = cellAt(event); if (!size) return; event.preventDefault(); dragging.current = true; setHover(size); event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={(event) => { const size = cellAt(event); if (size) setHover((old) => old.rows === size.rows && old.columns === size.columns ? old : size) }}
      onPointerUp={(event) => { if (!dragging.current) return; dragging.current = false; const size = cellAt(event); event.currentTarget.releasePointerCapture(event.pointerId); if (size) onSelect(size) }}
      onPointerCancel={() => { dragging.current = false }}>
      {Array.from({ length: ROWS }, (_, row) => <div key={row} className="table-size-row" role="row">{Array.from({ length: COLUMNS }, (_, column) => <button key={column} type="button" role="gridcell" data-table-cell data-row={row + 1} data-column={column + 1} className="table-size-cell" aria-label={`${column + 1} × ${row + 1}`} aria-selected={column < hover.columns && row < hover.rows} onFocus={() => setHover({ rows: row + 1, columns: column + 1 })} onClick={(event) => { if (event.detail === 0) onSelect({ rows: row + 1, columns: column + 1 }) }} />)}</div>)}
    </div>
    <p>{label('移动鼠标选择大小，松开创建')}</p>
  </div>
}
