import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type DshBridge, type HarnessNotificationPayload, type HarnessState, type Settings } from '../shared/ipc'

const bridge: DshBridge = {
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet) as Promise<Settings>,
  setSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsSet, patch) as Promise<Settings>,
  pickWorkspace: () => ipcRenderer.invoke(IpcChannels.pickWorkspace) as Promise<string | null>,
  send: (sessionId, text) => ipcRenderer.invoke(IpcChannels.harnessSend, sessionId, text) as Promise<void>,
  stop: () => ipcRenderer.invoke(IpcChannels.harnessStop) as Promise<void>,
  getState: () => ipcRenderer.invoke(IpcChannels.harnessGetState) as Promise<HarnessState>,
  onNotification: (cb) => {
    const listener = (_e: unknown, n: HarnessNotificationPayload) => cb(n)
    ipcRenderer.on(IpcChannels.harnessNotification, listener)
    return () => ipcRenderer.removeListener(IpcChannels.harnessNotification, listener)
  },
  onState: (cb) => {
    const listener = (_e: unknown, s: HarnessState) => cb(s)
    ipcRenderer.on(IpcChannels.harnessState, listener)
    return () => ipcRenderer.removeListener(IpcChannels.harnessState, listener)
  },
}

contextBridge.exposeInMainWorld('dsh', bridge)
