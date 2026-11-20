export function safeLinkHref(raw: string): string | null {
  const href = raw.trim()
  if (!href || /[\u0000-\u001f\u007f]/.test(href) || href.startsWith('//')) return null
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase()
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return null
  return href
}

/** Whether a link leaves the app: a web or mail address, which macOS opens, as against a file beside the document or a place in it. */
export function isExternalHref(href: string): boolean {
  return /^(https?|mailto):/i.test(href)
}
