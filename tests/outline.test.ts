import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { outlineFromDoc, outlineFromSource } from '../src/features/outline/outline'

describe('outline from source text', () => {
  it('reads ATX and setext headings with their offsets', () => {
    const source = '# 第一章 #\n\n正文\n\n第二章\n===\n\n小节\n---\n\n###### 六级\n'
    const items = outlineFromSource(source)
    expect(items.map((item) => [item.level, item.text])).toEqual([[1, '第一章'], [1, '第二章'], [2, '小节'], [6, '六级']])
    for (const item of items) expect(source.slice(item.target)).toContain(item.text)
    expect(source.slice(items[1].target).startsWith('第二章')).toBe(true)
  })

  it('ignores code, front matter, thematic breaks and empty headings', () => {
    const source = '---\ntitle: 元数据\n# 不是标题\n---\n```md\n# 代码\n```\n\n~~~\n# 也是代码\n~~~~\n\n- 列表\n---\n\n#\n\n#没有空格\n\n    # 缩进代码\n\n## 真标题\n'
    expect(outlineFromSource(source)).toEqual([{ level: 2, text: '真标题', target: source.indexOf('## 真标题') }])
  })

  it('keeps offsets correct with a BOM and CRLF', () => {
    const source = '﻿段落\r\n\r\n# 标题\r\n'
    const [item] = outlineFromSource(source)
    expect(item.text).toBe('标题')
    expect(source.slice(item.target, item.target + 4)).toBe('# 标题')
  })
})

describe('outline from the editor document', () => {
  const schema = new Schema({ nodes: { doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { group: 'block', content: 'inline*' }, heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } }, blockquote: { group: 'block', content: 'block+' } } })

  it('finds nested headings at their positions and skips empty ones', () => {
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 2 }, [schema.text('标题')]),
      schema.node('paragraph', null, [schema.text('正文')]),
      schema.node('heading', { level: 3 }),
      schema.node('blockquote', null, [schema.node('heading', { level: 4 }, [schema.text('引用内')])]),
    ])
    const items = outlineFromDoc(doc)
    expect(items.map((item) => [item.level, item.text])).toEqual([[2, '标题'], [4, '引用内']])
    for (const item of items) expect(doc.nodeAt(item.target)?.type.name).toBe('heading')
  })
})
