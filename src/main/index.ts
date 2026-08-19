import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { loadingPage, errorPage } from './pages'
import { startWebServer, stopWebServer } from './server'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    title: 'dsh-desktop',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f24' : '#f5f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // External links opened by the web UI go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://127.0.0.1')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  void mainWindow.loadURL(loadingPage())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  startWebServer()
    .then((url) => mainWindow?.loadURL(url))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      void mainWindow?.loadURL(errorPage(message))
    })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(createWindow)

  // The web server is a child of this app: closing the window ends the session.
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => stopWebServer())
}
