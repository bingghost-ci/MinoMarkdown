import { describe, expect, it } from 'vitest'
import { translate, translateStatus, translateWith } from '../src/app/i18n'

describe('interface strings', () => {
  it('fills placeholders after translating a template', () => {
    expect(translateWith('关闭 {name}', 'en-US', { name: '笔记.md' })).toBe('Close 笔记.md')
    expect(translateWith('关闭 {name}', 'zh-CN', { name: '笔记.md' })).toBe('关闭 笔记.md')
    expect(translateWith('内容里有原编码（{encoding}）无法表示的字符。\n要把这个文件改存为 UTF-8 吗？', 'en-US', { encoding: 'GB18030' })).toContain('encoding (GB18030)')
    // A placeholder without a value stays visible rather than turning into "undefined".
    expect(translateWith('关闭 {name}', 'en-US', {})).toBe('Close {name}')
  })

  it('has English for every confirmation and suggested name the workspace shows', () => {
    for (const key of [
      '关闭 {name}', '将“{name}”移到废纸篓？', '将文件夹“{name}”及其中的所有内容移到废纸篓？', '将“{name}”移到废纸篓？未保存的修改会一并丢弃。',
      '内容里有原编码无法表示的字符。\n要把这个文件改存为 UTF-8 吗？', '内容里有原编码（{encoding}）无法表示的字符。\n要把这个文件改存为 UTF-8 吗？', '新文档.md', '新目录',
    ]) expect(translate(key, 'en-US'), key).not.toBe(key)
    expect(translate('新文档.md', 'en-US')).toMatch(/\.md$/)
  })

  it('translates the new status messages', () => {
    for (const status of ['编辑器尚未就绪，请稍后再保存', '编辑器尚未就绪，操作已取消，内容没有改变', '已移到废纸篓：a.md；标签页未能关闭']) expect(translateStatus(status, 'en-US')).not.toMatch(/[一-鿿]/)
  })
})
