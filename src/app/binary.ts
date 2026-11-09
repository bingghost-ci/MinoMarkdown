import { invoke } from '@tauri-apps/api/core'

export type StagedAsset = { url: string; mime: string; staged: string }

export function stageBytes(bytes: Uint8Array): Promise<string> {
  return invoke<string>('stage_binary', bytes)
}

export async function readStaged(id: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await invoke<ArrayBuffer>('read_staged', { id }))
}

export function stageAssets(assets: { url: string; mime: string; bytes: Uint8Array }[]): Promise<StagedAsset[]> {
  return Promise.all(assets.map(async ({ url, mime, bytes }) => ({ url, mime, staged: await stageBytes(bytes) })))
}

export function blobUrl(bytes: Uint8Array<ArrayBuffer>, mime: string): string {
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}
