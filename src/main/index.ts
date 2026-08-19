import { app, BrowserWindow, shell } from 'electron'
import { startWebServer, stopWebServer } from './server'

let mainWindow: BrowserWindow | null = null

const LOADING_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-desktop</title>
<style>body{margin:0;height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;
background:#1e1f24;color:#9a9ba5;font-family:-apple-system,'PingFang SC',sans-serif}
.brand{color:#e4e4e9;font-size:18px;font-weight:600}</style></head>
<body><div class="brand">dsh-desktop</div><div>正在启动 DeepSeek Harness 服务…</div></body></html>`)} `

function errorPage(message: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-desktop</title>
<style>body{margin:0;height:100vh;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;
background:#1e1f24;color:#9a9ba5;font-family:-apple-system,'PingFang SC',sans-serif}
.error{color:#e5534b;max-width:70%;white-space:pre-wrap}</style></head>
<body><div class="error">服务启动失败：${message.replace(/</g, '&lt;')}</div>
<div>请查看日志后重启应用。</div></body></html>`)} `
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    title: 'dsh-desktop',
    backgroundColor: '#1e1f24',
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

  void mainWindow.loadURL(LOADING_PAGE)
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
