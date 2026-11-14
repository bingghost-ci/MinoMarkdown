/** Front matter detection shared by the analysis and the source outline. No dependencies, so the app shell can use it. */

const yamlKey = /^[ \t]*(?:"[^"\n]*"|'[^'\n]*'|[^\s#:'"-][^\n:]*?):(?:[ \t]|$)/

/**
 * Whether the lines between an opening `---` and the closing line read as YAML: the first is not blank and one
 * of them is a `key:` line. A paragraph between two horizontal rules is not front matter, and treating it as
 * such hid it from the visual editor and the outline.
 */
export function looksLikeFrontMatter(lines: readonly string[]): boolean {
  if (lines.length === 0 || lines[0].trim() === '') return false
  return lines.some((line) => yamlKey.test(line))
}

/**
 * The length of the front matter at the start of LF-only text: 0 when there is none, -1 when the opening `---`
 * has no closing line.
 */
export function frontMatterLength(text: string): number {
  if (!text.startsWith('---\n')) return 0
  const match = /^---\n([\s\S]*?)\n(?:---|\.\.\.)(?:\n|$)/.exec(text)
  if (!match) return -1
  return looksLikeFrontMatter(match[1].split('\n')) ? match[0].length : 0
}
