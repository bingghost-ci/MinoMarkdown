#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(fileURLToPath(new URL('..', import.meta.url)))
const app = resolve(project, 'src-tauri/target/release/bundle/macos/MinoMarkdown.app/Contents/MacOS/mino-markdown')
const fixture = resolve(project, 'dist-package/performance-fixtures/manifest.json')
const metrics = {
  'startup-ms': { unit: 'ms', minimum: 20 },
  'idle-rss-mib': { unit: 'MiB', minimum: 1 },
  'input-ms': { unit: 'ms', minimum: 20 },
  'open-1mib-ms': { unit: 'ms', minimum: 20 },
  'directory-first-screen-ms': { unit: 'ms', minimum: 1 },
  'html-20-images-ms': { unit: 'ms', minimum: 1 },
  'html-peak-rss-mib': { unit: 'MiB', minimum: 1 },
}

function usage() {
  console.error('Usage:')
  console.error('  node scripts/performance-session.mjs init <new-session.json> <machine-description>')
  console.error('  node scripts/performance-session.mjs record <session.json> <metric> <number> <method> [note]')
  console.error('  node scripts/performance-session.mjs report <session.json>')
  console.error(`Metrics: ${Object.keys(metrics).join(', ')}`)
  process.exit(2)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function currentInputs(verifyFiles = false) {
  const [binary, manifestBytes] = await Promise.all([readFile(app), readFile(fixture)])
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.id !== 'F10' || manifest.count !== 10023) throw new Error('F10 fixture manifest is missing or incomplete')
  const expected = JSON.parse(await readFile(resolve(project, 'tests/fixtures/F10-scale.json'), 'utf8')).expected
  const manifestSha256 = sha256(manifestBytes)
  if (manifestSha256 !== expected.manifestSha256) throw new Error('F10 fixture manifest hash differs from the locked expectation')
  if (verifyFiles) {
    const root = dirname(fixture)
    for (const item of manifest.records) {
      const bytes = await readFile(join(root, item.path))
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error(`F10 fixture changed: ${item.path}`)
    }
  }
  return { appSha256: sha256(binary), manifestSha256 }
}

async function sessionAt(path) {
  const session = JSON.parse(await readFile(path, 'utf8'))
  if (session.schemaVersion !== 1 || !Array.isArray(session.measurements)) throw new Error('Invalid performance session')
  const current = await currentInputs()
  if (session.appSha256 !== current.appSha256 || session.manifestSha256 !== current.manifestSha256) {
    throw new Error('App or F10 fixture changed; start a new session for this build')
  }
  return session
}

async function replaceJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

const [command, file, ...args] = process.argv.slice(2)
if (!command || !file) usage()
const path = resolve(file)

try {
  if (command === 'init') {
    const [machine] = args
    if (!machine || args.length !== 1) usage()
    if (platform() !== 'darwin' || arch() !== 'arm64') throw new Error('This measurement session requires macOS arm64')
    const inputs = await currentInputs(true)
    const session = {
      schemaVersion: 1, createdAt: new Date().toISOString(), machine,
      platform: platform(), arch: arch(), osRelease: release(),
      app, fixture, ...inputs, measurements: [],
    }
    await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ session: path, ...inputs, measurements: 0 }))
  } else if (command === 'record') {
    const [metric, rawValue, method, note = ''] = args
    if (!metrics[metric] || !rawValue || !method || args.length < 3 || args.length > 4) usage()
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0) throw new Error('Measurement must be a finite, nonnegative number')
    const session = await sessionAt(path)
    session.measurements.push({ metric, value, unit: metrics[metric].unit, method, note, recordedAt: new Date().toISOString() })
    await replaceJson(path, session)
    console.log(JSON.stringify({ session: path, metric, value, count: session.measurements.filter((item) => item.metric === metric).length }))
  } else if (command === 'report') {
    if (args.length) usage()
    const session = await sessionAt(path)
    await currentInputs(true)
    const summary = Object.fromEntries(Object.entries(metrics).map(([metric, spec]) => {
      const values = session.measurements.filter((item) => item.metric === metric).map((item) => item.value)
      return [metric, { count: values.length, required: spec.minimum, unit: spec.unit,
        p50: values.length ? percentile(values, 0.5) : null,
        p95: values.length ? percentile(values, 0.95) : null,
        coverage: values.length >= spec.minimum ? 'recorded' : 'PENDING' }]
    }))
    console.log(JSON.stringify({ appSha256: session.appSha256, manifestSha256: session.manifestSha256,
      machine: session.machine, osRelease: session.osRelease, summary,
      note: 'Values are recorded measurements. No performance gate is passed automatically.' }, null, 2))
  } else usage()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
