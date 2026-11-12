/**
 * Where the reader is in a text or source file (T83), as a fraction that survives a change of font, width
 * or style: the index of the first block on screen over the number of blocks. Blocks are the paragraphs and
 * headings of a text file and the lines of a source file.
 */
const BLOCKS = '.mino-text p, .mino-text h1, .mino-text h2, .mino-code .l, .mino-table-file tr'

/** The index of the first item whose bottom edge is below `edge`, by bisection; items are in document order. */
export function firstBelow(count: number, bottomOf: (index: number) => number, edge: number): number {
  let low = 0
  let high = count
  while (low < high) {
    const middle = (low + high) >> 1
    if (bottomOf(middle) > edge) high = middle
    else low = middle + 1
  }
  return low
}

export function positionFraction(index: number, count: number): number {
  return count <= 1 ? 0 : Math.min(1, Math.max(0, index / (count - 1)))
}

export function blockIndex(fraction: number, count: number): number {
  return count <= 1 ? 0 : Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))))
}

/** The position of `scroller`'s first visible block, or null when the page has no blocks or is at its top. */
export function blockPosition(scroller: HTMLElement): number | null {
  const blocks = scroller.querySelectorAll<HTMLElement>(BLOCKS)
  if (blocks.length === 0) return null
  if (scroller.scrollTop <= 0) return 0
  const edge = scroller.getBoundingClientRect().top
  return positionFraction(Math.min(blocks.length - 1, firstBelow(blocks.length, (index) => blocks[index].getBoundingClientRect().bottom, edge + 1)), blocks.length)
}

/** Scrolls the block at `fraction` to the top of `scroller`. False when the page has no blocks yet. */
export function restoreBlockPosition(scroller: HTMLElement, fraction: number): boolean {
  const blocks = scroller.querySelectorAll<HTMLElement>(BLOCKS)
  if (blocks.length === 0) return false
  if (fraction <= 0) { scroller.scrollTop = 0; return true }
  const target = blocks[blockIndex(fraction, blocks.length)]
  scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8
  return true
}
