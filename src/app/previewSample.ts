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

/** A mostly-Western document, for the Western layout (T68): justified, hyphenated, with italics and code. */
const englishSample = `# On Reading Slowly

Reading is a quiet pleasure. A well-set page keeps its own rhythm: the measure is neither too wide nor too narrow, the leading lets each line breathe, and *nothing on the page asks for attention* except the words themselves. Mino tries to give Markdown documents that same unhurried character, whether they were written yesterday or a decade ago.

## A comfortable measure

Typographers have long recommended between sixty and seventy-five characters to a line. Shorter lines break the reader's stride; longer ones make it hard to find the beginning of the next. Justified text with careful hyphenation, as in a printed book, keeps the right edge calm without opening rivers of white between words — an *extraordinarily* old craft, and still a characteristically bookish one.

> The typographer's one essential task is to interpret and communicate the text. — Robert Bringhurst

1. Choose a paper that suits the hour.
2. Pick a serif for long passages, a sans for technical notes.
3. Let \`inline code\` and [links](https://example.com) stay modest.

\`\`\`ts
export function measure(characters: number): string {
  return \`\${characters}ch\`
}
\`\`\`

A few Chinese words (阅读, 排版) may appear without changing how the page is set.
`

const codeSample = `# 开发任务工具

流程见 [WORKFLOW.md](https://example.com)，常用命令如下。

\`\`\`bash
# 查看状态
./tasks.sh info --json
./tasks.sh validate --json | jq '.tasks[] | select(.status == "todo")'
export MINO_HOME="$HOME/.mino" && cd "$MINO_HOME"
\`\`\`

\`\`\`ts
export function migrate(id: string): StyleId | null {
  const known = new Map<string, number>([['white', 1]])
  return known.has(id) ? (id as StyleId) : null // 未知返回空
}
\`\`\`

\`\`\`json
{ "provider": "deepseek", "enabled": false, "limit": 64, "models": ["deepseek-chat"] }
\`\`\`

\`\`\`python
def mean(values: list[float]) -> float:
    \"\"\"平均值\"\"\"
    return sum(values) / len(values) if values else 0.0
\`\`\`
`

/** The document shown by `?ui-preview=editor&ui-sample=…` (development screenshots and measurements). */
export function previewSampleSource(name: string | null): string {
  if (name === 'reading') return readingSample
  if (name === 'english') return englishSample
  if (name === 'code') return codeSample
  if (name === 'reading-preview') return `${readingSample}\n$$\nE = mc^2\n$$\n`
  // Just under and just over the 2 MiB limit for visual editing (VISUAL_SIZE_LIMIT_BYTES).
  if (name === 'large') return largeSample(2 * 1024 * 1024 - 4096)
  if (name === 'large-protected') return largeSample(2 * 1024 * 1024 + 65536)
  if (name === 'large-prose') return largeProse(2 * 1024 * 1024 - 4096)
  return '# 产品笔记\n\n把 Markdown 文档放在熟悉的文件夹里，打开、阅读、继续写作。\n\n## 当前计划\n\n- 浏览多级目录\n- 编辑并保存本地文件\n- 导出可分享的副本\n'
}

/**
 * A stand-in for the Rust AI commands in the UI preview (`?ui-preview=editor&ui-ai=1`), for screenshots:
 * AI is on, every chat answers with the same canned text, and the model list is a fixed one. No request
 * leaves the page.
 */
export function previewAiTransport(): import('../features/ai/client').AiTransport {
  const enabled = new URLSearchParams(window.location.search).get('ui-ai') === '1'
  type Provider = 'deepseek' | 'openai' | 'custom'
  // What each provider is set to, as ai.rs remembers it; `custom` starts from the values in use when it is first picked.
  const remembered: Partial<Record<Provider, { baseUrl: string; model: string }>> = { deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }, openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } }
  const listed: Record<Provider, string[]> = { deepseek: ['deepseek-chat', 'deepseek-reasoner'], openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'], custom: ['qwen2.5:7b'] }
  const keys: Record<Provider, boolean> = { deepseek: enabled, openai: false, custom: false }
  let config = { enabled, consented: enabled, provider: 'deepseek' as Provider, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasKey: enabled, keys: { ...keys } }
  const withKeys = () => { config = { ...config, hasKey: keys[config.provider], keys: { ...keys } } }
  const handlers = new Set<(payload: never) => void>()
  const answer = '这篇笔记讲的是**如何舒服地读长文**。\n\n- 纸色、字距和行宽决定阅读的节奏\n- 行宽保持在三十到四十个汉字之间\n- 阅读模式收起编辑控件，只留纸面\n\n> 以上内容只依据当前文档。'
  return {
    invoke: async <T,>(command: string, args?: Record<string, unknown>) => {
      if (command === 'ai_set_config') {
        const patch = args?.patch as Partial<typeof config>
        remembered[config.provider] = { baseUrl: config.baseUrl, model: config.model }
        const provider = patch.provider ?? config.provider
        config = { ...config, ...remembered[provider], ...patch }
        withKeys()
      }
      if (command === 'ai_set_key' || command === 'ai_clear_key') {
        keys[(args?.provider as Provider | undefined) ?? config.provider] = command === 'ai_set_key'
        withKeys()
      }
      if (command === 'ai_list_models') {
        if (!config.enabled) throw 'AI_DISABLED'
        if (!config.hasKey) throw 'AI_NO_KEY'
        return [...listed[config.provider]] as T
      }
      if (command === 'ai_chat') {
        const { requestId } = args?.request as { requestId: string }
        for (const text of answer.match(/[\s\S]{1,12}/g) ?? []) handlers.forEach((handler) => handler({ requestId, kind: 'delta', text } as never))
        return undefined as T
      }
      return config as T
    },
    listen: async <T,>(event: string, handler: (payload: T) => void) => {
      if (event !== 'ai-stream') return () => undefined
      handlers.add(handler as (payload: never) => void)
      return () => { handlers.delete(handler as (payload: never) => void) }
    },
  }
}
