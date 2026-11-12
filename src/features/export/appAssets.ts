/** Reads a bundled file through the `read_app_asset` command (in built apps, only fonts and paper layers under `/assets/`). */
export type AssetCommand = (path: string) => Promise<ArrayBuffer>

/** Bytes as base64, in pieces small enough to pass to `String.fromCharCode`. */
export function base64(bytes: Uint8Array): string {
  let output = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) output += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(output)
}

function dataUriBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma < 0 || !uri.slice(0, comma).endsWith(';base64')) throw new Error('ASSET_NOT_FOUND')
  const binary = atob(uri.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Reads a bundled font or paper layer for export. Built apps serve them from `/assets/`, which `read_app_asset`
 * reads. Under `tauri dev` they come from the Vite server at `/node_modules/…` and `/src/assets/paper/…`, which that
 * command cannot reach; there Vite's `?inline` turns the file into a module whose default export is a data URI. Loading it
 * is a same-origin script import, so no permission or CSP changes are needed, and built apps never take
 * this path.
 */
export async function readAppAsset(path: string, command: AssetCommand, dev: boolean = import.meta.env.DEV): Promise<Uint8Array> {
  if (dev && ((path.startsWith('/node_modules/') && path.endsWith('.woff2')) || /^\/src\/assets\/paper\/[a-z-]+\.png$/.test(path))) {
    const module = await import(/* @vite-ignore */ `${path}?inline`) as { default: string }
    return dataUriBytes(module.default)
  }
  return new Uint8Array(await command(path))
}
