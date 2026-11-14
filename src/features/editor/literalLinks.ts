import type { Ctx } from '@milkdown/kit/ctx'
import type { MarkSchema } from '@milkdown/kit/transformer'
import { defaultHandlers } from 'mdast-util-to-markdown'
import type { Options } from 'remark-stringify'

/**
 * GFM reads a bare `https://…`, `www.…` or `name@host` as a link. The editor's serializer would write such a
 * link as `<https://…>` or `[www.…](http://www.…)`, changing every bare address in a file on its first save.
 * The link mark therefore remembers that it came from bare text (`literal`), and the link handler below writes
 * it back bare while it still reads as the same link in the same place.
 */

type LinkHandler = NonNullable<NonNullable<Options['handlers']>['link']>
type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[]; position?: { start?: { offset?: number }; end?: { offset?: number } } }

/** Characters that never appear in a bare address as GFM reads it, or that the serializer would escape. */
const unsafeInLiteral = /[\s*_~`[\]<>\\|()"']/
/** GFM leaves trailing punctuation out of a bare address, so an address ending in one was not written bare. */
const trailingPunctuation = /[.,:;!?]$/
const email = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/

/** Whether `text` written bare reads back as a link to `url`. */
export function readsAsLiteral(text: string, url: string): boolean {
  if (!text || unsafeInLiteral.test(text) || trailingPunctuation.test(text)) return false
  if (/^https?:\/\/[^/]/i.test(text)) return url === text
  if (/^www\.[^.]/i.test(text)) return url === `http://${text}`
  return email.test(text) && url === `mailto:${text}`
}

/** A bare address starts after whitespace, `*`, `_`, `~` or `(`, and stops before whitespace, punctuation or `<`. */
function boundariesAllowLiteral(before: string, after: string): boolean {
  return (before === '' || /[\s*_~(]/.test(before)) && (after === '' || /[\s.,:;!?*_~)<]/.test(after))
}

/** Whether a parsed `link` node is a bare address: its source is exactly its text, with no brackets around it. */
export function isLiteralLinkNode(node: MarkdownNode): boolean {
  const child = node.children?.length === 1 ? node.children[0] : null
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  return child?.type === 'text' && start !== undefined && end !== undefined && end - start === (child.value ?? '').length && readsAsLiteral(child.value ?? '', node.url ?? '')
}

export const literalLinkHandler: LinkHandler = (node, parent, state, info) => {
  const child = node.children.length === 1 ? node.children[0] : null
  const text = child?.type === 'text' ? child.value : null
  if ((node as { literal?: boolean }).literal && text !== null && !node.title && readsAsLiteral(text, node.url) && boundariesAllowLiteral(info.before, info.after)) return text
  return defaultHandlers.link(node, parent, state, info)
}

/** Extends the link mark with `literal`, set when the parsed link was a bare address. Use with `ctx.update(linkSchema.key, …)`. */
export function withLiteralLinks(base: (ctx: Ctx) => MarkSchema): (ctx: Ctx) => MarkSchema {
  return (ctx) => {
    const schema = base(ctx)
    return {
      ...schema,
      attrs: { ...schema.attrs, literal: { default: false } },
      // The attribute is the serializer's business only; it stays out of the page and the clipboard.
      toDOM: schema.toDOM && ((mark, inline) => {
        const { literal: _literal, ...attrs } = mark.attrs
        return schema.toDOM!(Object.assign(Object.create(Object.getPrototypeOf(mark) as object) as typeof mark, mark, { attrs }), inline)
      }),
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, markType) => {
          state.openMark(markType, { href: node.url as string, title: (node.title as string | null | undefined) ?? null, literal: isLiteralLinkNode(node as MarkdownNode) })
          state.next(node.children)
          state.closeMark(markType)
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, mark) => {
          state.withMark(mark, 'link', undefined, { title: mark.attrs.title as string | null, url: mark.attrs.href as string, ...(mark.attrs.literal ? { literal: true } : {}) })
        },
      },
    }
  }
}
