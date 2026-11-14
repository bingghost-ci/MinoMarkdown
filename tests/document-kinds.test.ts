import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CODE_EXTENSIONS, delimiterOf, extensionOf, isTextKind, kindOfName, MARKDOWN_EXTENSIONS, PDF_EXTENSIONS, TEXT_EXTENSIONS, titleOf } from '../src/features/document/kinds'

const rust = readFileSync('src-tauri/src/file_kinds.rs', 'utf8')
function rustList(name: string): string[] {
  const match = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\];`).exec(rust)
  if (!match) throw new Error(`${name} not found in file_kinds.rs`)
  return Array.from(match[1].matchAll(/"([^"]+)"/g), (item) => item[1])
}

describe('T81 document kinds', () => {
  it('lists the same extensions as file_kinds.rs', () => {
    expect([...MARKDOWN_EXTENSIONS]).toEqual(rustList('MARKDOWN_EXTENSIONS'))
    expect([...TEXT_EXTENSIONS]).toEqual(rustList('TEXT_EXTENSIONS'))
    expect([...CODE_EXTENSIONS]).toEqual(rustList('CODE_EXTENSIONS'))
    expect([...PDF_EXTENSIONS]).toEqual(rustList('PDF_EXTENSIONS'))
  })

  it('registers every extension with Finder in tauri.conf.json', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as { bundle: { fileAssociations: { ext: string[]; role: string; rank: string }[] } }
    const associated = config.bundle.fileAssociations.flatMap((item) => item.ext).sort()
    expect(associated).toEqual([...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS, ...CODE_EXTENSIONS, ...PDF_EXTENSIONS].sort())
    // Mino offers itself for these files but never takes them over from the app the user already uses.
    expect(config.bundle.fileAssociations.every((item) => item.rank === 'Alternate')).toBe(true)
    expect(config.bundle.fileAssociations.find((item) => item.ext.includes('pdf'))?.role).toBe('Viewer')
  })

  it('declares types the Dock accepts: folders, and extensions without a system type apart from typed ones', () => {
    type Association = { ext: string[]; contentTypes?: string[]; name: string }
    const associations = (JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as { bundle: { fileAssociations: Association[] } }).bundle.fileAssociations
    // A folder dropped on the icon opens in the sidebar.
    expect(associations.find((item) => item.contentTypes?.includes('public.folder'))?.ext).toEqual([])
    expect(associations.find((item) => item.ext.includes('md'))?.contentTypes).toEqual(['net.daringfireball.markdown'])
    // macOS ignores an entry's extensions once it lists content types, so extensions that have no system type
    // (they resolve to a dynamic type) must sit in an entry without them. `.ts` resolves to MPEG-2 video.
    const untyped = associations.filter((item) => !item.contentTypes)
    for (const ext of ['ts', 'rs', 'go', 'jsonc', 'vue', 'kt']) expect(untyped.some((item) => item.ext.includes(ext)), ext).toBe(true)
    // The Markdown type is imported for macOS versions that do not declare it.
    expect(readFileSync('src-tauri/Info.plist', 'utf8')).toContain('<string>net.daringfireball.markdown</string>')
  })

  it('tells the kind from the name, whatever its case', () => {
    expect(kindOfName('笔记.md')).toBe('markdown')
    expect(kindOfName('README.MARKDOWN')).toBe('markdown')
    expect(kindOfName('小说.TXT')).toBe('text')
    expect(kindOfName('a.b.yaml')).toBe('code')
    expect(kindOfName('server.log')).toBe('code')
    expect(kindOfName('手册.PDF')).toBe('pdf')
    for (const name of ['README', 'a.docx', 'a.epub', '.txt', 'a.', 'a.md.bak', 'photo.png']) expect(kindOfName(name), name).toBeNull()
  })

  it('reads extensions and titles', () => {
    expect(extensionOf('a.tar.GZ')).toBe('gz')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('noext')).toBe('')
    expect(titleOf('读书笔记.md')).toBe('读书笔记')
    expect(titleOf('v1.2 手册.pdf')).toBe('v1.2 手册')
    expect(titleOf('archive.zip')).toBe('archive.zip')
    expect(titleOf('未命名')).toBe('未命名')
  })

  it('knows which kinds can be edited and which files are tables', () => {
    expect(isTextKind('markdown') && isTextKind('text') && isTextKind('code')).toBe(true)
    expect(isTextKind('pdf')).toBe(false)
    expect(delimiterOf('a.csv')).toBe(',')
    expect(delimiterOf('a.TSV')).toBe('\t')
    expect(delimiterOf('a.json')).toBeNull()
  })
})
