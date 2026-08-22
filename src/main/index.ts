import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadingPage, errorPage } from './pages'
import { startWebServer, stopWebServer } from './server'
import { startBrowserEndpoint } from './browser'
import { installAppMenu } from './menu'

let mainWindow: BrowserWindow | null = null
let closeBrowserEndpoint: (() => void) | null = null

const __dirname = dirname(fileURLToPath(import.meta.url))

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
      // Built-in browser: the dsh-builtin-browser plugin renders a real
      // Chromium <webview> in the harness page; webviewTag must be enabled
      // and the preload injects window.desktopBridge (shell marker + port).
      webviewTag: true,
      preload: join(__dirname, '../preload/index.mjs'),
      // sandbox: false so the preload can read process.env (the browser
      // control port); the page itself still has no Node access
      // (contextIsolation + no nodeIntegration).
      sandbox: false,
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

  void app.whenReady().then(async () => {
    installAppMenu()
    // Start the builtin-browser control endpoint before the window (and the
    // `dsh web` child) so DSH_DESKTOP_BROWSER_PORT is exported in time.
    try {
      const endpoint = await startBrowserEndpoint(() => mainWindow)
      closeBrowserEndpoint = endpoint.close
    } catch (error) {
      console.error('[builtin-browser] control endpoint failed:', error)
    }
    createWindow()
  })

  // The web server is a child of this app: closing the window ends the session.
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    closeBrowserEndpoint?.()
    stopWebServer()
  })
}
