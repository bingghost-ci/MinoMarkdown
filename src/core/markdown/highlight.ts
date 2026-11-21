import { LanguageDescription, type Language } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightTree } from '@lezer/highlight'
import { textOf, type Element, type Node, type Root } from './hast'
import { syntaxClassHighlighter } from './syntaxRoles'


export type CodeParsers = ReadonlyMap<string, Language['parser']>

/** Larger blocks, and code past the document budget, stay plain so long documents render quickly. */
export const HIGHLIGHT_BLOCK_LIMIT = 100_000
export const HIGHLIGHT_DOCUMENT_LIMIT = 500_000

const fence = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm

/** The language names of fenced code blocks, lower-cased, without duplicates. */
export function codeLanguages(markdown: string): string[] {
  return [...new Set(Array.from(markdown.matchAll(fence), (match) => match[1].toLowerCase()))]
}

/**
 * Loads the parsers for the languages a document uses, from the language packages the editor already
 * ships. Unknown names and parsers that fail to load are left out; those blocks render as plain text.
 */
export async function loadCodeParsers(markdown: string): Promise<CodeParsers> {
  const parsers = new Map<string, Language['parser']>()
  await Promise.all(codeLanguages(markdown).map(async (name) => {
    const description = LanguageDescription.matchLanguageName(languages, name, true)
    if (!description) return
    try {
      const support = description.support ?? await description.load()
      parsers.set(name, support.language.parser)
    } catch {
      // A missing chunk only costs the colors of that block.
    }
  }))
  return parsers
}

/**
 * The parser for a source file, chosen by its name (T85). Null for a file type without one, such as a log,
 * or when the parser fails to load; the file is then shown without colors.
 */
export async function loadFileParser(filename: string): Promise<Language['parser'] | null> {
  const description = LanguageDescription.matchFilename(languages, filename)
  if (!description) return null
  try { return (description.support ?? await description.load()).language.parser }
  catch { return null }
}

function languageOf(code: Element): string | null {
  const classes = code.properties?.className
  const list = Array.isArray(classes) ? classes : typeof classes === 'string' ? classes.split(/\s+/) : []
  const found = list.map(String).find((name) => name.startsWith('language-'))
  return found ? found.slice('language-'.length).toLowerCase() : null
}

/** Splits a code block's text into spans whose only attribute is a fixed token class. */
function highlighted(text: string, parser: Language['parser']): Node[] {
  const children: Node[] = []
  let position = 0
  const plain = (to: number) => { if (to > position) children.push({ type: 'text', value: text.slice(position, to) }) }
  highlightTree(parser.parse(text), syntaxClassHighlighter, (from, to, classes) => {
    plain(from)
    children.push({ type: 'element', tagName: 'span', properties: { className: classes.split(' ') }, children: [{ type: 'text', value: text.slice(from, to) }] })
    position = to
  })
  plain(text.length)
  return children
}

/**
 * Highlights fenced code in preview and export (T56). It runs after sanitizing and only rebuilds the
 * text of `pre > code` from the parser's ranges, so no markup from the document is let through.
 */
export function rehypeHighlightCode(options: { parsers?: CodeParsers }) {
  return (tree: Root) => {
    const parsers = options.parsers
    if (!parsers || parsers.size === 0) return
    let budget = HIGHLIGHT_DOCUMENT_LIMIT
    const visit = (node: Node) => {
      if (node.type !== 'element' && node.type !== 'root') return
      const element = node as Element
      if (element.tagName === 'pre') {
        const code = element.children.find((child): child is Element => child.type === 'element' && (child as Element).tagName === 'code')
        const language = code ? languageOf(code) : null
        const parser = language ? parsers.get(language) : undefined
        if (code && parser) {
          const text = textOf(code)
          if (text.length <= HIGHLIGHT_BLOCK_LIMIT && text.length <= budget) {
            budget -= text.length
            code.children = highlighted(text, parser)
          }
        }
        return
      }
      for (const child of element.children ?? []) visit(child as Node)
    }
    visit(tree)
  }
}

/** A language name short and plain enough to show as a label; it ends up in an attribute, never in markup. */
const LABEL = /^[a-z0-9][a-z0-9+#.-]{0,19}$/

/**
 * Names the language on a code block (T127): `<pre data-lang="rust">`, which the stylesheet shows as a small
 * label in the block's corner. Diagrams and formulas are drawn as something else and get none.
 */
export function rehypeCodeLabels() {
  return (tree: Root) => {
    const visit = (node: Node) => {
      if (node.type !== 'element' && node.type !== 'root') return
      const element = node as Element
      if (element.tagName === 'pre') {
        const code = element.children.find((child): child is Element => child.type === 'element' && (child as Element).tagName === 'code')
        const language = code ? languageOf(code) : null
        if (language && LABEL.test(language) && language !== 'mermaid' && language !== 'math') element.properties = { ...element.properties, 'data-lang': language }
        return
      }
      for (const child of element.children ?? []) visit(child as Node)
    }
    visit(tree)
  }
}
