import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'

const require = createRequire(import.meta.url)
const WEB_PORT = 49982

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

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

function listenerPids(port: number): number[] {
  const lsof = ['/usr/sbin/lsof', '/usr/bin/lsof'].find(existsSync)
  if (!lsof) throw new Error(`端口 ${port} 已被占用，但系统中找不到 lsof，无法定位占用进程`)

  try {
    const output = execFileSync(lsof, ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
    return [...new Set(output.trim().split(/\s+/).map(Number))].filter(
      (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
    )
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 1) return []
    throw error
  }
}

async function releasePort(port: number): Promise<void> {
  if (await canListen(port)) return

  const terminate = (signal: NodeJS.Signals): void => {
    for (const pid of listenerPids(port)) {
      try {
        process.kill(pid, signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }

  terminate('SIGTERM')
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (await canListen(port)) return
  }

  terminate('SIGKILL')
  await new Promise((resolve) => setTimeout(resolve, 100))
  if (!(await canListen(port))) throw new Error(`无法释放端口 ${port}`)
}

let child: ChildProcess | null = null

/**
 * Spawn `dsh web` on the desktop shell's fixed port and wait until the UI
 * answers HTTP 200.
 * Resolves with the origin to load. Server logs go to userData/logs.
 */
export async function startWebServer(): Promise<string> {
  const port = WEB_PORT
  await releasePort(port)
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
