import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

// T30: parsing costs seconds per MiB and ProseMirror keeps one DOM node tree for the whole document.
export const VISUAL_SIZE_LIMIT_BYTES = 2 * 1024 * 1024

/** True when `text` encoded as UTF-8 exceeds the visual editing limit. */
export function exceedsVisualLimit(text: string): boolean {
  if (text.length > VISUAL_SIZE_LIMIT_BYTES) return true
  if (text.length * 3 <= VISUAL_SIZE_LIMIT_BYTES) return false
  return new TextEncoder().encode(text).length > VISUAL_SIZE_LIMIT_BYTES
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify)
const supportedNodes = new Set([
  'root', 'paragraph', 'heading', 'text', 'strong', 'emphasis', 'delete',
  'thematicBreak', 'blockquote', 'list', 'listItem', 'code', 'inlineCode',
  'link', 'linkReference', 'image', 'imageReference', 'definition', 'table',
  'tableRow', 'tableCell', 'break', 'html', 'footnoteReference', 'footnoteDefinition',
])

export type CompatibilityIssue = {
  code: 'INVALID_UTF8' | 'MIXED_NEWLINES' | 'UNCLOSED_FRONT_MATTER' |
    'VISUAL_SIZE_LIMIT' |
    'UNSUPPORTED_NODE' | 'UNKNOWN_EXTENSION' | 'PARSE_FAILED' |
    'SERIALIZE_FAILED' | 'SEMANTIC_CHANGE' | 'FRONT_MATTER_CHANGE' |
    'BOM_CHANGE' | 'NEWLINE_CHANGE' | 'FINAL_NEWLINE_CHANGE' | 'ROUNDTRIP_RISK'
  detail: string
  offset?: number
  line?: number
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
  /** Raw HTML and footnotes the visual editor must return unchanged; checked after it loads. */
  fragments?: string[]
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
      if (/(?:^|\n)\s*:::[\w-]+|\$\$|(?<!\\)\$(?=\S)[^$\n]*[\\_^{}=][^$\n]*(?<=\S)\$/.test(text)) {
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

type FragmentNode = NodeLike & { identifier?: string }

function collectFragments(tree: Root): string[] {
  const fragments: string[] = []
  walk(tree, (node) => {
    const item = node as FragmentNode
    if (item.type === 'html') fragments.push(item.value ?? '')
    if (item.type === 'footnoteReference') fragments.push(`ref:${item.identifier}`)
    if (item.type === 'footnoteDefinition') fragments.push(`def:${item.identifier}`)
  })
  return fragments
}

/** Raw HTML and footnote identifiers in document order. */
export function protectedFragments(markdown: string): string[] {
  return collectFragments(processor.parse(markdown))
}

const issueText: Record<CompatibilityIssue['code'], string> = {
  INVALID_UTF8: '文件不是有效的 UTF-8',
  MIXED_NEWLINES: '同时包含多种换行符',
  UNCLOSED_FRONT_MATTER: '文件头缺少结束标记',
  VISUAL_SIZE_LIMIT: `超过 ${VISUAL_SIZE_LIMIT_BYTES / 1024 / 1024} MiB 可视化上限`,
  UNSUPPORTED_NODE: '包含暂不支持的语法',
  UNKNOWN_EXTENSION: '包含数学公式或扩展指令',
  PARSE_FAILED: '无法解析',
  SERIALIZE_FAILED: '可视化保存可能改变内容',
  SEMANTIC_CHANGE: '可视化保存可能改变内容',
  ROUNDTRIP_RISK: '可视化编辑无法原样保留部分内容',
  FRONT_MATTER_CHANGE: '文件头发生变化',
  BOM_CHANGE: '编码标记发生变化',
  NEWLINE_CHANGE: '换行符发生变化',
  FINAL_NEWLINE_CHANGE: '文件末尾换行发生变化',
}

/** Readable reasons for source protection, with the first few locations. */
export function describeIssues(analysis: Pick<DocumentAnalysis, 'issues'>): string {
  const parts = analysis.issues.map((issue) => `${issue.line ? `第 ${issue.line} 行` : ''}${issueText[issue.code]}`)
  const unique = [...new Set(parts)]
  return unique.slice(0, 3).join('、') + (unique.length > 3 ? ` 等 ${unique.length} 处` : '')
}

export function analyzeMarkdown(bytes: Uint8Array): DocumentAnalysis {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return { mode: 'source-protected', issues: [{ code: 'INVALID_UTF8', detail: 'Input is not valid UTF-8' }], source: '', body: '', frontMatter: '', bom: false, newline: 'LF', trailingNewline: false }
  }

  if (bytes.length > VISUAL_SIZE_LIMIT_BYTES) {
    return {
      mode: 'source-protected',
      issues: [{ code: 'VISUAL_SIZE_LIMIT', detail: 'Document exceeds the visual editor limit' }],
      source, body: source, frontMatter: '', bom: source.startsWith('\uFEFF'),
      newline: source.includes('\r\n') ? 'CRLF' : 'LF', trailingNewline: source.endsWith('\n'),
    }
  }

  const parts = splitSource(source)
  const issues = [...parts.issues]
  let semantics: unknown
  let serialized: string | undefined
  let fragments: string[] | undefined
  try {
    const tree = processor.parse(parts.body)
    fragments = collectFragments(tree)
    const frontMatterLines = parts.frontMatter.split('\n').length - 1
    issues.push(...unsupportedIssues(tree, parts.body).map((issue) => issue.offset === undefined ? issue : { ...issue, line: parts.body.slice(0, issue.offset).split('\n').length + frontMatterLines }))
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
  return { ...parts, mode: issues.length ? 'source-protected' : 'visual', issues, source, serialized, semantics, fragments }
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
