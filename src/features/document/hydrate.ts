import { prepareMarkdown, type PreparedMarkdown } from '../../core/markdown/codec'
import { assetUrl } from '../editor/assetUrl'
import { localAssetPath, replaceImageUrls } from '../export/snapshot'

export type HydratedMarkdown = {
  prepared: PreparedMarkdown
  /** What the editor loads: local images point at the asset scheme. */
  markdown: string
  /** Asset URL to the relative reference it replaced. */
  imageUrls: Map<string, string>
  /** An image reference could not be rewritten safely, so the document must stay source-only. */
  failed: boolean
}

/** Analyzes a Markdown file and points its local images at the asset scheme, off the main thread when large (T92). */
export function hydrateMarkdown(source: string, assetKey: string): HydratedMarkdown {
  const prepared = prepareMarkdown(source)
  if (prepared.analysis.mode !== 'visual' || !assetKey) return { prepared, markdown: prepared.editorMarkdown, imageUrls: new Map(), failed: false }
  try {
    const { markdown, replaced } = replaceImageUrls(prepared.editorMarkdown, (relative) => {
      const path = localAssetPath(relative)
      return path === null ? null : assetUrl(assetKey, path)
    })
    return { prepared, markdown, imageUrls: replaced, failed: false }
  } catch {
    return { prepared, markdown: prepared.editorMarkdown, imageUrls: new Map(), failed: true }
  }
}
