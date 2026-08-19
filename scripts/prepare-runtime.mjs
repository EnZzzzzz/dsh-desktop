// Stages PRODUCTION dependencies only into build/runtime/node_modules.
// electron-builder ships that directory verbatim (see extraResources in
// electron-builder.yml); copying the project root's node_modules would drag
// electron, electron-builder, typescript and every other devDependency —
// roughly 600MB of dead weight — into the DMG.
import { cpSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const staging = path.join(root, 'build', 'runtime')

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
for (const f of ['package.json', 'package-lock.json']) {
  cpSync(path.join(root, f), path.join(staging, f))
}

// Install scripts must run: node-pty/koffi fetch their prebuilt binaries here.
// The ABI matches the bundled runtime because prepare-node.mjs copies the
// very node binary that executes this script.
execFileSync('npm', ['ci', '--omit=dev'], { cwd: staging, stdio: 'inherit' })
