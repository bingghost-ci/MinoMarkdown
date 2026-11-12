import type { Root } from 'mdast'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { remarkDemoteCurrency } from '../../core/markdown/math'
import { rehypeRenderMath, withMathClasses, type MathRenderer } from '../../core/markdown/renderMath'
import { assetUrl } from '../editor/assetUrl'
import { localAssetPath } from '../export/snapshot'
import { rehypeFigures } from '../../core/markdown/figures'
import { rehypeNumericColumns } from '../../core/markdown/numericColumns'
import { rehypeHighlightCode, type CodeParsers } from '../../core/markdown/highlight'

// Only a standalone, empty anchor immediately before a heading is promoted to
// a preview heading id. The source document is never changed by this renderer.
function headingAnchors() {
  return (tree: Root) => {
    for (let index = 0; index < tree.children.length - 1; index++) {
      const current = tree.children[index]
      const next = tree.children[index + 1]
      if (current.type !== 'paragraph' || next.type !== 'heading' || current.children.length !== 2) continue
      const [open, close] = current.children
      if (open.type !== 'html' || close.type !== 'html' || close.value.trim() !== '</a>') continue
      const match = /^<a id="([A-Za-z][A-Za-z0-9_-]{0,79})">$/.exec(open.value.trim())
      if (!match) continue
      next.data = { ...next.data, hProperties: { ...next.data?.hProperties, id: match[1] } }
      tree.children.splice(index, 1)
    }
  }
}

function blockImages(assetKey?: string) {
  return (tree: Root) => {
    function walk(node: { children?: unknown[] }) {
      if (!node.children) return
      node.children = node.children.map((child) => {
        const item = child as { type: string; alt?: string; url?: string; children?: unknown[] }
        const local = item.type === 'image' && assetKey && item.url ? localAssetPath(item.url) : null
        if (local !== null && local !== undefined && assetKey) return { ...item, url: assetUrl(assetKey, local) }
        if (item.type === 'image' || item.type === 'imageReference') return { type: 'text', value: `[图片: ${item.alt || '未命名'}]` }
        walk(item)
        return item
      })
    }
    walk(tree)
  }
}

const previewSchema = withMathClasses({ ...defaultSchema, protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src ?? []), 'mino-asset'] } })

/**
 * `parsers` come from `loadCodeParsers` and `math` from `loadMathRenderer`; without them code blocks render as
 * plain text and formulas as their source.
 */
export function renderMarkdownPreview(markdown: string, assetKey?: string, captions = true, parsers?: CodeParsers, math?: MathRenderer): string {
  return String(unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDemoteCurrency)
    .use(headingAnchors)
    .use(blockImages, assetKey)
    .use(remarkRehype)
    .use(rehypeSanitize, previewSchema)
    .use(rehypeRenderMath, math)
    .use(rehypeHighlightCode, { parsers })
    .use(rehypeNumericColumns)
    .use(rehypeFigures, { captions })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .processSync(markdown))
}
