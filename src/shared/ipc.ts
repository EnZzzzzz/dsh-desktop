/**
 * IPC contract shared by main, preload and renderer.
 */

export interface Settings {
  /** DeepSeek API key, passed to the runtime subprocess as DEEPSEEK_API_KEY. */
  apiKey: string
  /** Model id routed through the initialize handshake, e.g. deepseek-v4-flash. */
  model: string
  /** Workspace root: cwd of the runtime and its bash/fs tools. */
  workspaceCwd: string
  /** Optional per-request output token cap. */
  maxTokens?: number
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'deepseek-v4-flash',
  workspaceCwd: '',
}

/** Main-process view of the harness lifecycle, mirrored to the renderer. */
export interface HarnessState {
  status: 'stopped' | 'starting' | 'ready' | 'running' | 'error'
  /** Present when status === 'error', or as a warning alongside another status. */
  error?: string
  /** Session id of the active run, when status === 'running'. */
  activeSessionId?: string
}

/** One server-to-client notification, forwarded verbatim over IPC. */
export interface HarnessNotificationPayload {
  method: string
  params: Record<string, unknown>
}

export const IpcChannels = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  pickWorkspace: 'dialog:pick-workspace',
  harnessSend: 'harness:send',
  harnessStop: 'harness:stop',
  harnessGetState: 'harness:get-state',
  // main → renderer
  harnessNotification: 'harness:notification',
  harnessState: 'harness:state',
} as const

/** API surface exposed to the renderer as window.dsh (see preload). */
export interface DshBridge {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickWorkspace(): Promise<string | null>
  send(sessionId: string, text: string): Promise<void>
  stop(): Promise<void>
  getState(): Promise<HarnessState>
  onNotification(cb: (n: HarnessNotificationPayload) => void): () => void
  onState(cb: (s: HarnessState) => void): () => void
}
