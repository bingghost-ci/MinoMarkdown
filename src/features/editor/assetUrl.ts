const prefix = 'mino-asset://localhost/'

function encodeSegment(segment: string): string {
  // Parentheses and quotes would end or confuse a Markdown link destination.
  return encodeURIComponent(segment).replace(/[()'!*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** URL the webview loads lazily for an image beside a granted document. */
export function assetUrl(assetKey: string, relative: string): string {
  return `${prefix}${assetKey}/${relative.split('/').map(encodeSegment).join('/')}`
}

export function isAssetUrl(url: string): boolean {
  return url.startsWith(prefix)
}

/** The document-relative path behind an asset URL, or null for any other URL. */
export function relativeFromAssetUrl(url: string): string | null {
  if (!isAssetUrl(url)) return null
  const parts = url.slice(prefix.length).split('/').slice(1)
  if (parts.length === 0) return null
  try { return parts.map(decodeURIComponent).join('/') } catch { return null }
}
