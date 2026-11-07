#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(fileURLToPath(new URL('..', import.meta.url)))
const app = 'src-tauri/target/release/bundle/macos/MinoMarkdown.app'
const zip = 'dist-package/MinoMarkdown-0.1.0-macos-arm64-unsigned.zip'
const manifest = 'dist-package/manifest.json'
const appFile = (relative) => resolve(project, app, relative)
const zipFile = resolve(project, zip)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const command = (program, args, options = {}) => execFileSync(program, args, { encoding: 'utf8', ...options }).trim()

async function appFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`
    if (entry.isDirectory()) files.push(...await appFiles(join(directory, entry.name), `${relative}/`))
    else if (entry.isFile()) files.push(relative)
    else throw new Error(`Unexpected bundle entry: ${relative}`)
  }
  return files.sort()
}

async function inspect() {
  const executable = 'Contents/MacOS/mino-markdown'
  const plist = 'Contents/Info.plist'
  const icon = 'Contents/Resources/icon.icns'
  const [binaryBytes, plistBytes, iconBytes, zipBytes, npmLock, cargoLock] = await Promise.all([
    readFile(appFile(executable)), readFile(appFile(plist)), readFile(appFile(icon)), readFile(zipFile),
    readFile(resolve(project, 'package-lock.json')), readFile(resolve(project, 'src-tauri/Cargo.lock')),
  ])
  const architecture = command('lipo', ['-archs', appFile(executable)])
  const minimumSystemVersion = command('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', appFile(plist)])
  const version = command('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', appFile(plist)])
  const iconName = command('plutil', ['-extract', 'CFBundleIconFile', 'raw', appFile(plist)])
  command('unzip', ['-tq', zipFile])
  const payloadFiles = await appFiles(resolve(project, app))
  const archivedFiles = command('unzip', ['-Z1', zipFile]).split('\n')
    .filter((entry) => entry.startsWith('MinoMarkdown.app/') && !entry.endsWith('/') && !entry.split('/').some((part) => part.startsWith('._')))
    .map((entry) => entry.slice('MinoMarkdown.app/'.length)).sort()
  if (JSON.stringify(payloadFiles) !== JSON.stringify(archivedFiles) ||
      JSON.stringify(payloadFiles) !== JSON.stringify([executable, plist, icon].sort())) {
    throw new Error('Bundle regular-file list differs from the ZIP or expected payload')
  }
  const archivedBinary = execFileSync('unzip', ['-p', zipFile, `MinoMarkdown.app/${executable}`], { maxBuffer: 32 * 1024 * 1024 })
  const archivedPlist = execFileSync('unzip', ['-p', zipFile, `MinoMarkdown.app/${plist}`], { maxBuffer: 32 * 1024 * 1024 })
  const archivedIcon = execFileSync('unzip', ['-p', zipFile, `MinoMarkdown.app/${icon}`], { maxBuffer: 32 * 1024 * 1024 })
  if (architecture !== 'arm64' || minimumSystemVersion !== '12.0' || version !== '0.1.0' || iconName !== 'icon.icns') {
    throw new Error('Bundle identity, architecture or declared minimum macOS version differs from the release plan')
  }
  if (sha256(binaryBytes) !== sha256(archivedBinary) || sha256(plistBytes) !== sha256(archivedPlist) || sha256(iconBytes) !== sha256(archivedIcon)) {
    throw new Error('ZIP executable, Info.plist or icon differs from the .app')
  }
  return {
    schemaVersion: 1, version, architecture, minimumSystemVersion,
    signing: 'built with --no-sign; installation and codesign verification PENDING',
    app: { path: app, kib: Number(command('du', ['-sk', resolve(project, app)]).split(/\s+/)[0]), payloadFiles,
      executableSha256: sha256(binaryBytes), infoPlistSha256: sha256(plistBytes), iconSha256: sha256(iconBytes) },
    archive: { path: zip, bytes: zipBytes.length, sha256: sha256(zipBytes),
      crc: 'PASS', payloadFileList: 'matches app', embeddedExecutable: 'matches app', embeddedInfoPlist: 'matches app', embeddedIcon: 'matches app' },
    lockfiles: { npmSha256: sha256(npmLock), cargoSha256: sha256(cargoLock) },
    scope: 'Local arm64 build integrity only; no installation, native workflow, lower-macOS, signing or user acceptance proof',
  }
}

const mode = process.argv[2]
if (!['write', 'verify'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/package-manifest.mjs write|verify')
  process.exit(2)
}
try {
  const current = await inspect()
  const destination = resolve(project, manifest)
  if (mode === 'write') {
    await writeFile(destination, `${JSON.stringify(current, null, 2)}\n`)
    console.log(`Wrote ${manifest}`)
  } else {
    const saved = JSON.parse(await readFile(destination, 'utf8'))
    if (JSON.stringify(saved) !== JSON.stringify(current)) throw new Error('Package manifest does not match current artifacts; regenerate after rebuilding')
    console.log(`Verified ${manifest}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
