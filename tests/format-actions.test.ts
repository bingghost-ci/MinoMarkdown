import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatMenuCommands, transformMenuActions } from '../src/app/formatActions'

const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
const labels = readFileSync('src-tauri/src/native_menu.rs', 'utf8')

describe('native Format menu', () => {
  const ids = [...Object.keys(formatMenuCommands), 'format-link', ...Object.keys(transformMenuActions)]

  it.each(ids)('%s is built and labeled in both languages', (id) => {
    expect(lib).toContain(`"${id}"`)
    expect(labels).toContain(`("${id}", true)`)
    expect(labels).toContain(`("${id}", false)`)
  })
})
