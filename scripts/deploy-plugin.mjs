// Deploy the built-in kernel plugin (plugin/) into every location a running
// app may load it from, then read each one back.
//
// Two places matter, and they must agree:
//   - `$DSH_HOME/profiles/node_modules/<pkg>` — where the page actually resolves
//     the package today. A running host picks the new bytes up through its
//     bundle watch, no restart needed.
//   - the packaged app's `Resources/plugin` — where the desktop launcher
//     re-copies from at every start. Skipping it makes the next launch silently
//     roll the plugin back to whatever that directory holds.
//
// Usage: node scripts/deploy-plugin.mjs [--app <path to .app>]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-desktop-open-external'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'plugin')
const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))

const appIndex = process.argv.indexOf('--app')
const appPath = appIndex !== -1
  ? process.argv[appIndex + 1]
  : '/Applications/dsh-desktop.app'

const targets = [
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'node_modules', PKG),
]
const packaged = join(appPath, 'Contents', 'Resources', 'plugin')
if (existsSync(dirname(packaged))) targets.push(packaged)

/** Copy manifest + built halves only; sources, build script, and maps stay out. */
const copyPlugin = (dst) => {
  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, {
    recursive: true,
    filter: (path) => {
      const rel = path.slice(src.length + 1)
      return rel === '' || rel === 'package.json' || rel.startsWith('lib')
    },
  })
}

let failed = 0
for (const dst of targets) {
  copyPlugin(dst)
  // Read back what actually landed: a launcher rewriting this tree would
  // otherwise look exactly like a successful deploy.
  const landed = JSON.parse(readFileSync(join(dst, 'package.json'), 'utf8')).version
  const ok = landed === version && existsSync(join(dst, 'lib', 'client.js'))
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${dst} = ${landed}`)
  if (!ok) failed += 1
}
console.log(`deployed ${version} to ${targets.length - failed}/${targets.length} locations`)
process.exitCode = failed === 0 ? 0 : 1
