/** Code fences found by scanning lines, for the scans that must not parse a whole document. No dependencies. */

export type OpenFence = { marker: string; length: number }

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * The fence that is open after `line` (without its line ending), given the one open before it. A fence closes on
 * a line of the same marker, at least as long, with nothing after it; a backtick fence does not open when its
 * info string holds a backtick, which is inline code.
 */
export function fenceAfterLine(open: OpenFence | null, line: string): OpenFence | null {
  const match = FENCE_LINE.exec(line)
  if (!match) return open
  if (open) return match[1][0] === open.marker && match[1].length >= open.length && !match[2].trim() ? null : open
  return match[1][0] === '`' && match[2].includes('`') ? null : { marker: match[1][0], length: match[1].length }
}
