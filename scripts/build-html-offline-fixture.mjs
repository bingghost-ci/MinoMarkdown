#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createServer } from 'vite'

const output = resolve(process.argv[2] ?? 'dist-package/html-offline-check/export.html')
const fixture = resolve('tests/fixtures/assets/synthetic-2x2.png')
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { renderHtml } = await vite.ssrLoadModule('/src/features/export/renderHtml.ts')
  const bytes = new Uint8Array(await readFile(fixture))
  const markdown = '# 尚未保存的正文\n\n![本地图片](assets/synthetic-2x2.png)\n\n<script>window.__unsafe = true</script>\n'
  const html = await renderHtml(markdown, '离线 HTML 检查', async (url) => {
    if (url !== 'assets/synthetic-2x2.png') throw new Error(`Unexpected image: ${url}`)
    return { bytes, mime: 'image/png' }
  })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, html, 'utf8')
  process.stdout.write(`${output}\n`)
} finally {
  await vite.close()
}
