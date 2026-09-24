import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PLUGIN_NAME = 'dsh-desktop-open-external'

/**
 * Install the built-in kernel plugin (plugin/) into the Harness home and
 * return the `--patch` overlay path that mounts it into the loader tree.
 *
 * The plugin package is copied to `$DSH_HOME/profiles/node_modules` (the
 * shared fallback directory): both the loader's internal import and the
 * client-modules registry resolve plugin names by walking up from the
 * profile directory, so no profile manifest edit and no pnpm is needed.
 * The patch overlay keeps `dsh.profile.bundles` at the pristine shipped
 * template — a user-owned bundle list would stop tracking kernel upgrades.
 *
 * Returns null (after logging) when anything fails: the shell must still
 * start without the settings row.
 */
export function ensureDesktopPlugin(): string | null {
  try {
    const sourceDir = app.isPackaged
      ? join(process.resourcesPath, 'plugin')
      : join(app.getAppPath(), 'plugin')
    const sourceManifest = JSON.parse(
      readFileSync(join(sourceDir, 'package.json'), 'utf8'),
    ) as { version?: string }

    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const targetDir = join(dshHome, 'profiles', 'node_modules', PLUGIN_NAME)
    const targetManifestPath = join(targetDir, 'package.json')
    let current = false
    if (existsSync(targetManifestPath)) {
      const target = JSON.parse(readFileSync(targetManifestPath, 'utf8')) as {
        version?: string
      }
      current = target.version === sourceManifest.version
    }
    if (!current) {
      rmSync(targetDir, { recursive: true, force: true })
      mkdirSync(targetDir, { recursive: true })
      cpSync(sourceDir, targetDir, {
        recursive: true,
        filter: (src) => {
          const rel = src.slice(sourceDir.length + 1)
          return rel === '' || rel === 'package.json' || rel.startsWith('lib')
        },
      })
    }

    const patchPath = join(app.getPath('userData'), `${PLUGIN_NAME}.patch.yml`)
    writeFileSync(
      patchPath,
      `- insert:\n    - id: ${PLUGIN_NAME}\n      name: ${PLUGIN_NAME}\n`,
    )
    return patchPath
  } catch (error) {
    console.error('[desktop-plugin] ensure failed:', error)
    return null
  }
}
