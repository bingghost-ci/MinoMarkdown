/**
 * What a file is opened as (T81). Rust decides when it opens a file (`src-tauri/src/file_kinds.rs`); these
 * lists repeat its extension tables for names the frontend sees before or without opening, and a test
 * compares the two.
 */
export type DocumentKind = 'markdown' | 'text' | 'code' | 'pdf'

export const MARKDOWN_EXTENSIONS = ['md', 'markdown'] as const
export const TEXT_EXTENSIONS = ['txt', 'text'] as const
export const CODE_EXTENSIONS = ['log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'ini', 'conf', 'cfg', 'properties', 'sh', 'bash', 'zsh', 'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'rb', 'php', 'lua', 'sql', 'css', 'scss', 'less', 'html', 'htm', 'vue', 'tex', 'diff', 'patch', 'bat', 'ps1', 'gradle'] as const
export const PDF_EXTENSIONS = ['pdf'] as const

const kinds = new Map<string, DocumentKind>([
  ...MARKDOWN_EXTENSIONS.map((extension) => [extension, 'markdown'] as const),
  ...TEXT_EXTENSIONS.map((extension) => [extension, 'text'] as const),
  ...CODE_EXTENSIONS.map((extension) => [extension, 'code'] as const),
  ...PDF_EXTENSIONS.map((extension) => [extension, 'pdf'] as const),
])

/** The lower-case extension of a file name, or '' when it has none (a leading dot is not an extension). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOfName(name: string): DocumentKind | null {
  return kinds.get(extensionOf(name)) ?? null
}

/** Kinds whose content is text: they can be edited and saved. A PDF is only read. */
export function isTextKind(kind: DocumentKind): boolean {
  return kind !== 'pdf'
}

/** The name without a supported extension, for titles. */
export function titleOf(name: string): string {
  return kindOfName(name) ? name.slice(0, name.lastIndexOf('.')) : name
}

/** The separator of a table stored as text, or null for any other file. */
export function delimiterOf(name: string): ',' | '\t' | null {
  const extension = extensionOf(name)
  return extension === 'csv' ? ',' : extension === 'tsv' ? '\t' : null
}
