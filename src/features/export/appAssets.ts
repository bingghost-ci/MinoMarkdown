/** Reads a bundled file through the `read_app_asset` command (only `/assets/*.woff2` in built apps). */
export type AssetCommand = (path: string) => Promise<ArrayBuffer>

function dataUriBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma < 0 || !uri.slice(0, comma).endsWith(';base64')) throw new Error('ASSET_NOT_FOUND')
  const binary = atob(uri.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Reads a bundled font for export. Built apps serve fonts from `/assets/`, which `read_app_asset` reads.
 * Under `tauri dev` the fonts come from the Vite server at `/node_modules/…`, which that command cannot
 * reach; there Vite's `?inline` turns the font into a module whose default export is a data URI. Loading it
 * is a same-origin script import, so no permission or CSP changes are needed, and built apps never take
 * this path.
 */
export async function readAppAsset(path: string, command: AssetCommand, dev: boolean = import.meta.env.DEV): Promise<Uint8Array> {
  if (dev && path.startsWith('/node_modules/') && path.endsWith('.woff2')) {
    const module = await import(/* @vite-ignore */ `${path}?inline`) as { default: string }
    return dataUriBytes(module.default)
  }
  return new Uint8Array(await command(path))
}
