/**
 * Copy the build machine's Node.js executable into build/node/bin/node so
 * electron-builder can ship it as an extra resource. The packaged app spawns
 * this binary for the dsh runtime subprocess, so end users need no system
 * Node. Follows version-manager shims via realpath.
 */
import { copyFileSync, mkdirSync, realpathSync, chmodSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = realpathSync(process.execPath)
const dest = join(root, 'build', 'node', 'bin', 'node')

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
chmodSync(dest, 0o755)

const mb = (statSync(dest).size / 1024 / 1024).toFixed(1)
console.log(`[prepare-node] bundled ${src} -> ${dest} (${mb} MB)`)
