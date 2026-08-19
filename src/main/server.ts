import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'

const require = createRequire(import.meta.url)

/**
 * Resolve a Node.js executable for the web-server subprocess. Packaged builds
 * ship their own copy under resources/node/bin; in development, probe common
 * locations (GUI-launched apps often inherit a minimal PATH) and finally fall
 * back to Electron itself in run-as-node mode.
 */
function resolveNodeCommand(): { command: string; envPrefix?: NodeJS.ProcessEnv } {
  const candidates = [
    app.isPackaged ? join(process.resourcesPath, 'node', 'bin', 'node') : undefined,
    process.env.DSH_DESKTOP_NODE,
    'node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ].filter((c): c is string => Boolean(c))
  for (const command of candidates) {
    try {
      execFileSync(command, ['-v'], { stdio: ['ignore', 'pipe', 'ignore'] })
      return { command }
    } catch {
      // try next
    }
  }
  return { command: process.execPath, envPrefix: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** Entry of the published dsh CLI (bin may not be exposed via exports map). */
function resolveDshBin(): string {
  const pkg = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(pkg), 'lib', 'bin.js')
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

let child: ChildProcess | null = null

/**
 * Spawn `dsh web --port <free>` and wait until the UI answers HTTP 200.
 * Resolves with the origin to load. Server logs go to userData/logs.
 */
export async function startWebServer(): Promise<string> {
  const port = await freePort()
  const bin = resolveDshBin()
  if (!existsSync(bin)) throw new Error(`dsh CLI 入口缺失：${bin}`)

  const logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  const log = createWriteStream(join(logDir, 'web-server.log'), { flags: 'a' })
  log.write(`\n===== dsh web starting at ${new Date().toISOString()} on port ${port} =====\n`)

  const { command, envPrefix } = resolveNodeCommand()
  child = spawn(command, [bin, 'web', '--port', String(port)], {
    env: { ...process.env, ...envPrefix },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)

  const url = `http://127.0.0.1:${port}`
  const exited = new Promise<never>((_, reject) => {
    child!.once('exit', (code, signal) => {
      reject(new Error(`dsh web 进程提前退出（code=${code} signal=${signal}），日志见 ${logDir}/web-server.log`))
    })
  })
  await Promise.race([waitForReady(url), exited])
  return url
}

async function waitForReady(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('等待 dsh web 服务就绪超时')
    await new Promise((r) => setTimeout(r, 500))
  }
}

/** Stop the web server (SIGTERM; the dsh bin disposes its Cordis tree). */
export function stopWebServer(): void {
  if (child && !child.killed) child.kill('SIGTERM')
  child = null
}
