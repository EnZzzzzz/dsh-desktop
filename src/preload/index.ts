/**
 * Preload for the dsh-desktop shell.
 *
 * Exposes a minimal, frozen `window.desktopBridge` to the harness web GUI so
 * the page can tell it is inside the shell (webview support available) and
 * learn the builtin-browser control port. No Node capabilities leak into the
 * page: only the port number and this shell's marker cross the context
 * bridge. The browser controller itself (`window.__dshBrowser`) is
 * registered by the dsh-builtin-browser Client half, not here.
 */
import { contextBridge } from 'electron'

const desktopBridge = Object.freeze({
  /** Marker: the page is running inside the Desktop shell with webview support. */
  isDesktopShell: true,
  /** Loopback control port, when the main process has started the endpoint. */
  browserPort: Number(process.env.DSH_DESKTOP_BROWSER_PORT) || null,
})

contextBridge.exposeInMainWorld('desktopBridge', desktopBridge)
