/**
 * Which script a document is mostly written in (T68). A document that is mostly Western text gets Western
 * layout: no first-line indent, a tighter line height (and hyphenation when the user justifies text) and a measure counted in letters.
 */
export type DocumentScript = 'cjk' | 'latin'

const SAMPLE_LIMIT = 200_000
const cjkPattern = /[⺀-⿟぀-ヿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/g
const wordPattern = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]{2,}/g

/** Code, URLs and HTML tags say nothing about the language of the prose around them. */
function prose(markdown: string): string {
  return markdown.slice(0, SAMPLE_LIMIT)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' ')
    .replace(/https?:\/\/\S+|<[^>\n]+>|\]\([^)\n]*\)/g, ' ')
}

/**
 * `latin` when the prose has at least 20 Western words and CJK characters make up under 10% of its
 * characters-and-words. A Chinese document with English terms stays `cjk`; so does an empty one.
 */
export function dominantScript(markdown: string): DocumentScript {
  const text = prose(markdown)
  const cjk = text.match(cjkPattern)?.length ?? 0
  const words = text.match(wordPattern)?.length ?? 0
  return words >= 20 && cjk / (cjk + words) < 0.1 ? 'latin' : 'cjk'
}
