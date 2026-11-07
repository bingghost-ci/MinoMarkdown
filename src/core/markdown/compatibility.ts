import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify)
const supportedNodes = new Set([
  'root', 'paragraph', 'heading', 'text', 'strong', 'emphasis', 'delete',
  'thematicBreak', 'blockquote', 'list', 'listItem', 'code', 'inlineCode',
  'link', 'linkReference', 'image', 'imageReference', 'definition', 'table',
  'tableRow', 'tableCell', 'break',
])

export type CompatibilityIssue = {
  code: 'INVALID_UTF8' | 'MIXED_NEWLINES' | 'UNCLOSED_FRONT_MATTER' |
    'VISUAL_SIZE_LIMIT' |
    'UNSUPPORTED_NODE' | 'UNKNOWN_EXTENSION' | 'PARSE_FAILED' |
    'SERIALIZE_FAILED' | 'SEMANTIC_CHANGE' | 'FRONT_MATTER_CHANGE' |
    'BOM_CHANGE' | 'NEWLINE_CHANGE' | 'FINAL_NEWLINE_CHANGE'
  detail: string
  offset?: number
}

export type DocumentAnalysis = {
  mode: 'visual' | 'source-protected'
  issues: CompatibilityIssue[]
  source: string
  body: string
  frontMatter: string
  bom: boolean
  newline: 'LF' | 'CRLF'
  trailingNewline: boolean
  serialized?: string
  semantics?: unknown
}

function projectNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectNode)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'position' && key !== 'data')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, projectNode(item)]),
    )
  }
  return value
}

type NodeLike = { type: string; children?: unknown[]; position?: { start?: { offset?: number } }; value?: string }

function walk(node: NodeLike, visit: (node: NodeLike) => void): void {
  visit(node)
  for (const child of node.children ?? []) {
    walk(child as NodeLike, visit)
  }
}

function unsupportedIssues(tree: Root, body: string): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = []
  walk(tree, (node) => {
    if (!supportedNodes.has(node.type)) {
      const offset = node.position?.start?.offset
      const end = (node.position as { end?: { offset?: number } } | undefined)?.end?.offset
      const sourceFragment = offset === undefined || end === undefined ? '' : body.slice(offset, end).slice(0, 120)
      issues.push({ code: 'UNSUPPORTED_NODE', detail: `${node.type}: ${sourceFragment}`, offset })
    }
    // remark treats several extension dialects as ordinary text. Reject the
    // recognizable markers rather than silently normalizing away their source.
    if (node.type === 'text') {
      const start = node.position?.start?.offset
      const end = (node.position as { end?: { offset?: number } } | undefined)?.end?.offset
      const text = start === undefined || end === undefined ? node.value ?? '' : body.slice(start, end)
      if (/(?:^|\n)\s*:::[\w-]+|\$\$|(?<!\\)\$[^$\n]+\$/.test(text)) {
        issues.push({ code: 'UNKNOWN_EXTENSION', detail: 'Possible directive or math syntax', offset: node.position?.start?.offset })
      }
    }
  })
  return issues
}

function splitSource(source: string): Pick<DocumentAnalysis, 'body' | 'frontMatter' | 'bom' | 'newline' | 'trailingNewline' | 'issues'> {
  const issues: CompatibilityIssue[] = []
  const bom = source.startsWith('\uFEFF')
  const withoutBom = bom ? source.slice(1) : source
  const crlfCount = (withoutBom.match(/\r\n/g) ?? []).length
  const loneLfCount = (withoutBom.match(/(?<!\r)\n/g) ?? []).length
  const newline = crlfCount > 0 ? 'CRLF' : 'LF'
  const trailingNewline = withoutBom.endsWith('\n')
  if (crlfCount > 0 && loneLfCount > 0 || /\r(?!\n)/.test(withoutBom)) {
    issues.push({ code: 'MIXED_NEWLINES', detail: 'Mixed or bare-CR line endings require source protection' })
  }
  const normalized = withoutBom.replace(/\r\n/g, '\n')
  let frontMatter = ''
  let body = normalized
  if (normalized.startsWith('---\n')) {
    const match = /^---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(normalized)
    if (match) {
      frontMatter = match[0]
      body = normalized.slice(frontMatter.length)
    } else {
      issues.push({ code: 'UNCLOSED_FRONT_MATTER', detail: 'Opening --- has no closing delimiter' })
    }
  }
  return { body, frontMatter, bom, newline, trailingNewline, issues }
}

export function analyzeMarkdown(bytes: Uint8Array): DocumentAnalysis {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return { mode: 'source-protected', issues: [{ code: 'INVALID_UTF8', detail: 'Input is not valid UTF-8' }], source: '', body: '', frontMatter: '', bom: false, newline: 'LF', trailingNewline: false }
  }

  if (bytes.length > 5 * 1024 * 1024) {
    return {
      mode: 'source-protected',
      issues: [{ code: 'VISUAL_SIZE_LIMIT', detail: 'Document exceeds the 5 MiB visual editor limit' }],
      source, body: source, frontMatter: '', bom: source.startsWith('\uFEFF'),
      newline: source.includes('\r\n') ? 'CRLF' : 'LF', trailingNewline: source.endsWith('\n'),
    }
  }

  const parts = splitSource(source)
  const issues = [...parts.issues]
  let semantics: unknown
  let serialized: string | undefined
  try {
    const tree = processor.parse(parts.body)
    issues.push(...unsupportedIssues(tree, parts.body))
    if (issues.length === 0) {
      semantics = projectNode(tree)
      const normalized = processor.stringify(tree)
      const reparsed = processor.parse(normalized)
      if (JSON.stringify(semantics) !== JSON.stringify(projectNode(reparsed))) {
        issues.push({ code: 'SEMANTIC_CHANGE', detail: 'parse → serialize → parse changed Markdown AST semantics' })
      } else {
        let output = parts.frontMatter + normalized
        if (!parts.trailingNewline && output.endsWith('\n')) output = output.slice(0, -1)
        serialized = (parts.bom ? '\uFEFF' : '') + (parts.newline === 'CRLF' ? output.replace(/\n/g, '\r\n') : output)
      }
    }
  } catch (error) {
    issues.push({ code: 'PARSE_FAILED', detail: error instanceof Error ? error.message : String(error) })
  }
  return { ...parts, mode: issues.length ? 'source-protected' : 'visual', issues, source, serialized, semantics }
}

export function compareMarkdown(original: Uint8Array, candidate: Uint8Array): CompatibilityIssue[] {
  const before = analyzeMarkdown(original)
  const after = analyzeMarkdown(candidate)
  const issues = [...before.issues, ...after.issues]
  if (before.frontMatter !== after.frontMatter) issues.push({ code: 'FRONT_MATTER_CHANGE', detail: 'Front matter source changed' })
  if (before.bom !== after.bom) issues.push({ code: 'BOM_CHANGE', detail: 'UTF-8 BOM changed' })
  if (before.newline !== after.newline) issues.push({ code: 'NEWLINE_CHANGE', detail: 'Line-ending convention changed' })
  if (before.trailingNewline !== after.trailingNewline) issues.push({ code: 'FINAL_NEWLINE_CHANGE', detail: 'Final newline changed' })
  if (before.semantics && after.semantics && JSON.stringify(before.semantics) !== JSON.stringify(after.semantics)) {
    issues.push({ code: 'SEMANTIC_CHANGE', detail: 'Markdown AST semantics changed' })
  }
  return issues
}
