import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Version of the bundled @deepseek-ai/dsh kernel (same resolution as server.ts). */
function kernelVersion(): string {
  try {
    const pkgPath = require.resolve('@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Application menu: keep the platform-standard entries (appMenu/edit/window —
 * Edit is what gives the web UI working copy/paste shortcuts) and surface the
 * kernel version under Help. Clicking it opens a dialog with the full
 * version breakdown.
 */
export function installAppMenu(): void {
  const kernel = kernelVersion()
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: `内核版本：${kernel}`,
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '版本信息',
              message: 'dsh-desktop',
              detail: [
                `应用版本：${app.getVersion()}`,
                `内核版本（@deepseek-ai/dsh）：${kernel}`,
                `Electron：${process.versions.electron ?? 'unknown'}`,
                `Chromium：${process.versions.chrome ?? 'unknown'}`,
                `Node.js：${process.versions.node ?? 'unknown'}`,
              ].join('\n'),
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
