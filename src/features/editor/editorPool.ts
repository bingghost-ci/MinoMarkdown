type Entry<E> = { editor: E; root: HTMLElement; scrollTop: number }

/**
 * Keeps a bounded number of live editors so switching tabs preserves undo history, selection and
 * scroll position. Evicted editors are recreated from the Markdown captured when their tab was left.
 */
export class EditorPool<E> {
  private readonly entries = new Map<number, Entry<E>>()
  private activeId: number | null = null

  constructor(
    private readonly host: { append: (node: HTMLElement) => void },
    private readonly limit: number,
    private readonly dispose: (editor: E) => void,
    private readonly createRoot: () => HTMLElement,
  ) {}

  activate(id: number, create: (root: HTMLElement) => E): { editor: E; created: boolean } {
    if (this.activeId !== id) this.deactivate()
    let entry = this.entries.get(id)
    const created = !entry
    if (entry) this.entries.delete(id)
    else {
      const root = this.createRoot()
      this.host.append(root)
      entry = { editor: create(root), root, scrollTop: 0 }
    }
    this.entries.set(id, entry)
    entry.root.hidden = false
    entry.root.scrollTop = entry.scrollTop
    this.activeId = id
    this.evict()
    return { editor: entry.editor, created }
  }

  deactivate(): void {
    if (this.activeId === null) return
    const entry = this.entries.get(this.activeId)
    if (entry) { entry.scrollTop = entry.root.scrollTop; entry.root.hidden = true }
    this.activeId = null
  }

  /** Destroys editors whose documents are no longer open. */
  retain(open: ReadonlySet<number>): void {
    for (const id of [...this.entries.keys()]) if (!open.has(id)) this.drop(id)
  }

  drop(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    if (this.activeId === id) this.activeId = null
    this.dispose(entry.editor)
    entry.root.remove()
  }

  destroyAll(): void {
    for (const id of [...this.entries.keys()]) this.drop(id)
  }

  get size(): number { return this.entries.size }

  private evict(): void {
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.limit) return
      if (id !== this.activeId) this.drop(id)
    }
  }
}
