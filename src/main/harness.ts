import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessState, Settings } from '../shared/ipc'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve a Node.js executable for the runtime subprocess. GUI-launched
 * Electron apps often inherit a minimal PATH, so probe common locations and
 * finally fall back to Electron itself in run-as-node mode.
 */
function resolveNodeCommand(): { command: string; envPrefix?: NodeJS.ProcessEnv } {
  const candidates = [
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

export interface HarnessEvents {
  onNotification(notification: { method: string; params: Record<string, unknown> }): void
  onState(state: HarnessState): void
}

/**
 * Owns the DeepSeekHarness runtime subprocess: lazy start, prompt dispatch
 * with streaming notification forwarding, and stop-by-restart (the SDK
 * protocol has no per-prompt cancel — abandoning a turn means reaping the
 * runtime and starting a fresh one).
 */
export class HarnessManager {
  private harness: DeepSeekHarness | null = null
  private state: HarnessState = { status: 'stopped' }
  private runToken = 0

  constructor(
    private settings: Settings,
    private events: HarnessEvents,
  ) {}

  getState(): HarnessState {
    return this.state
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
    // Route, credentials and workspace all live in the handshake/child env:
    // any settings change invalidates the current runtime.
    void this.restart()
  }

  private setState(patch: Partial<HarnessState>): void {
    this.state = { ...this.state, ...patch }
    this.events.onState(this.state)
  }

  private buildHarness(): DeepSeekHarness {
    const { command, envPrefix } = resolveNodeCommand()
    const bin = require.resolve('@deepseek-ai/dsh-sdk-jsonrpc-demo/bin')
    const config = join(here, '../../runtime/cordis.yml')
    const workspace = this.settings.workspaceCwd || app.getPath('home')
    return new DeepSeekHarness({
      launch: {
        command,
        args: [bin, config],
        cwd: workspace,
        env: {
          ...process.env,
          ...envPrefix,
          ...(this.settings.apiKey ? { DEEPSEEK_API_KEY: this.settings.apiKey } : {}),
          DSH_CWD: workspace,
          DSH_SESSION_ROOT: join(app.getPath('userData'), 'sessions'),
          DSH_MODEL: this.settings.model,
        },
      },
      cwd: workspace,
      provider: 'deepseek-official',
      model: this.settings.model,
      ...(this.settings.maxTokens ? { maxTokens: this.settings.maxTokens } : {}),
    })
  }

  private async ensureStarted(): Promise<DeepSeekHarness> {
    this.harness ??= this.buildHarness()
    if (this.state.status === 'stopped' || this.state.status === 'error') {
      this.setState({ status: 'starting', error: undefined })
    }
    await this.harness.start()
    return this.harness
  }

  /** Send one prompt and stream every notification until the agent is idle. */
  async send(sessionId: string, text: string): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('Agent is busy — wait for the current turn or stop it')
    }
    const token = ++this.runToken
    try {
      const harness = await this.ensureStarted()
      if (token !== this.runToken) return // superseded by stop()/restart()
      this.setState({ status: 'running', activeSessionId: sessionId, error: undefined })
      await harness.run(text, {
        sessionId,
        onNotification: (n) => this.events.onNotification({ method: n.method, params: n.params }),
      })
      if (token === this.runToken) this.setState({ status: 'ready', activeSessionId: undefined })
    } catch (error) {
      if (token !== this.runToken) return // stopped deliberately
      const message = error instanceof Error ? error.message : String(error)
      this.setState({ status: 'error', activeSessionId: undefined, error: message })
      throw error
    }
  }

  /**
   * Abandon the current turn: the SDK protocol has no prompt cancel, so the
   * runtime is reaped and lazily recreated on the next send.
   */
  async stop(): Promise<void> {
    await this.restart()
  }

  private async restart(): Promise<void> {
    this.runToken++
    const harness = this.harness
    this.harness = null
    this.setState({ status: 'stopped', activeSessionId: undefined })
    if (harness) {
      try {
        await harness.close()
      } catch {
        // reaping is best-effort; the SDK escalates to SIGKILL internally
      }
    }
  }

  async dispose(): Promise<void> {
    await this.restart()
  }
}
