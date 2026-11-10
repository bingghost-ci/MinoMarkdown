const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}`
const WORD_CHAR = String.raw`(?![${CJK}])[\p{L}\p{N}_]`
const TOKEN = new RegExp(String.raw`[${CJK}]|${WORD_CHAR}+(?:['’.-]${WORD_CHAR}+)*`, 'gu')

/** Each CJK character counts as one, and each run of other letters or digits counts as one word. */
export function countWords(text: string): number {
  let count = 0
  TOKEN.lastIndex = 0
  while (TOKEN.exec(text)) count++
  return count
}

export const WORD_COUNT_SYNC_LIMIT_CHARS = 256 * 1024
