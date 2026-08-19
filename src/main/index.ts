import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IpcChannels, type Settings } from '../shared/ipc'
import { loadSettings, saveSettings } from './settings'
import { HarnessManager } from './harness'

const here = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let settings = loadSettings()

const manager = new HarnessManager(settings, {
  onNotification: (n) => mainWindow?.webContents.send(IpcChannels.harnessNotification, n),
  onState: (s) => mainWindow?.webContents.send(IpcChannels.harnessState, s),
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: 'dsh-desktop',
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(here, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.settingsGet, () => settings)

  ipcMain.handle(IpcChannels.settingsSet, (_event, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch }
    saveSettings(settings)
    manager.updateSettings(settings)
    return settings
  })

  ipcMain.handle(IpcChannels.pickWorkspace, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择工作区目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IpcChannels.harnessSend, (_event, sessionId: string, text: string) =>
    manager.send(sessionId, text),
  )

  ipcMain.handle(IpcChannels.harnessStop, () => manager.stop())

  ipcMain.handle(IpcChannels.harnessGetState, () => manager.getState())
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void manager.dispose()
})
