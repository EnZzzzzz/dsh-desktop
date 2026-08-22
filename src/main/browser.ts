import type { BrowserWindow } from 'electron'
import { createServer } from 'node:http'

/** Env var the dsh-builtin-browser host half reads for the control port. */
export const CONTROL_PORT_ENV = 'DSH_DESKTOP_BROWSER_PORT'

/**
 * Forward one browser command into the harness page. The dsh-builtin-browser
 * Client half registers `window.__dshBrowser.command`; that controller runs
 * the actual `<webview>` operation and returns a JSON value, relayed verbatim
 * back to the harness host half.
 */
async function forwardToPage(
  win: BrowserWindow,
  op: string,
  payload: Record<string, string>,
): Promise<unknown> {
  if (win.isDestroyed()) throw new Error('harness window not available')
  const script = `(async () => {
    const ctrl = window.__dshBrowser
    if (!ctrl || typeof ctrl.command !== 'function') {
      return { ok: false, error: 'browser controller not mounted (is the builtin-browser plugin running?)' }
    }
    try {
      const value = await ctrl.command(${JSON.stringify({ op, ...payload })})
      return value ?? { ok: true }
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) }
    }
  })()`
  return win.webContents.executeJavaScript(script, true)
}

/**
 * Start the loopback control endpoint the dsh-builtin-browser host half calls
 * through `ctx.web.fetch`. Picks an OS-assigned port and exports it via
 * `CONTROL_PORT_ENV`, which the spawned `dsh web` child (env inherited from
 * process.env) and the page preload both read.
 *
 * Only op-whitelisted commands are forwarded (`navigate/back/forward/reload/
 * stop/eval` decided by the page controller); the endpoint listens on
 * 127.0.0.1 only and must never be exposed beyond loopback.
 */
export async function startBrowserEndpoint(
  windowProvider: () => BrowserWindow | null,
): Promise<{ port: number; close: () => void }> {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    if (url.pathname !== '/browser/command') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    const op = url.searchParams.get('op') ?? ''
    const payload: Record<string, string> = {}
    for (const [key, value] of url.searchParams) {
      if (key !== 'op') payload[key] = value
    }
    const win = windowProvider()
    if (!win || win.isDestroyed()) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'harness window not available' }))
      return
    }
    try {
      const value = await forwardToPage(win, op, payload)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(err instanceof Error ? err.message : err) }))
    }
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      process.env[CONTROL_PORT_ENV] = String(port)
      console.log(`[builtin-browser] control endpoint on http://127.0.0.1:${port} (${CONTROL_PORT_ENV})`)
      resolve({ port, close: () => server.close() })
    })
  })
}
