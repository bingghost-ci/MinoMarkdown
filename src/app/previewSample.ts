/** A document with every element the reading styles cover, for `?ui-preview=editor&ui-sample=reading` screenshots. */
const picture = `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='480' height='240'><defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#8fb4d8'/><stop offset='1' stop-color='#e9d9b8'/></linearGradient></defs><rect width='480' height='240' fill='url(#s)'/><circle cx='370' cy='70' r='28' fill='#f6e7b0'/><path d='M0 200 L120 120 L210 180 L300 110 L480 210 L480 240 L0 240 Z' fill='#5f7d5a'/></svg>")}`

export const readingSample = `# 春日读书记

读书是一件安静的事。翻开一本排得好的书，纸色、字距、行宽都恰到好处，注意力自然落在文字上。Mino 想让 Markdown 也有这样的阅读体验：**粗体用于强调**，*斜体用于书名与外文*，\`inline code\` 用于命令，[链接](https://example.com) 用于出处。

> 书犹药也，善读之可以医愚。
> —— 刘向

## 一、阅读的节奏

段落之间留出呼吸的空间，行宽保持在三十到四十个汉字之间，眼睛换行时不容易串行。English text mixes in naturally, with proper spacing between 中文 and Latin words.

1. 选择合适的纸张风格
2. 调整字体与行距
3. 打开阅读模式，专心读完

- [x] 整理书单
- [ ] 写一篇读后感

![远山与晴空](${picture} "图 1　晴日远山")

## 二、数据与代码

| 书名 | 作者 | 页数 | 定价 |
| --- | --- | --- | --- |
| 浮生六记 | 沈复 | 156 | ¥32.00 |
| 人间词话 | 王国维 | 98 | ¥18.50 |
| 陶庵梦忆 | 张岱 | 210 | ¥45.00 |

\`\`\`js
// 统计每天的阅读时长
const minutes = [32, 45, 28]
const total = minutes.reduce((sum, value) => sum + value, 0)
console.log(\`本周共读 \${total} 分钟\`)
\`\`\`

---

### 结语

愿每一次打开文档，都像翻开一本好书。
`

/** Repeats the reading sample up to `bytes` of UTF-8, for scrolling and memory measurements of long documents. */
export function largeSample(bytes: number): string {
  const encoder = new TextEncoder()
  const chapter = readingSample.replace(/^# .*\n/, '')
  const parts = ['# 长文样例\n\n']
  let size = encoder.encode(parts[0]).length
  for (let index = 1; ; index++) {
    const part = chapter.replace(/^## /gm, `## ${index}.`)
    const length = encoder.encode(part).length
    if (size + length > bytes) break
    parts.push(part)
    size += length
  }
  return parts.join('')
}

/** A long article of headings and paragraphs only, up to `bytes` of UTF-8. */
export function largeProse(bytes: number): string {
  const encoder = new TextEncoder()
  const paragraph = '段落之间留出呼吸的空间，行宽保持在三十到四十个汉字之间，眼睛换行时不容易串行。读书是一件安静的事，纸色、字距、行宽都恰到好处，注意力自然落在文字上。English text mixes in naturally, with proper spacing between 中文 and Latin words.\n\n'
  const parts = ['# 长文样例\n\n']
  let size = encoder.encode(parts[0]).length
  for (let index = 1; ; index++) {
    const part = (index % 12 === 1 ? `## 第 ${Math.ceil(index / 12)} 章\n\n` : '') + paragraph
    const length = encoder.encode(part).length
    if (size + length > bytes) break
    parts.push(part)
    size += length
  }
  return parts.join('')
}

/** The document shown by `?ui-preview=editor&ui-sample=…` (development screenshots and measurements). */
export function previewSampleSource(name: string | null): string {
  if (name === 'reading') return readingSample
  if (name === 'reading-preview') return `${readingSample}\n$$\nE = mc^2\n$$\n`
  // Just under and just over the 2 MiB limit for visual editing (VISUAL_SIZE_LIMIT_BYTES).
  if (name === 'large') return largeSample(2 * 1024 * 1024 - 4096)
  if (name === 'large-protected') return largeSample(2 * 1024 * 1024 + 65536)
  if (name === 'large-prose') return largeProse(2 * 1024 * 1024 - 4096)
  return '# 产品笔记\n\n把 Markdown 文档放在熟悉的文件夹里，打开、阅读、继续写作。\n\n## 当前计划\n\n- 浏览多级目录\n- 编辑并保存本地文件\n- 导出可分享的副本\n'
}
