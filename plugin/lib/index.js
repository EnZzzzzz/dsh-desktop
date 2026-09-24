import { spawn } from 'node:child_process'

function openInSystemBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

/**
 * Host half of the dsh-desktop built-in plugin. Registers an exact fetch
 * route inside the connection service's own route table (behind its
 * Host/Origin fence and cookie auth); the handler mints the launch-token
 * URL — the token is per-process random, so it must be computed per call —
 * and hands it to the system browser directly: the desktop shell denies
 * window.open for loopback URLs, so the page cannot open it itself.
 *
 * Note: `connection.rpc.handle` is unusable from plugins — it reaches
 * `owner.webServer` on the service-providing context, which lacks the
 * property inject and throws. `fetch.register` is the kernel's own pattern.
 */
export function apply(ctx) {
  ctx.inject(['connection', 'webServer'], (ctx) => {
    const tokenUrl = () =>
      ctx.get('connection').authenticatedUrl(`http://127.0.0.1:${ctx.get('webServer').port}`)
    ctx.get('connection').fetch.register({
      path: '/api/dsh-desktop/open',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => {
        const url = tokenUrl()
        openInSystemBrowser(url)
        return Promise.resolve(Response.json({ ok: true, value: url }))
      },
    })
    ctx.get('connection').fetch.register({
      path: '/api/dsh-desktop/url',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => Promise.resolve(Response.json({ ok: true, value: tokenUrl() })),
    })
  })
}
