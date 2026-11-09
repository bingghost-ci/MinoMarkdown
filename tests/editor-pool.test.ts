import { describe, expect, it } from 'vitest'
import { EditorPool } from '../src/features/editor/editorPool'

function setup(limit = 2) {
  const disposed: string[] = []
  const pool = new EditorPool<string>({ append: () => undefined }, limit, (editor) => disposed.push(editor), () => ({ hidden: false, scrollTop: 0, remove: () => undefined }) as unknown as HTMLElement)
  return { pool, disposed }
}

describe('editor pool', () => {
  it('reuses a live editor and restores scroll position', () => {
    const { pool } = setup()
    let root!: HTMLElement
    pool.activate(1, (element) => { root = element; return 'one' })
    root.scrollTop = 420
    pool.activate(2, () => 'two')
    expect(root.hidden).toBe(true)
    root.scrollTop = 0
    expect(pool.activate(1, () => 'new')).toEqual({ editor: 'one', created: false })
    expect(root.hidden).toBe(false)
    expect(root.scrollTop).toBe(420)
  })

  it('evicts the least recently used editor but never the active one', () => {
    const { pool, disposed } = setup()
    pool.activate(1, () => 'one'); pool.activate(2, () => 'two'); pool.activate(1, () => 'x'); pool.activate(3, () => 'three')
    expect(disposed).toEqual(['two'])
    expect(pool.size).toBe(2)
  })

  it('drops editors for closed documents', () => {
    const { pool, disposed } = setup(5)
    pool.activate(1, () => 'one'); pool.activate(2, () => 'two')
    pool.retain(new Set([2]))
    expect(disposed).toEqual(['one'])
  })
})
