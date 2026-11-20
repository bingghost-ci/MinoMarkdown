import { describe, expect, it } from 'vitest'
import { fenceAfterLine, type OpenFence } from '../src/core/markdown/fences'
import { previewHead } from '../src/features/document/largeDocument'
import { outlineFromSource } from '../src/features/outline/outline'

const scan = (lines: string[]) => lines.reduce<OpenFence | null>((open, line) => fenceAfterLine(open, line), null)

describe('code fences found by line', () => {
  it('opens on three or more backticks or tildes and closes on as many of the same', () => {
    expect(scan(['```js'])).toEqual({ marker: '`', length: 3 })
    expect(scan(['~~~~', 'text', '~~~'])).toEqual({ marker: '~', length: 4 })
    expect(scan(['~~~~', 'text', '~~~~~'])).toBeNull()
    expect(scan(['```', '~~~', '``` js'])).toEqual({ marker: '`', length: 3 })
    expect(scan(['   ```', '```  '])).toBeNull()
    expect(scan(['    ```'])).toBeNull()
  })

  it('does not open on backticks whose info string holds a backtick, which is inline code', () => {
    expect(scan(['``` a`b'])).toBeNull()
    expect(scan(['~~~ a`b'])).toEqual({ marker: '~', length: 3 })
  })

  it('gives the outline and the first preview of a long document the same reading of a fence', () => {
    const source = '# 一\n\n```` 行内 `代码` ````\n\n# 二\n\n```\n# 不是标题\n```\n\n# 三\n\n' + '正文\n\n'.repeat(60)
    expect(outlineFromSource(source).map((item) => item.text)).toEqual(['一', '二', '三'])
    const head = previewHead(source, source.indexOf('# 三') + 4)
    expect(head).toBe(source.slice(0, source.indexOf('# 三')))
  })
})
