// What the release and fixture scripts share: where the project is, where the built app is, and hashing.
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The project root, wherever the script is started from. */
export const project = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** The app bundle `build.sh` produces, relative to the project root. */
export const releaseApp = 'src-tauri/target/release/bundle/macos/Mino.app'
/** The SHA-256 of bytes or of a string, in hexadecimal. */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
