import { parseGfm } from './gfm'
import { htmlImageSources, localHtmlImagePath, parseHtmlImages } from './htmlImages'

export type HtmlImageFile = { url: string; relative: string }

/**
 * Files beside the document that raw HTML `<img>` in `markdown` shows, as the address written and the path it names;
 * empty, without parsing, when there is no `<img`. Kept out of the app shell: it runs in the analysis worker.
 */
export function htmlImageFilesIn(markdown: string): HtmlImageFile[] {
  if (!/<img/i.test(markdown)) return []
  const found = new Map<string, string>()
  const walk = (node: { type: string; value?: string; children?: unknown[] }) => {
    if (node.type === 'html' && node.value && /<img/i.test(node.value)) {
      for (const src of htmlImageSources(parseHtmlImages(node.value) ?? [])) {
        const relative = localHtmlImagePath(src)
        if (relative !== null && !found.has(src)) found.set(src, relative)
      }
    }
    for (const child of node.children ?? []) walk(child as typeof node)
  }
  walk(parseGfm(markdown) as never)
  return Array.from(found, ([url, relative]) => ({ url, relative }))
}
